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
	ErrPurchasedPassExpired       = errors.New("pass expired")
	ErrPurchasedPassCompleted     = errors.New("pass completed")
	ErrRedemptionChallengeExpired = errors.New("redemption challenge expired")
	ErrRedemptionConsumed         = errors.New("redemption already consumed")
	ErrRedemptionNotAuthorized    = errors.New("redemption is not authorized")
	ErrInvalidRedemptionSignature = errors.New("invalid redemption signature")
	ErrStaleRedemptionChallenge   = errors.New("stale redemption challenge")
)

type RedemptionView struct {
	Challenge     domain.RedemptionChallenge
	Pass          domain.PurchasedPass
	Redemption    domain.Redemption
	HasRedemption bool
	// Session is the pass session this redemption spent. Present only after a
	// successful authorization: the caller can then name which session moved
	// rather than only reporting that the count went down.
	Session     domain.PassSession
	HasSession  bool
	QRExpiresAt *time.Time
}

type RedemptionHistoryItem struct {
	RedemptionID   domain.ID
	ChallengeID    domain.ID
	PassID         domain.ID
	ProviderID     domain.ID
	ServiceID      domain.ID
	SourcePassID   domain.ID
	OwnerWallet    domain.WalletAddress
	SessionOrdinal domain.SessionCount
	ConsumedAt     time.Time
}

type RedemptionStore interface {
	CurrentChallenge(context.Context, domain.ID, domain.ID, domain.WalletAddress, time.Time) (RedemptionView, error)
	GetChallenge(context.Context, domain.ID, domain.ID, domain.WalletAddress) (RedemptionView, error)
	InsertChallenge(context.Context, domain.RedemptionChallenge, domain.ID, domain.WalletAddress, time.Time) (RedemptionView, error)
	AuthorizeAndConsume(context.Context, domain.ID, domain.ID, domain.WalletAddress, string, string, [32]byte, [32]byte, time.Time) (RedemptionView, error)
	ListPassHistory(context.Context, domain.ID, domain.ID, domain.WalletAddress) ([]RedemptionHistoryItem, error)
	ListProviderHistory(context.Context, domain.ID, domain.ID) ([]RedemptionHistoryItem, error)
	RecordEvent(context.Context, domain.ID, string, string, time.Time) error
}

type PassLookup interface {
	GetPass(context.Context, domain.ID, domain.ID) (domain.PurchasedPass, error)
}

type Redemptions struct {
	Store       RedemptionStore
	Passes      PassLookup
	Verifier    nimiq.SignatureVerifier
	Network     domain.NimiqNetwork
	Environment string
	Now         func() time.Time
}

// redemptionVerifier adapts the shared Nimiq verifier to the domain's
// interface, pinned to the signing scheme the authorising client named.
//
// The scheme is empty for a Mini App signature, which leaves the deployment's
// configured NIMIQ_SIGNING_SCHEME in force, and "hub" for one produced by the
// Nimiq Hub, whose envelope is documented. Exactly one preprocessor is applied
// per authorization; nothing is ever retried under a second scheme.
type redemptionVerifier struct {
	verifier nimiq.SignatureVerifier
	scheme   string
}

func (v redemptionVerifier) Verify(message []byte, wallet domain.WalletAddress, publicKey, signature []byte) error {
	if v.verifier == nil {
		return ErrInvalidRedemptionSignature
	}
	if err := v.verifier.VerifyAs(v.scheme, string(message), string(wallet), hex.EncodeToString(publicKey), hex.EncodeToString(signature)); err != nil {
		return ErrInvalidRedemptionSignature
	}
	return nil
}

func (s Redemptions) CreateChallenge(ctx context.Context, identity Identity, passID domain.ID) (RedemptionView, error) {
	now := s.Now().UTC()
	current, err := s.CurrentChallenge(ctx, identity, passID)
	if err == nil {
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
	if pass.Snapshot.Network != s.Network {
		return RedemptionView{}, ErrConflict
	}
	if pass.OwnerWallet != domain.WalletAddress(identity.Wallet) {
		return RedemptionView{}, ErrPassNotOwned
	}
	if pass.Status == domain.PurchasedPassCompleted || pass.RemainingSessions == 0 {
		return RedemptionView{}, ErrPurchasedPassCompleted
	}
	if pass.Status != domain.PurchasedPassActive {
		return RedemptionView{}, ErrPurchasedPassExpired
	}
	if pass.ExpiresAt != nil && !now.Before(*pass.ExpiresAt) {
		return RedemptionView{}, ErrPurchasedPassExpired
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
			return s.CurrentChallenge(ctx, identity, passID)
		}
		return RedemptionView{}, err
	}
	return view, nil
}

func (s Redemptions) GetChallenge(ctx context.Context, identity Identity, challengeID domain.ID) (RedemptionView, error) {
	view, err := s.Store.GetChallenge(ctx, challengeID, identity.ID, domain.WalletAddress(identity.Wallet))
	return s.checkedView(view, err)
}

// Authorize verifies the pass owner's signature over the challenge and spends
// one session.
//
// Nimpass used to split this in two: the owner authorized, and the provider
// later confirmed the resulting reference, which is where the session was
// actually consumed. That second step is gone. A pass is spent by the person
// who owns it, from their own account, and the wallet signature is what proves
// they meant it — so verification and consumption are one operation.
func (s Redemptions) Authorize(ctx context.Context, identity Identity, challengeID domain.ID, publicKeyHex, signatureHex, signingScheme string) (RedemptionView, error) {
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
	view, err := s.GetChallenge(ctx, identity, challengeID)
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
	if err := challenge.Authorize(redemptionVerifier{verifier: s.Verifier, scheme: signingScheme}, publicKey, signature, now); err != nil {
		_ = s.Store.RecordEvent(ctx, challengeID, "AUTHORIZATION_FAILED", "INVALID_SIGNATURE", now)
		if errors.Is(err, ErrInvalidRedemptionSignature) {
			return RedemptionView{}, ErrInvalidRedemptionSignature
		}
		if !now.Before(challenge.ExpiresAt) {
			return RedemptionView{}, ErrRedemptionChallengeExpired
		}
		return RedemptionView{}, ErrInvalidRedemptionSignature
	}
	// The signature is good, so the session is spent now. Authorizing and
	// consuming are one transaction in the store: the owner's proof is the
	// authority, and there is no second party whose confirmation it waits for
	// (docs/01-PRODUCT.md §24-§25).
	publicDigest := sha256.Sum256(publicKey)
	signatureDigest := sha256.Sum256(signature)
	return s.Store.AuthorizeAndConsume(ctx, challengeID, identity.ID, domain.WalletAddress(identity.Wallet), publicKeyHex, signatureHex, publicDigest, signatureDigest, now)
}

func (s Redemptions) PassHistory(ctx context.Context, identity Identity, passID domain.ID) ([]RedemptionHistoryItem, error) {
	return s.Store.ListPassHistory(ctx, passID, identity.ID, domain.WalletAddress(identity.Wallet))
}

func (s Redemptions) ProviderHistory(ctx context.Context, identity Identity, providerID domain.ID) ([]RedemptionHistoryItem, error) {
	return s.Store.ListProviderHistory(ctx, providerID, identity.ID)
}

func (s Redemptions) checkedView(view RedemptionView, err error) (RedemptionView, error) {
	if err != nil {
		return RedemptionView{}, err
	}
	if view.Challenge.Network != s.Network || view.Challenge.Environment != s.Environment {
		return RedemptionView{}, ErrConflict
	}
	return view, nil
}
func (s Redemptions) CurrentChallenge(ctx context.Context, identity Identity, passID domain.ID) (RedemptionView, error) {
	view, err := s.Store.CurrentChallenge(ctx, passID, identity.ID, domain.WalletAddress(identity.Wallet), s.Now().UTC())
	return s.checkedView(view, err)
}
