package application

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

const (
	AuthLogin            = "AUTH_LOGIN"
	VerifyProviderWallet = "VERIFY_PROVIDER_WALLET"
	ChallengeTTL         = 5 * time.Minute
	SessionTTL           = 24 * time.Hour
)

var (
	ErrNotFound         = errors.New("not found")
	ErrConsumed         = errors.New("challenge consumed")
	ErrExpired          = errors.New("challenge expired")
	ErrInvalidSignature = errors.New("invalid signature")
	ErrForbidden        = errors.New("forbidden")
	ErrConflict         = errors.New("conflict")
	ErrPurchaseCutoff   = errors.New("package purchase cutoff reached")
	ErrTooManyAttempts  = errors.New("too many attempts")
	ErrValidation       = errors.New("validation failed")
)

type Challenge struct {
	ID             domain.ID
	Purpose        string
	Wallet         string
	ProviderID     domain.ID
	Nonce          string
	Network        string
	Environment    string
	IssuedAt       time.Time
	ExpiresAt      time.Time
	ConsumedAt     *time.Time
	FailedAttempts int
}

func (c Challenge) Message() string {
	return fmt.Sprintf("NIMPASS\nVersion: 1\nPurpose: %s\nChallenge: %s\nNonce: %s\nWallet: %s\nProvider: %s\nNetwork: %s\nEnvironment: %s\nIssued-At: %s\nExpires-At: %s", c.Purpose, c.ID, c.Nonce, c.Wallet, c.ProviderID, c.Network, c.Environment, c.IssuedAt.UTC().Format(time.RFC3339Nano), c.ExpiresAt.UTC().Format(time.RFC3339Nano))
}

type Identity struct {
	ID        domain.ID
	Wallet    string
	CreatedAt time.Time
}

type Session struct {
	ID         domain.ID
	Identity   Identity
	CreatedAt  time.Time
	ExpiresAt  time.Time
	LastUsedAt time.Time
	RevokedAt  *time.Time
	CSRFDigest [32]byte
}

type AuthStore interface {
	InsertChallenge(context.Context, Challenge) error
	GetChallenge(context.Context, domain.ID) (Challenge, error)
	RecordChallengeFailure(context.Context, domain.ID) error
	CompleteLogin(context.Context, domain.ID, string, [32]byte, [32]byte, domain.ID, time.Time, time.Time) (Session, error)
	CompletePayout(context.Context, domain.ID, domain.ID, domain.ID, string, time.Time) error
	FindSession(context.Context, [32]byte, time.Time) (Session, error)
	RevokeSession(context.Context, domain.ID, time.Time) error
}

type Auth struct {
	Store       AuthStore
	Verifier    nimiq.SignatureVerifier
	Network     string
	Environment string
	Now         func() time.Time
}

func (a Auth) NewChallenge(ctx context.Context, purpose, wallet string, providerID domain.ID) (Challenge, error) {
	if purpose != AuthLogin && purpose != VerifyProviderWallet {
		return Challenge{}, ErrForbidden
	}
	if (purpose == AuthLogin && providerID != "") || (purpose == VerifyProviderWallet && providerID == "") {
		return Challenge{}, ErrForbidden
	}
	wallet, err := nimiq.ValidateAddress(wallet)
	if err != nil {
		return Challenge{}, err
	}
	id, err := domain.NewID()
	if err != nil {
		return Challenge{}, err
	}
	nonce, err := randomHex(32)
	if err != nil {
		return Challenge{}, err
	}
	now := a.Now().UTC().Truncate(time.Microsecond)
	c := Challenge{ID: id, Purpose: purpose, Wallet: wallet, ProviderID: providerID, Nonce: nonce, Network: a.Network, Environment: a.Environment, IssuedAt: now, ExpiresAt: now.Add(ChallengeTTL)}
	return c, a.Store.InsertChallenge(ctx, c)
}

type Proof struct {
	ChallengeID    domain.ID
	Wallet         string
	PublicKey      string
	Signature      string
	OwnerPublicKey string
	OwnerSignature string
}

func (a Auth) validateProof(ctx context.Context, p Proof, purpose string, providerID domain.ID) (Challenge, error) {
	c, err := a.Store.GetChallenge(ctx, p.ChallengeID)
	if err != nil {
		return Challenge{}, err
	}
	if c.Purpose != purpose || c.ProviderID != providerID || c.Network != a.Network || c.Environment != a.Environment {
		return Challenge{}, ErrForbidden
	}
	if c.ConsumedAt != nil {
		return Challenge{}, ErrConsumed
	}
	if !a.Now().Before(c.ExpiresAt) {
		return Challenge{}, ErrExpired
	}
	if c.FailedAttempts >= 5 {
		return Challenge{}, ErrTooManyAttempts
	}
	wallet, err := nimiq.ValidateAddress(p.Wallet)
	if err != nil || wallet != c.Wallet {
		_ = a.Store.RecordChallengeFailure(ctx, c.ID)
		return Challenge{}, ErrInvalidSignature
	}
	if err := a.Verifier.Verify(c.Message(), c.Wallet, p.PublicKey, p.Signature); err != nil {
		_ = a.Store.RecordChallengeFailure(ctx, c.ID)
		return Challenge{}, ErrInvalidSignature
	}
	return c, nil
}

func (a Auth) Login(ctx context.Context, p Proof) (Session, string, string, error) {
	c, err := a.validateProof(ctx, p, AuthLogin, "")
	if err != nil {
		return Session{}, "", "", err
	}
	token, err := randomHex(32)
	if err != nil {
		return Session{}, "", "", err
	}
	csrf := CSRFToken(token)
	id, err := domain.NewID()
	if err != nil {
		return Session{}, "", "", err
	}
	now := a.Now().UTC()
	session, err := a.Store.CompleteLogin(ctx, c.ID, c.Wallet, sha256.Sum256([]byte(token)), sha256.Sum256([]byte(csrf)), id, now, now.Add(SessionTTL))
	return session, token, csrf, err
}

func CSRFToken(sessionToken string) string {
	digest := sha256.Sum256([]byte("NIMPASS-CSRF-v1:" + sessionToken))
	return hex.EncodeToString(digest[:])
}

func (a Auth) VerifyPayout(ctx context.Context, actor Identity, providerID domain.ID, p Proof) error {
	c, err := a.validateProof(ctx, p, VerifyProviderWallet, providerID)
	if err != nil {
		return err
	}
	// A stolen session plus the attacker's payout-wallet signature must not be
	// enough to redirect payments. Require a fresh signature by the login wallet.
	if err := a.Verifier.Verify(c.Message(), actor.Wallet, p.OwnerPublicKey, p.OwnerSignature); err != nil {
		_ = a.Store.RecordChallengeFailure(ctx, c.ID)
		return ErrInvalidSignature
	}
	return a.Store.CompletePayout(ctx, c.ID, providerID, actor.ID, c.Wallet, a.Now().UTC())
}

func (a Auth) Authenticate(ctx context.Context, token string) (Session, error) {
	if len(token) != 64 {
		return Session{}, ErrForbidden
	}
	if _, err := hex.DecodeString(token); err != nil {
		return Session{}, ErrForbidden
	}
	return a.Store.FindSession(ctx, sha256.Sum256([]byte(token)), a.Now().UTC())
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
