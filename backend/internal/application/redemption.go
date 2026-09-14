package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

const RedemptionChallengeTTL = 5 * time.Minute

var (
	ErrPassNotFound               = errors.New("pass not found")
	ErrPassNotOwned               = errors.New("pass is not owned by customer")
	ErrPassExpired                = errors.New("pass expired")
	ErrPassCompleted              = errors.New("pass completed")
	ErrRedemptionChallengeExpired = errors.New("redemption challenge expired")
	ErrRedemptionConsumed         = errors.New("redemption already consumed")
	ErrRedemptionNotAuthorized    = errors.New("redemption is not authorized")
	ErrInvalidRedemptionSignature = errors.New("invalid redemption signature")
	ErrStaleRedemptionChallenge   = errors.New("stale redemption challenge")
	ErrInvalidRedemptionToken     = errors.New("invalid redemption token")
)

type RedemptionView struct {
	Challenge     domain.RedemptionChallenge
	Pass          domain.Pass
	Redemption    domain.Redemption
	HasRedemption bool
	QRReference   string
	QRExpiresAt   *time.Time
}

type RedemptionHistoryItem struct {
	RedemptionID   domain.ID
	ChallengeID    domain.ID
	PassID         domain.ID
	ProviderID     domain.ID
	ServiceID      domain.ID
	PackageID      domain.ID
	OwnerWallet    domain.WalletAddress
	SessionOrdinal domain.SessionCount
	ConsumedAt     time.Time
}

type RedemptionLookup struct {
	ChallengeID         domain.ID
	PassID              domain.ID
	ProviderID          domain.ID
	ServiceName         string
	PackageTitle        string
	ChallengeStatus     domain.RedemptionStatus
	AuthorizationStatus domain.RedemptionStatus
	PassStatus          domain.PassStatus
	UsedSessions        int32
	RemainingSessions   int32
	NextSessionOrdinal  domain.SessionCount
	PassExpiresAt       *time.Time
	ChallengeExpiresAt  time.Time
	ReferenceExpiresAt  *time.Time
}

type RedemptionStore interface {
	CurrentChallenge(context.Context, domain.ID, domain.ID, domain.WalletAddress, time.Time) (RedemptionView, error)
	GetChallenge(context.Context, domain.ID, domain.ID, domain.WalletAddress) (RedemptionView, error)
	LookupRedemption(context.Context, domain.ID, domain.ID, string) (RedemptionView, error)
	InsertChallenge(context.Context, domain.RedemptionChallenge, domain.ID, domain.WalletAddress, time.Time) (RedemptionView, error)
	AuthorizeChallenge(context.Context, domain.ID, domain.ID, domain.WalletAddress, string, string, string, [32]byte, [32]byte, [32]byte, time.Time) (RedemptionView, error)
	RotateToken(context.Context, domain.ID, domain.ID, domain.WalletAddress, [32]byte, string, time.Time) (RedemptionView, error)
	ConfirmRedemption(context.Context, domain.ID, domain.ID, string, time.Time) (RedemptionView, error)
	ListPassHistory(context.Context, domain.ID, domain.ID, domain.WalletAddress) ([]RedemptionHistoryItem, error)
	ListProviderHistory(context.Context, domain.ID, domain.ID) ([]RedemptionHistoryItem, error)
	RecordEvent(context.Context, domain.ID, string, string, time.Time) error
}

type PassLookup interface {
	GetPass(context.Context, domain.ID, domain.ID) (domain.Pass, error)
}

type Redemptions struct {
	Store       RedemptionStore
	Passes      PassLookup
	Verifier    nimiq.SignatureVerifier
	Network     domain.NimiqNetwork
	Environment string
	Now         func() time.Time
}

type redemptionVerifier struct{ verifier nimiq.SignatureVerifier }

func (v redemptionVerifier) Verify(message []byte, wallet domain.WalletAddress, publicKey, signature []byte) error {
	if v.verifier == nil {
		return ErrInvalidRedemptionSignature
	}
	if err := v.verifier.Verify(string(message), string(wallet), hex.EncodeToString(publicKey), hex.EncodeToString(signature)); err != nil {
		return ErrInvalidRedemptionSignature
	}
	return nil
}

func (s Redemptions) CreateChallenge(ctx context.Context, identity Identity, passID domain.ID) (RedemptionView, error) {
	now := s.Now().UTC()
	current, err := s.Store.CurrentChallenge(ctx, passID, identity.ID, domain.WalletAddress(identity.Wallet), now)
	if err == nil {
		if current.Challenge.Status == domain.RedemptionAuthorized {
			return s.rotate(ctx, identity, current, now)
		}
		return current, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return RedemptionView{}, err
	}
	pass, err := s.Passes.GetPass(ctx, passID, identity.ID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return RedemptionView{}, ErrPassNotFound
		}
		return RedemptionView{}, err
	}
	if pass.OwnerWallet != domain.WalletAddress(identity.Wallet) {
		return RedemptionView{}, ErrPassNotOwned
	}
	if pass.Status == domain.PassCompleted || pass.RemainingSessions == 0 {
		return RedemptionView{}, ErrPassCompleted
	}
	if pass.Status != domain.PassActive {
		return RedemptionView{}, ErrPassExpired
	}
	if pass.ExpiresAt != nil && !now.Before(*pass.ExpiresAt) {
		return RedemptionView{}, ErrPassExpired
	}
	id, err := domain.NewID()
	if err != nil {
		return RedemptionView{}, err
	}
	nonce, err := domain.NewID()
	if err != nil {
		return RedemptionView{}, err
	}
	challenge, err := domain.NewBoundRedemptionChallenge(id, nonce, pass, pass.Snapshot.ProviderID, s.Network, s.Environment, now, RedemptionChallengeTTL)
	if err != nil {
		return RedemptionView{}, ErrConflict
	}
	view, err := s.Store.InsertChallenge(ctx, challenge, identity.ID, domain.WalletAddress(identity.Wallet), now)
	if err != nil {
		if errors.Is(err, ErrConflict) {
			return s.Store.CurrentChallenge(ctx, passID, identity.ID, domain.WalletAddress(identity.Wallet), now)
		}
		return RedemptionView{}, err
	}
	return view, nil
}

func (s Redemptions) rotate(ctx context.Context, identity Identity, current RedemptionView, now time.Time) (RedemptionView, error) {
	raw, digest, err := newRedemptionToken()
	if err != nil {
		return RedemptionView{}, err
	}
	return s.Store.RotateToken(ctx, current.Challenge.ID, identity.ID, domain.WalletAddress(identity.Wallet), digest, raw, now)
}

func (s Redemptions) GetChallenge(ctx context.Context, identity Identity, challengeID domain.ID) (RedemptionView, error) {
	return s.Store.GetChallenge(ctx, challengeID, identity.ID, domain.WalletAddress(identity.Wallet))
}

func (s Redemptions) Lookup(ctx context.Context, identity Identity, providerID domain.ID, reference string) (RedemptionLookup, error) {
	rawToken, err := parseRedemptionReference(reference)
	if err != nil {
		return RedemptionLookup{}, err
	}
	view, err := s.Store.LookupRedemption(ctx, providerID, identity.ID, rawToken)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return RedemptionLookup{}, ErrInvalidRedemptionToken
		}
		return RedemptionLookup{}, err
	}
	now := s.Now().UTC()
	if view.Challenge.Status == domain.RedemptionConsumed || view.HasRedemption {
		return RedemptionLookup{}, ErrRedemptionConsumed
	}
	if view.Challenge.Status != domain.RedemptionAuthorized {
		return RedemptionLookup{}, ErrRedemptionNotAuthorized
	}
	if !now.Before(view.Challenge.ExpiresAt) || view.QRExpiresAt != nil && !now.Before(*view.QRExpiresAt) {
		return RedemptionLookup{}, ErrRedemptionChallengeExpired
	}
	if view.Pass.Status == domain.PassCompleted || view.Pass.RemainingSessions == 0 {
		return RedemptionLookup{}, ErrPassCompleted
	}
	if view.Pass.Status != domain.PassActive || view.Pass.ExpiresAt != nil && !now.Before(*view.Pass.ExpiresAt) {
		return RedemptionLookup{}, ErrPassExpired
	}
	if int32(view.Pass.UsedSessions) != view.Challenge.ExpectedUsedSessions || int32(view.Pass.RemainingSessions) != view.Challenge.ExpectedRemainingSessions {
		return RedemptionLookup{}, ErrStaleRedemptionChallenge
	}
	return RedemptionLookup{
		ChallengeID:         view.Challenge.ID,
		PassID:              view.Pass.ID,
		ProviderID:          view.Challenge.ProviderID,
		ServiceName:         view.Pass.Snapshot.ServiceName,
		PackageTitle:        view.Pass.Snapshot.PackageTitle,
		ChallengeStatus:     view.Challenge.Status,
		AuthorizationStatus: view.Challenge.Status,
		PassStatus:          view.Pass.Status,
		UsedSessions:        view.Pass.UsedSessions,
		RemainingSessions:   view.Pass.RemainingSessions,
		NextSessionOrdinal:  domain.SessionCount(view.Pass.UsedSessions + 1),
		PassExpiresAt:       view.Pass.ExpiresAt,
		ChallengeExpiresAt:  view.Challenge.ExpiresAt,
		ReferenceExpiresAt:  view.QRExpiresAt,
	}, nil
}

func (s Redemptions) Authorize(ctx context.Context, identity Identity, challengeID domain.ID, publicKeyHex, signatureHex string) (RedemptionView, error) {
	publicKeyHex = strings.TrimSpace(publicKeyHex)
	signatureHex = strings.TrimSpace(signatureHex)
	publicKey, err := hex.DecodeString(publicKeyHex)
	if err != nil || len(publicKey) != 32 {
		return RedemptionView{}, ErrInvalidRedemptionSignature
	}
	signature, err := hex.DecodeString(signatureHex)
	if err != nil || len(signature) != 64 {
		return RedemptionView{}, ErrInvalidRedemptionSignature
	}
	view, err := s.Store.GetChallenge(ctx, challengeID, identity.ID, domain.WalletAddress(identity.Wallet))
	if err != nil {
		return RedemptionView{}, err
	}
	now := s.Now().UTC()
	challenge := view.Challenge
	if challenge.Status != domain.RedemptionCreated {
		if !now.Before(challenge.ExpiresAt) {
			return RedemptionView{}, ErrRedemptionChallengeExpired
		}
		return RedemptionView{}, ErrConflict
	}
	if err := challenge.Authorize(redemptionVerifier{s.Verifier}, publicKey, signature, now); err != nil {
		_ = s.Store.RecordEvent(ctx, challengeID, "AUTHORIZATION_FAILED", "INVALID_SIGNATURE", now)
		if errors.Is(err, ErrInvalidRedemptionSignature) {
			return RedemptionView{}, ErrInvalidRedemptionSignature
		}
		if !now.Before(challenge.ExpiresAt) {
			return RedemptionView{}, ErrRedemptionChallengeExpired
		}
		return RedemptionView{}, ErrInvalidRedemptionSignature
	}
	raw, tokenDigest, err := newRedemptionToken()
	if err != nil {
		return RedemptionView{}, err
	}
	publicDigest := sha256.Sum256(publicKey)
	signatureDigest := sha256.Sum256(signature)
	view, err = s.Store.AuthorizeChallenge(ctx, challengeID, identity.ID, domain.WalletAddress(identity.Wallet), publicKeyHex, signatureHex, raw, publicDigest, signatureDigest, tokenDigest, now)
	if err != nil {
		return RedemptionView{}, err
	}
	view.QRReference = "NR1:" + raw
	return view, nil
}

func (s Redemptions) Confirm(ctx context.Context, identity Identity, providerID domain.ID, reference string) (RedemptionView, error) {
	rawToken, err := parseRedemptionReference(reference)
	if err != nil {
		return RedemptionView{}, ErrInvalidRedemptionToken
	}
	return s.Store.ConfirmRedemption(ctx, providerID, identity.ID, rawToken, s.Now().UTC())
}

func (s Redemptions) PassHistory(ctx context.Context, identity Identity, passID domain.ID) ([]RedemptionHistoryItem, error) {
	return s.Store.ListPassHistory(ctx, passID, identity.ID, domain.WalletAddress(identity.Wallet))
}

func (s Redemptions) ProviderHistory(ctx context.Context, identity Identity, providerID domain.ID) ([]RedemptionHistoryItem, error) {
	return s.Store.ListProviderHistory(ctx, providerID, identity.ID)
}

func newRedemptionToken() (string, [32]byte, error) {
	raw, err := randomHex(32)
	if err != nil {
		return "", [32]byte{}, err
	}
	return raw, sha256.Sum256([]byte(raw)), nil
}

func parseRedemptionReference(reference string) (string, error) {
	if !strings.HasPrefix(reference, "NR1:") || len(reference) != 4+64 {
		return "", ErrInvalidRedemptionToken
	}
	rawToken := reference[4:]
	if _, err := hex.DecodeString(rawToken); err != nil {
		return "", ErrInvalidRedemptionToken
	}
	return rawToken, nil
}
