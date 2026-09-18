package database

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

func missionPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to disposable PostgreSQL _test database")
	}
	u, err := url.Parse(dsn)
	if err != nil || !strings.HasSuffix(strings.TrimPrefix(u.Path, "/"), "_test") {
		t.Fatal("TEST_DATABASE_URL must end in _test")
	}
	ctx := context.Background()
	admin, err := Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "nimpass_test_" + strings.ReplaceAll(testUUID(t), "-", "")
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		defer admin.Close()
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := Migrate(ctx, pool, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	return pool
}
func missionKey(t *testing.T) (string, string, ed25519.PrivateKey) {
	t.Helper()
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	wallet, err := nimiq.AddressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	return wallet, hex.EncodeToString(pub), private
}
func missionProof(c application.Challenge, wallet, pub string, key ed25519.PrivateKey) application.Proof {
	return application.Proof{ChallengeID: c.ID, Wallet: wallet, PublicKey: pub, Signature: hex.EncodeToString(ed25519.Sign(key, []byte(c.Message())))}
}

func TestMission02DatabaseLifecycleAndSecurity(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	authRepo := AuthRepository{Pool: pool}
	catalogRepo := CatalogRepository{Pool: pool}
	auth := application.Auth{Store: authRepo, Verifier: nimiq.Ed25519Verifier{}, Network: "TESTNET", Environment: "test", Now: time.Now}
	catalog := application.Catalog{Store: catalogRepo, Now: time.Now}
	wallet, pub, key := missionKey(t)
	challenge, err := auth.NewChallenge(ctx, application.AuthLogin, wallet, "")
	if err != nil {
		t.Fatal(err)
	}
	proof := missionProof(challenge, wallet, pub, key)
	bad := proof
	bad.Signature = strings.Repeat("0", 128)
	if _, _, _, err := auth.Login(ctx, bad); !errors.Is(err, application.ErrInvalidSignature) {
		t.Fatalf("invalid signature: %v", err)
	}
	wrongWallet := proof
	wrongWallet.Wallet = "NQ07" + strings.Repeat("0", 32)
	if _, _, _, err := auth.Login(ctx, wrongWallet); !errors.Is(err, application.ErrInvalidSignature) {
		t.Fatalf("wrong wallet: %v", err)
	}
	otherWallet, otherPub, otherKey := missionKey(t)
	wrongKey := missionProof(challenge, wallet, otherPub, otherKey)
	if _, _, _, err := auth.Login(ctx, wrongKey); !errors.Is(err, application.ErrInvalidSignature) {
		t.Fatalf("wrong public key binding: %v", err)
	}
	wrongPurpose := proof
	wrongPurpose.Signature = hex.EncodeToString(ed25519.Sign(key, []byte(strings.Replace(challenge.Message(), "AUTH_LOGIN", "VERIFY_PROVIDER_WALLET", 1))))
	if _, _, _, err := auth.Login(ctx, wrongPurpose); !errors.Is(err, application.ErrInvalidSignature) {
		t.Fatalf("wrong domain signature: %v", err)
	}
	session, token, csrf, err := auth.Login(ctx, proof)
	if err != nil {
		t.Fatal(err)
	}
	if csrf != application.CSRFToken(token) {
		t.Fatal("CSRF derivation mismatch")
	}
	if _, _, _, err := auth.Login(ctx, proof); !errors.Is(err, application.ErrConsumed) {
		t.Fatalf("replay: %v", err)
	}
	if _, err := auth.Authenticate(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, err := auth.Authenticate(ctx, "not-a-token"); err == nil {
		t.Fatal("invalid session accepted")
	}
	provider, err := catalog.CreateProvider(ctx, session.Identity, "Yoga Studio")
	if err != nil {
		t.Fatal(err)
	}
	// Born paid-into: the login proof is what establishes control of this
	// wallet, so the provider has a verified payout destination before it has
	// anything to sell, and the address is the session's rather than one any
	// caller named (ADR-025).
	if string(provider.PayoutWallet) != wallet || provider.PayoutVerifiedAt == nil {
		t.Fatalf("owner payout adoption: %+v", provider)
	}
	if !provider.CanReceivePayments() {
		t.Fatal("adopted payout wallet cannot receive payments")
	}
	service, err := catalog.CreateService(ctx, session.Identity, provider.ID, "Yoga", "Classes")
	if err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(30 * 24 * time.Hour).UTC()
	pass, err := catalog.CreatePass(ctx, session.Identity, provider.ID, service.ID, "Ten sessions", "Yoga sessions", 10, 12_340_000, &expires, "", "")
	if err != nil {
		t.Fatal(err)
	}
	// The payout gate itself. A provider now arrives verified, so the only way
	// left to reach the refusal is to take the wallet away — which is still the
	// state a provider is in if a change ceremony is ever started and left
	// unfinished. The ceremony below puts a real one back.
	assertExec(t, pool, `UPDATE providers SET payout_wallet=NULL,payout_verified_at=NULL WHERE id=$1`, provider.ID)
	if _, err := catalog.PublishPass(ctx, session.Identity, pass.ID); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("unverified payout publish: %v", err)
	}
	public, err := catalogRepo.ListPublicPasses(ctx, application.PublicPassFilter{})
	if err != nil || len(public) != 0 {
		t.Fatalf("draft leaked: %v %v", public, err)
	}
	service, err = catalog.UpdateService(ctx, session.Identity, provider.ID, service.ID, "Yoga", "Classes", domain.ServiceActive)
	if err != nil {
		t.Fatal(err)
	}
	separated, err := auth.NewChallenge(ctx, application.VerifyProviderWallet, wallet, provider.ID)
	if err != nil {
		t.Fatal(err)
	}
	reusedLogin := proof
	reusedLogin.ChallengeID = separated.ID
	reusedLogin.OwnerPublicKey = pub
	reusedLogin.OwnerSignature = hex.EncodeToString(ed25519.Sign(key, []byte(separated.Message())))
	if err := auth.VerifyPayout(ctx, session.Identity, provider.ID, reusedLogin); !errors.Is(err, application.ErrInvalidSignature) {
		t.Fatalf("login signature reused for payout: %v", err)
	}
	payoutChallenge, err := auth.NewChallenge(ctx, application.VerifyProviderWallet, otherWallet, provider.ID)
	if err != nil {
		t.Fatal(err)
	}
	payoutProof := missionProof(payoutChallenge, otherWallet, otherPub, otherKey)
	if err := auth.VerifyPayout(ctx, session.Identity, provider.ID, payoutProof); !errors.Is(err, application.ErrInvalidSignature) {
		t.Fatalf("missing owner step-up: %v", err)
	}
	payoutProof.OwnerPublicKey = pub
	payoutProof.OwnerSignature = hex.EncodeToString(ed25519.Sign(key, []byte(payoutChallenge.Message())))
	if err := auth.VerifyPayout(ctx, session.Identity, provider.ID, payoutProof); err != nil {
		t.Fatal(err)
	}
	if err := auth.VerifyPayout(ctx, session.Identity, provider.ID, payoutProof); !errors.Is(err, application.ErrConsumed) {
		t.Fatalf("payout replay: %v", err)
	}
	if _, err := catalog.PublishPass(ctx, session.Identity, pass.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := catalog.PublishPass(ctx, session.Identity, pass.ID); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("double publish: %v", err)
	}
	public, err = catalogRepo.ListPublicPasses(ctx, application.PublicPassFilter{})
	if err != nil || len(public) != 1 || public[0].Pass.ID != pass.ID {
		t.Fatalf("published discovery: %v %v", public, err)
	}
	if _, err := catalogRepo.GetPublicPass(ctx, pass.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := catalogRepo.GetPublicProvider(ctx, provider.ID); err != nil {
		t.Fatal(err)
	}
	// Two: the wallet adopted when the provider was created, and the one the
	// ceremony above verified. Every payout assignment is audited whether or
	// not a challenge was spent on it (docs/09-SECURITY.md §22).
	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM provider_payout_audit WHERE provider_id=$1`, provider.ID).Scan(&auditCount); err != nil || auditCount != 2 {
		t.Fatalf("payout audit: %d %v", auditCount, err)
	}
	var adoptions int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM provider_payout_audit WHERE provider_id=$1 AND challenge_id IS NULL`, provider.ID).Scan(&adoptions); err != nil || adoptions != 1 {
		t.Fatalf("adoption audit: %d %v", adoptions, err)
	}
	newWallet, newPub, newKey := missionKey(t)
	replacement, err := auth.NewChallenge(ctx, application.VerifyProviderWallet, newWallet, provider.ID)
	if err != nil {
		t.Fatal(err)
	}
	replacementProof := missionProof(replacement, newWallet, newPub, newKey)
	replacementProof.OwnerPublicKey = pub
	replacementProof.OwnerSignature = hex.EncodeToString(ed25519.Sign(key, []byte(replacement.Message())))
	if err := auth.VerifyPayout(ctx, session.Identity, provider.ID, replacementProof); err != nil {
		t.Fatal(err)
	}
	changed, err := catalogRepo.GetProvider(ctx, provider.ID, session.Identity.ID)
	if err != nil || string(changed.PayoutWallet) != newWallet {
		t.Fatalf("payout replacement: %v %v", changed, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM provider_payout_audit WHERE provider_id=$1`, provider.ID).Scan(&auditCount); err != nil || auditCount != 3 {
		t.Fatalf("replacement audit: %d %v", auditCount, err)
	}
	otherChallenge, err := auth.NewChallenge(ctx, application.AuthLogin, otherWallet, "")
	if err != nil {
		t.Fatal(err)
	}
	otherSession, otherToken, _, err := auth.Login(ctx, missionProof(otherChallenge, otherWallet, otherPub, otherKey))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := catalogRepo.GetProvider(ctx, provider.ID, otherSession.Identity.ID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("provider IDOR: %v", err)
	}
	if _, err := catalogRepo.UpdateProvider(ctx, provider.ID, otherSession.Identity.ID, "Hijacked", time.Now()); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("provider update IDOR: %v", err)
	}
	if _, err := catalog.CreateService(ctx, otherSession.Identity, provider.ID, "Hijacked", ""); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("service create IDOR: %v", err)
	}
	if _, err := catalogRepo.GetService(ctx, service.ID, otherSession.Identity.ID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("service IDOR: %v", err)
	}
	if _, err := catalog.CreatePass(ctx, otherSession.Identity, provider.ID, service.ID, "Hijacked", "", 1, 1, nil, "", ""); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("pass create IDOR: %v", err)
	}
	if _, err := catalogRepo.GetProviderPass(ctx, pass.ID, otherSession.Identity.ID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("pass IDOR: %v", err)
	}
	if _, err := catalog.PublishPass(ctx, otherSession.Identity, pass.ID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("publish IDOR: %v", err)
	}
	if _, err := catalog.CreatePass(ctx, session.Identity, provider.ID, service.ID, "Invalid", "", 0, 0, nil, "", ""); !errors.Is(err, application.ErrValidation) {
		t.Fatalf("invalid pass: %v", err)
	}
	if _, err := catalog.CreatePass(ctx, session.Identity, provider.ID, service.ID, "No expiry", "", 1, 100, nil, "", ""); err != nil {
		t.Fatalf("optional expiry: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE auth_sessions SET created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' WHERE id=$1`, otherSession.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := auth.Authenticate(ctx, otherToken); !errors.Is(err, application.ErrForbidden) {
		t.Fatalf("expired session: %v", err)
	}
	if err := authRepo.RevokeSession(ctx, session.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := auth.Authenticate(ctx, token); !errors.Is(err, application.ErrForbidden) {
		t.Fatalf("revoked session: %v", err)
	}
	expired, err := auth.NewChallenge(ctx, application.AuthLogin, wallet, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE auth_challenges SET issued_at=now()-interval '6 minutes',expires_at=now()-interval '1 second' WHERE id=$1`, expired.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := auth.Login(ctx, missionProof(expired, wallet, pub, key)); !errors.Is(err, application.ErrExpired) {
		t.Fatalf("expired challenge: %v", err)
	}
	brute, err := auth.NewChallenge(ctx, application.AuthLogin, wallet, "")
	if err != nil {
		t.Fatal(err)
	}
	for range 5 {
		bad := missionProof(brute, wallet, pub, key)
		bad.Signature = strings.Repeat("0", 128)
		if _, _, _, err := auth.Login(ctx, bad); !errors.Is(err, application.ErrInvalidSignature) {
			t.Fatalf("bad attempt: %v", err)
		}
	}
	if _, _, _, err := auth.Login(ctx, missionProof(brute, wallet, pub, key)); !errors.Is(err, application.ErrTooManyAttempts) {
		t.Fatalf("brute-force lockout: %v", err)
	}
}

func TestChallengeConcurrentReplay(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	auth := application.Auth{Store: AuthRepository{Pool: pool}, Verifier: nimiq.Ed25519Verifier{}, Network: "TESTNET", Environment: "test", Now: time.Now}
	wallet, pub, key := missionKey(t)
	c, err := auth.NewChallenge(ctx, application.AuthLogin, wallet, "")
	if err != nil {
		t.Fatal(err)
	}
	p := missionProof(c, wallet, pub, key)
	var wg sync.WaitGroup
	var mu sync.Mutex
	success := 0
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, _, err := auth.Login(ctx, p)
			if err == nil {
				mu.Lock()
				success++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if success != 1 {
		t.Fatalf("concurrent challenge success=%d, want 1", success)
	}
}
