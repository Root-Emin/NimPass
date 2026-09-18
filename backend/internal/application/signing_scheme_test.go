package application

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// One deployment, two wallet surfaces.
//
// Nimpass reaches a wallet through the Nimiq Pay Mini App provider or through
// the Nimiq Hub, and the two preprocess the message differently before signing
// it. The Hub documents its envelope; the Mini App host documents nothing and
// stays on the configured NIMIQ_SIGNING_SCHEME. So a proof may name the scheme
// that produced it.
//
// The tests below pin both halves of that: a Hub proof authenticates on a
// raw-configured deployment, and naming a scheme still admits exactly one
// signature over exactly one server-issued challenge.

type schemeStore struct {
	challenge  Challenge
	failures   int
	consumedAt *time.Time
}

func (s *schemeStore) InsertChallenge(context.Context, Challenge) error { return nil }

func (s *schemeStore) GetChallenge(context.Context, domain.ID) (Challenge, error) {
	c := s.challenge
	c.FailedAttempts = s.failures
	c.ConsumedAt = s.consumedAt
	return c, nil
}

func (s *schemeStore) RecordChallengeFailure(context.Context, domain.ID) error {
	s.failures++
	return nil
}

func (s *schemeStore) CompleteLogin(_ context.Context, challengeID domain.ID, wallet string, _, csrf [32]byte, sessionID domain.ID, now, expires time.Time) (Session, error) {
	consumed := now
	s.consumedAt = &consumed
	return Session{
		ID:         sessionID,
		Identity:   Identity{ID: challengeID, Wallet: wallet, CreatedAt: now},
		CreatedAt:  now,
		ExpiresAt:  expires,
		LastUsedAt: now,
		CSRFDigest: csrf,
	}, nil
}

func (s *schemeStore) CompletePayout(context.Context, domain.ID, domain.ID, domain.ID, string, time.Time) error {
	return nil
}

func (s *schemeStore) FindSession(context.Context, [32]byte, time.Time) (Session, error) {
	return Session{}, ErrNotFound
}

func (s *schemeStore) RevokeSession(context.Context, domain.ID, time.Time) error { return nil }

func schemeFixture(t *testing.T) (*schemeStore, Auth, string, string, ed25519.PrivateKey) {
	t.Helper()
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	wallet, err := nimiq.AddressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	id := domain.ID("00000000-0000-4000-8000-000000000001")
	store := &schemeStore{challenge: Challenge{
		ID: id, Purpose: AuthLogin, Wallet: wallet, Nonce: string(id),
		Network: "TESTNET", Environment: "test",
		IssuedAt: now, ExpiresAt: now.Add(ChallengeTTL),
	}}
	// A deployment configured for the Mini App's unproven "raw" scheme, which
	// is the default `NIMIQ_SIGNING_SCHEME` ships with.
	auth := Auth{
		Store:       store,
		Verifier:    nimiq.Ed25519Verifier{Preprocess: nimiq.RawMessage},
		Network:     "TESTNET",
		Environment: "test",
		Now:         func() time.Time { return now },
	}
	return store, auth, wallet, hex.EncodeToString(pub), key
}

func TestHubProofAuthenticatesOnARawConfiguredDeployment(t *testing.T) {
	store, auth, wallet, publicKey, key := schemeFixture(t)
	message := store.challenge.Message()

	// Exactly what @nimiq/hub-api's signMessage() produces.
	signature := hex.EncodeToString(ed25519.Sign(key, nimiq.HubSignedMessage(message)))

	session, _, _, err := auth.Login(context.Background(), Proof{
		ChallengeID:   store.challenge.ID,
		Wallet:        wallet,
		PublicKey:     publicKey,
		Signature:     signature,
		SigningScheme: "hub",
	})
	if err != nil {
		t.Fatalf("hub proof rejected: %v", err)
	}
	if session.Identity.Wallet != wallet {
		t.Fatalf("session bound to %q, want %q", session.Identity.Wallet, wallet)
	}
	// The challenge is still single-use: the Hub path changes nothing about the
	// lifecycle (docs/09-SECURITY.md §17).
	if store.consumedAt == nil {
		t.Fatal("challenge was not consumed")
	}
}

func TestMiniAppProofStillUsesTheConfiguredScheme(t *testing.T) {
	store, auth, wallet, publicKey, key := schemeFixture(t)
	message := store.challenge.Message()

	// A Mini App proof names nothing, so the deployment default applies —
	// byte-identical to the behaviour before a scheme could be named at all.
	signature := hex.EncodeToString(ed25519.Sign(key, nimiq.RawMessage(message)))

	if _, _, _, err := auth.Login(context.Background(), Proof{
		ChallengeID: store.challenge.ID,
		Wallet:      wallet,
		PublicKey:   publicKey,
		Signature:   signature,
	}); err != nil {
		t.Fatalf("mini app proof rejected: %v", err)
	}
}

func TestNamingASchemeAdmitsOnlyThatScheme(t *testing.T) {
	store, auth, wallet, publicKey, key := schemeFixture(t)
	message := store.challenge.Message()
	rawSignature := hex.EncodeToString(ed25519.Sign(key, nimiq.RawMessage(message)))

	// Claiming "hub" over a raw signature fails. A proof chooses which of two
	// transforms of one message it claims, never which message — and only the
	// claimed transform is tried.
	if _, _, _, err := auth.Login(context.Background(), Proof{
		ChallengeID:   store.challenge.ID,
		Wallet:        wallet,
		PublicKey:     publicKey,
		Signature:     rawSignature,
		SigningScheme: "hub",
	}); !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("mismatched scheme accepted: %v", err)
	}
	if store.failures != 1 {
		t.Fatalf("failed attempt not recorded: %d", store.failures)
	}

	// An unknown scheme is refused rather than quietly falling back.
	if _, _, _, err := auth.Login(context.Background(), Proof{
		ChallengeID:   store.challenge.ID,
		Wallet:        wallet,
		PublicKey:     publicKey,
		Signature:     rawSignature,
		SigningScheme: "auto",
	}); !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("unknown scheme accepted: %v", err)
	}
}

func TestNamingASchemeCannotSubstituteAnotherWallet(t *testing.T) {
	store, auth, wallet, _, _ := schemeFixture(t)
	message := store.challenge.Message()

	// The attacker controls their own wallet and signs the victim's challenge
	// under the Hub envelope. The backend derives the signer from the public
	// key and requires it to match the challenge (docs/09-SECURITY.md §19); the
	// scheme has no bearing on that.
	attackerPub, attackerKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signature := hex.EncodeToString(ed25519.Sign(attackerKey, nimiq.HubSignedMessage(message)))

	if _, _, _, err := auth.Login(context.Background(), Proof{
		ChallengeID:   store.challenge.ID,
		Wallet:        wallet,
		PublicKey:     hex.EncodeToString(attackerPub),
		Signature:     signature,
		SigningScheme: "hub",
	}); !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("foreign signer accepted: %v", err)
	}
}

func TestRedemptionAuthorizationHonoursTheNamedScheme(t *testing.T) {
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	wallet, err := nimiq.AddressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	id := domain.ID("00000000-0000-4000-8000-000000000001")
	challenge := domain.RedemptionChallenge{
		ID: id, Nonce: id, PassID: id, ProviderID: id,
		OwnerWallet: domain.WalletAddress(wallet), Purpose: domain.RedemptionPurpose,
		Network: domain.NimiqTestnet, Environment: "test",
		Status: domain.RedemptionCreated, CreatedAt: now, ExpiresAt: now.Add(time.Minute),
	}
	message := challenge.SigningMessage()
	// A desktop customer authorises a redemption through the Hub.
	signature := ed25519.Sign(key, nimiq.HubSignedMessage(string(message)))
	raw := nimiq.Ed25519Verifier{Preprocess: nimiq.RawMessage}

	authorized := challenge
	if err := authorized.Authorize(redemptionVerifier{verifier: raw, scheme: "hub"}, pub, signature, now); err != nil {
		t.Fatalf("hub redemption signature rejected: %v", err)
	}
	if authorized.Status != domain.RedemptionAuthorized {
		t.Fatalf("status %q after authorization", authorized.Status)
	}

	// And the scheme cannot stand in for the rest of the model: the same
	// signature under the deployment default is still refused.
	rejected := challenge
	if err := rejected.Authorize(redemptionVerifier{verifier: raw, scheme: ""}, pub, signature, now); err == nil {
		t.Fatal("envelope signature accepted under the raw default")
	}
}

// A wallet whose preprocessing this deployment does not implement produces the
// same "invalid signature" as a forgery, and the proof material is discarded
// with the request. OnProofMismatch is how a development build keeps it long
// enough for cmd/verify-sign-fixture to name the scheme — without giving the
// rejected proof any influence over the outcome.
func TestProofMismatchIsObservedWithoutAdmittingTheProof(t *testing.T) {
	store, auth, wallet, publicKey, key := schemeFixture(t)
	message := store.challenge.Message()

	var observedMessage string
	var observed int
	auth.OnProofMismatch = func(m string, p Proof) {
		observed++
		observedMessage = m
		if p.PublicKey != publicKey {
			t.Errorf("observer saw public key %q, want %q", p.PublicKey, publicKey)
		}
	}

	// A Hub-enveloped signature arriving with no named scheme: the deployment
	// verifies it as raw and refuses it. This is exactly the shape of a real
	// wallet whose preprocessing is not the configured one.
	signature := hex.EncodeToString(ed25519.Sign(key, nimiq.HubSignedMessage(message)))

	_, _, _, err := auth.Login(context.Background(), Proof{
		ChallengeID: store.challenge.ID,
		Wallet:      wallet,
		PublicKey:   publicKey,
		Signature:   signature,
	})
	if !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("login error = %v, want ErrInvalidSignature", err)
	}
	// Observed once, with the server's own challenge message — the exact bytes
	// the wallet was asked to sign, which is what makes the capture usable.
	if observed != 1 {
		t.Fatalf("observer called %d times, want 1", observed)
	}
	if observedMessage != message {
		t.Fatalf("observer saw a different message than the challenge")
	}
	// And nothing about the rejection changed: no session, the attempt counted,
	// the challenge unconsumed.
	if store.failures != 1 {
		t.Fatalf("failed attempts = %d, want 1", store.failures)
	}
	if store.consumedAt != nil {
		t.Fatal("a rejected proof consumed the challenge")
	}
}

func TestProofObserverIsSilentWhenTheSignatureVerifies(t *testing.T) {
	store, auth, wallet, publicKey, key := schemeFixture(t)
	auth.OnProofMismatch = func(string, Proof) {
		t.Error("observer ran for a signature that verified")
	}

	signature := hex.EncodeToString(ed25519.Sign(key, nimiq.RawMessage(store.challenge.Message())))

	if _, _, _, err := auth.Login(context.Background(), Proof{
		ChallengeID: store.challenge.ID,
		Wallet:      wallet,
		PublicKey:   publicKey,
		Signature:   signature,
	}); err != nil {
		t.Fatalf("valid proof rejected: %v", err)
	}
}
