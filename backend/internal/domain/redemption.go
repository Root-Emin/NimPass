package domain

import (
	"errors"
	"fmt"
	"time"
)

type RedemptionStatus string

const (
	RedemptionCreated    RedemptionStatus = "CREATED"
	RedemptionAuthorized RedemptionStatus = "AUTHORIZED"
	RedemptionConsumed   RedemptionStatus = "CONSUMED"
	RedemptionExpired    RedemptionStatus = "EXPIRED"
	RedemptionCancelled  RedemptionStatus = "CANCELLED"
)

const RedemptionPurpose = "AUTHORIZE_REDEMPTION"

type RedemptionChallenge struct {
	ID                        ID
	PassID                    ID
	ProviderID                ID
	OwnerWallet               WalletAddress
	Nonce                     ID
	Purpose                   string
	Network                   NimiqNetwork
	Environment               string
	ExpectedUsedSessions      int32
	ExpectedRemainingSessions int32
	Status                    RedemptionStatus
	CreatedAt                 time.Time
	ExpiresAt                 time.Time
	AuthorizedAt              *time.Time
	ConsumedAt                *time.Time
}

func NewRedemptionChallenge(id, nonce ID, pass Pass, providerID ID, now time.Time, ttl time.Duration) (RedemptionChallenge, error) {
	return NewBoundRedemptionChallenge(id, nonce, pass, providerID, NimiqTestnet, "test", now, ttl)
}

func NewBoundRedemptionChallenge(id, nonce ID, pass Pass, providerID ID, network NimiqNetwork, environment string, now time.Time, ttl time.Duration) (RedemptionChallenge, error) {
	for _, value := range []ID{id, nonce, providerID} {
		if _, err := ParseID(string(value)); err != nil {
			return RedemptionChallenge{}, err
		}
	}
	if ttl <= 0 || ttl > 5*time.Minute || now.IsZero() || pass.Status != PassActive || pass.RemainingSessions <= 0 ||
		pass.Snapshot.ProviderID != providerID || pass.OwnerWallet == "" {
		return RedemptionChallenge{}, errors.New("invalid redemption challenge context")
	}
	if network != NimiqMainnet && network != NimiqTestnet || environment == "" {
		return RedemptionChallenge{}, errors.New("invalid redemption challenge network context")
	}
	if pass.ExpiresAt != nil && !now.Add(ttl).Before(*pass.ExpiresAt) {
		return RedemptionChallenge{}, errors.New("redemption challenge exceeds pass expiration")
	}
	return RedemptionChallenge{
		ID: id, PassID: pass.ID, ProviderID: providerID, OwnerWallet: pass.OwnerWallet,
		Nonce: nonce, Purpose: RedemptionPurpose, Network: network, Environment: environment,
		ExpectedUsedSessions: pass.UsedSessions, ExpectedRemainingSessions: pass.RemainingSessions,
		Status: RedemptionCreated, CreatedAt: now.UTC(), ExpiresAt: now.UTC().Add(ttl),
	}, nil
}

// RedemptionSignatureVerifier is implemented by the application adapter around
// the same deterministic Nimiq verifier used by authentication.
type RedemptionSignatureVerifier interface {
	Verify(message []byte, expectedWallet WalletAddress, publicKey, signature []byte) error
}

func (r RedemptionChallenge) SigningMessage() []byte {
	return []byte(fmt.Sprintf("NIMPASS\nVersion: 1\nPurpose: %s\nChallenge: %s\nPass: %s\nProvider: %s\nWallet: %s\nNetwork: %s\nEnvironment: %s\nNonce: %s\nIssued-At: %s\nExpires-At: %s\nExpected-Used-Sessions: %d\nExpected-Remaining-Sessions: %d", r.Purpose, r.ID, r.PassID, r.ProviderID, r.OwnerWallet, r.Network, r.Environment, r.Nonce, r.CreatedAt.UTC().Format(time.RFC3339Nano), r.ExpiresAt.UTC().Format(time.RFC3339Nano), r.ExpectedUsedSessions, r.ExpectedRemainingSessions))
}

func (r *RedemptionChallenge) Authorize(verifier RedemptionSignatureVerifier, publicKey, signature []byte, now time.Time) error {
	if r.Status != RedemptionCreated {
		return errors.New("redemption challenge is not available for authorization")
	}
	if now.IsZero() || now.Before(r.CreatedAt) {
		return errors.New("invalid redemption authorization time")
	}
	if !now.Before(r.ExpiresAt) {
		r.Status = RedemptionExpired
		return errors.New("redemption challenge expired")
	}
	if verifier == nil || len(publicKey) == 0 || len(signature) == 0 {
		return errors.New("redemption signature verification is required")
	}
	if err := verifier.Verify(r.SigningMessage(), r.OwnerWallet, publicKey, signature); err != nil {
		return fmt.Errorf("redemption signature invalid: %w", err)
	}
	authorized := now.UTC()
	r.AuthorizedAt = &authorized
	r.Status = RedemptionAuthorized
	return nil
}

// Consume and the Pass update must be persisted in one PostgreSQL transaction
// with row locks and a unique redemption identity. This method only protects
// one in-memory aggregate and does not claim database concurrency safety.
func (r *RedemptionChallenge) Consume(pass *Pass, now time.Time) error {
	if r.Status != RedemptionAuthorized || r.ConsumedAt != nil {
		return errors.New("redemption challenge is not authorized or was already consumed")
	}
	if now.IsZero() || r.AuthorizedAt == nil || now.Before(*r.AuthorizedAt) {
		return errors.New("invalid redemption time")
	}
	if !now.Before(r.ExpiresAt) {
		r.Status = RedemptionExpired
		return errors.New("redemption challenge expired")
	}
	if pass == nil || pass.ID != r.PassID || pass.Snapshot.ProviderID != r.ProviderID || pass.OwnerWallet != r.OwnerWallet {
		return errors.New("redemption challenge does not match pass")
	}
	if int32(pass.UsedSessions) != r.ExpectedUsedSessions || int32(pass.RemainingSessions) != r.ExpectedRemainingSessions {
		return errors.New("redemption challenge is stale")
	}
	if err := pass.ConsumeSession(now); err != nil {
		return err
	}
	consumed := now.UTC()
	r.ConsumedAt = &consumed
	r.Status = RedemptionConsumed
	return nil
}
