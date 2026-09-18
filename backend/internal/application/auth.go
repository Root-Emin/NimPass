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
	ErrPurchaseCutoff   = errors.New("pass purchase cutoff reached")
	// ErrSelfPurchase refuses a provider buying their own product.
	//
	// Decided at the repository, against `providers.owner_identity_id` read
	// under the same lock as the price and the payout wallet — not against
	// anything the client sent, and not only in the browser. A crafted
	// POST /purchases is refused exactly as a tapped Buy button is.
	ErrSelfPurchase = errors.New("a provider cannot purchase their own pass")
	// ErrPassUnavailable refuses a purchase of a Pass that is not on sale —
	// withdrawn from the listing, never published, or archived.
	//
	// It wraps ErrConflict rather than replacing it. The HTTP answer has always
	// been 409 and stays 409; what this adds is the ability to say *which* 409,
	// so the customer reads "no longer available for purchase" instead of a
	// generic payment-state conflict. Every existing `errors.Is(err,
	// ErrConflict)` caller keeps matching.
	//
	// The case it exists for is the stale tab: the Pass was on Discover when the
	// page rendered, the provider withdrew it, and Buy is pressed against a
	// screen that is no longer true. The intent is refused here, before any
	// money can move (docs/09-SECURITY.md §11, §37).
	ErrPassUnavailable = fmt.Errorf("%w: pass is not available for purchase", ErrConflict)
	// ErrPassAlreadyOwned refuses a second purchase of a Pass the customer is
	// still holding.
	//
	// `01-PRODUCT.md §56` and `02-USER-FLOWS.md §70` describe repurchase as the
	// end of the loop — Purchase → Consume → Complete → Repurchase — and Buy
	// Again as the control that starts it. Nothing in that loop asks for two
	// live passes for the same Pass at once, and a customer who ends up with
	// two has paid twice for one entitlement: the sessions do not merge, the
	// pass screen shows one of them, and the second is money spent on a record
	// they did not mean to create.
	//
	// So the refusal is scoped to exactly that: an ACTIVE pass with sessions
	// left on it and its expiration still ahead. A completed pass (`Buy Again`),
	// an expired one and a cancelled one all leave the customer free to buy
	// again, on the current terms, which is the documented behaviour and is not
	// changed by this.
	//
	// It wraps ErrConflict like ErrPassUnavailable does, so every existing
	// `errors.Is(err, ErrConflict)` caller keeps matching and the HTTP answer
	// stays 409 — what it adds is the ability to say which 409 it is.
	ErrPassAlreadyOwned = fmt.Errorf("%w: this pass is already owned", ErrConflict)
	// ErrPurchaseInSettlement refuses a new intent while the customer's last
	// one for the same Pass can still be paid.
	//
	// An intent is payable for longer than it is current. Its 30-minute TTL is
	// when the customer is asked to have paid; `PurchaseSettlementGrace` is how
	// much longer the backend keeps accepting the answer — `Submit` takes a
	// hash inside it, `DueDiscoveryAddresses` keeps sweeping the payout address
	// inside it, and `validateEvidence` allows a report inside it. All three
	// exist so a QR payment made in time but noticed late settles rather than
	// failing with the money already moved.
	//
	// The reuse predicate in `Create` used the shorter clock, so for those five
	// minutes a customer could hold one intent that could still buy the Pass
	// and be issued a second one that also could. Paying both is two payments
	// for one entitlement, and both settle: the guards against a double
	// purchase are per intent, and these are two.
	//
	// So the blocking window is now the payable window, exactly. It refuses
	// rather than reusing because an expired intent cannot start a payment —
	// `BeginWalletAttempt` requires `now < expires_at` — and handing one back
	// would give the customer a checkout that silently does nothing.
	//
	// It clears by itself. Once the grace is over the old intent can settle
	// nothing, and the next request creates a new one.
	ErrPurchaseInSettlement = fmt.Errorf("%w: a previous attempt for this pass is still settling", ErrConflict)
	ErrTooManyAttempts      = errors.New("too many attempts")
	ErrValidation           = errors.New("validation failed")
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
	// OnProofMismatch observes a signature this deployment rejected, so a
	// development build can capture the proof material a real wallet produced.
	// It is nil outside development, it is called only after verification has
	// already failed, and its return value is ignored: it cannot admit a proof,
	// change the scheme in force, or keep a challenge alive. Verification stays
	// exactly one preprocessor per proof (see nimiq.Ed25519Verifier.VerifyAs).
	OnProofMismatch func(message string, p Proof)
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
	ChallengeID domain.ID
	Wallet      string
	PublicKey   string
	Signature   string
	// SigningScheme names the documented preprocessing the wallet applied
	// before signing, or is empty to use the deployment's configured scheme.
	// See nimiq.Ed25519Verifier.VerifyAs for why a proof carries this and why
	// it cannot widen what a signature authorises.
	SigningScheme  string
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
		// Same rejection, different cause: the proof names a wallet the
		// challenge was not issued to. It reaches the observer too, so a
		// capture can tell a wrong wallet apart from a wrong scheme instead of
		// leaving both as one opaque "invalid signature".
		if a.OnProofMismatch != nil {
			a.OnProofMismatch(c.Message(), p)
		}
		_ = a.Store.RecordChallengeFailure(ctx, c.ID)
		return Challenge{}, ErrInvalidSignature
	}
	if err := a.Verifier.VerifyAs(p.SigningScheme, c.Message(), c.Wallet, p.PublicKey, p.Signature); err != nil {
		// A rejected signature is the only symptom a wallet whose preprocessing
		// we have not settled can produce, and the proof material is gone the
		// moment this returns. Hand it to the development-only observer first
		// so cmd/verify-sign-fixture can name the scheme offline. The proof is
		// still rejected: nothing below this line depends on the observer.
		if a.OnProofMismatch != nil {
			a.OnProofMismatch(c.Message(), p)
		}
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
	// Both proofs come from the same wallet transport in one ceremony, so the
	// scheme the request named applies to both.
	if err := a.Verifier.VerifyAs(p.SigningScheme, c.Message(), actor.Wallet, p.OwnerPublicKey, p.OwnerSignature); err != nil {
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
