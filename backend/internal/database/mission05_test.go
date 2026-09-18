package database

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func strptr(s string) *string { return &s }

func TestMission05CatalogProfileSlugAndCategory(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pkg, _ := paymentOffer(t, pool)
	repo := CatalogRepository{Pool: pool}
	catalog := application.Catalog{Store: repo, Now: time.Now}
	p, err := catalog.CreateProvider(ctx, customer, "Studio", domain.ProfileInput{Slug: strptr("  My-Studio  "), Headline: strptr("Lessons"), Bio: strptr("Teacher"), AvatarURL: strptr("https://images.example/avatar.png"), Location: strptr("Istanbul")})
	if err != nil || p.Slug != "my-studio" {
		t.Fatalf("profile: %+v %v", p, err)
	}
	if _, err := catalog.CreateProvider(ctx, other, "Same", domain.ProfileInput{Slug: strptr("MY-STUDIO")}); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("duplicate slug: %v", err)
	}
	for _, input := range []domain.ProfileInput{{Slug: strptr("admin")}, {Slug: strptr("bad/path")}, {AvatarURL: strptr("javascript:alert(1)")}, {AvatarURL: strptr("https://user:pass@images.example/a")}} {
		if _, err := catalog.CreateProvider(ctx, customer, "Invalid", input); !errors.Is(err, application.ErrValidation) {
			t.Fatalf("invalid input: %v", err)
		}
	}
	updated, err := catalog.UpdateProvider(ctx, customer, p.ID, "Renamed", domain.ProfileInput{Bio: strptr("")})
	if err != nil || updated.Slug != p.Slug || updated.Headline != "Lessons" || updated.Bio != "" {
		t.Fatalf("update: %+v %v", updated, err)
	}
	if _, err := catalog.UpdateProvider(ctx, other, p.ID, "Hijacked"); !errors.Is(err, application.ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := catalog.UpdateProvider(ctx, customer, p.ID, "Renamed", domain.ProfileInput{Slug: strptr("another-slug")}); !errors.Is(err, application.ErrValidation) {
		t.Fatal("mutable slug", err)
	}
	// A provider is created with its owner's wallet already adopted as the
	// payout destination (ADR-025), so the directory's own filter has to be
	// tested against the state it exists for: no payout wallet, no public
	// presence. Taking it away is what puts a provider back in that state.
	if string(p.PayoutWallet) != customer.Wallet {
		t.Fatalf("owner payout adoption: %+v", p)
	}
	assertExec(t, pool, `UPDATE providers SET payout_wallet=NULL,payout_verified_at=NULL WHERE id=$1`, p.ID)
	if _, err := repo.GetPublicProviderBySlug(ctx, p.Slug); !errors.Is(err, application.ErrNotFound) {
		t.Fatal("unverified provider public", err)
	}
	assertExec(t, pool, `UPDATE providers SET payout_wallet=$2,payout_verified_at=now() WHERE id=$1`, p.ID, customer.Wallet)
	public, err := repo.GetPublicProviderBySlug(ctx, p.Slug)
	if err != nil || public.Headline != "Lessons" || public.AvatarURL != p.AvatarURL || public.Wallet != domain.WalletAddress(customer.Wallet) {
		t.Fatalf("public profile: %+v %v", public, err)
	}
	offer, err := repo.GetPublicPass(ctx, pkg)
	if err != nil {
		t.Fatal(err)
	}
	var owner application.Identity
	if err := pool.QueryRow(ctx, `SELECT owner_identity_id FROM providers WHERE id=$1`, offer.Provider.ID).Scan(&owner.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := catalog.UpdateService(ctx, owner, offer.Provider.ID, offer.Service.ID, "Yoga", "Classes", domain.ServiceActive, "wellness"); err != nil {
		t.Fatal(err)
	}
	items, err := repo.ListPublicPasses(ctx, application.PublicPassFilter{Category: "wellness"})
	if err != nil || len(items) != 1 || items[0].Service.Category != "wellness" {
		t.Fatalf("filter: %+v %v", items, err)
	}
	items, err = repo.ListPublicPasses(ctx, application.PublicPassFilter{Category: "music"})
	if err != nil || len(items) != 0 {
		t.Fatalf("filter returned wrong category: %v", err)
	}
	if _, err := catalog.UpdateService(ctx, owner, offer.Provider.ID, offer.Service.ID, "Yoga", "Classes", domain.ServiceActive, "invented"); !errors.Is(err, application.ErrValidation) {
		t.Fatal(err)
	}
	assertReject(t, pool, `UPDATE services SET category='invented' WHERE id=$1`, offer.Service.ID)
	assertReject(t, pool, `UPDATE providers SET slug='another-slug' WHERE id=$1`, p.ID)
}

func TestMission05PassPaginationOwnershipExpiryAndSnapshot(t *testing.T) {
	f := newRedemptionFixture(t)
	ctx := context.Background()
	pool := f.Pool.Pool
	first, err := f.Pool.GetPass(ctx, f.PassID, f.Customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	chain := &testChain{}
	now := f.Now
	svc := application.Payments{Store: f.Pool, Chain: chain, Network: domain.NimiqTestnet, Now: func() time.Time { return now }}
	// Three passes for one customer, from three different Passes of the same
	// service. They used to be three purchases of one Pass, which is now
	// refused: one live pass per Pass (`application.ErrPassAlreadyOwned`).
	// What this test is about — the cursor, the tie-breaker, the snapshot and
	// the expiry filter — is unchanged by where the passes came from.
	for i := 0; i < 2; i++ {
		sibling := siblingCatalogPass(t, pool, first.Snapshot.PassID, []string{"Ten more sessions", "Ten sessions, evenings"}[i])
		p, _, err := svc.Create(ctx, f.Customer, sibling, "")
		if err != nil {
			t.Fatal(err)
		}
		hash := strings.Repeat([]string{"a", "b"}[i], 64)
		if _, err := svc.Submit(ctx, f.Customer, p.Purchase.ID, hash); err != nil {
			t.Fatal(err)
		}
		chain.set(paymentEvidence(p, hash, true), nil)
		if _, err := svc.Reconcile(ctx, f.Customer, p.Purchase.ID); err != nil {
			t.Fatal(err)
		}
	}
	// Identical timestamps exercise the ID tie-breaker without offset pagination.
	assertExec(t, pool, `UPDATE purchased_passes SET created_at=$1`, now)
	seen := map[domain.ID]bool{}
	var cursor *application.PurchasedPassCursor
	for i := 0; i < 3; i++ {
		page, err := f.Pool.ListPasses(ctx, f.Customer.ID, application.PurchasedPassFilter{Limit: 1, Before: cursor})
		if err != nil || len(page.Items) != 1 {
			t.Fatalf("page: %+v %v", page, err)
		}
		p := page.Items[0]
		if seen[p.ID] {
			t.Fatal("duplicate page")
		}
		seen[p.ID] = true
		if p.Snapshot.ProviderName != "Studio" || p.Snapshot.ServiceName != "Yoga" || p.Snapshot.PriceLuna == 0 {
			t.Fatalf("missing real snapshot: %+v", p)
		}
		cursor, err = application.DecodePurchasedPassCursor(page.NextCursor)
		if err != nil {
			t.Fatal(err)
		}
		if (cursor == nil) != (i == 2) {
			t.Fatal("incorrect terminal cursor")
		}
	}
	page, err := f.Pool.ListPasses(ctx, f.Provider.ID, application.PurchasedPassFilter{Limit: 20})
	if err != nil || len(page.Items) != 0 {
		t.Fatal("foreign passes leaked", err)
	}
	assertExec(t, pool, `UPDATE purchased_passes SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1`, f.PassID)
	page, err = f.Pool.ListPasses(ctx, f.Customer.ID, application.PurchasedPassFilter{Limit: 20, Status: domain.PurchasedPassExpired})
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != f.PassID {
		t.Fatalf("effective expiry: %+v %v", page, err)
	}
	page, err = f.Pool.ListPasses(ctx, f.Customer.ID, application.PurchasedPassFilter{Limit: 20, Status: domain.PurchasedPassActive})
	if err != nil || len(page.Items) != 2 {
		t.Fatal("active filter", err)
	}
}

func TestMission05DistributedRateLimitAndFailureClosed(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for range 40 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if (RateLimiter{Pool: pool}).Allow(ctx, "shared-ip", 10, time.Minute) {
				accepted.Add(1)
			}
		}()
	}
	wg.Wait()
	if accepted.Load() != 10 {
		t.Fatalf("accepted %d", accepted.Load())
	}
	if (RateLimiter{Pool: pool}).Allow(ctx, "shared-ip", 10, time.Minute) {
		t.Fatal("new replica reset limit")
	}
	assertExec(t, pool, `UPDATE rate_limit_buckets SET resets_at=now()-interval '1 second'`)
	if !(RateLimiter{Pool: pool}).Allow(ctx, "shared-ip", 10, time.Minute) {
		t.Fatal("expired limit not reset")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if (RateLimiter{Pool: pool}).Allow(cancelled, "new-ip", 10, time.Minute) {
		t.Fatal("database error failed open")
	}
}

func TestMission05NetworkPurposeAndRetryBoundaries(t *testing.T) {
	f := newRedemptionFixture(t)
	ctx := context.Background()
	svc := f.Service()
	created, err := svc.CreateChallenge(ctx, f.Customer, f.PassID)
	if err != nil {
		t.Fatal(err)
	}
	wrong := svc
	wrong.Network = domain.NimiqMainnet
	if _, err := wrong.CreateChallenge(ctx, f.Customer, f.PassID); !errors.Is(err, application.ErrConflict) {
		t.Fatal("foreign network challenge", err)
	}
	signature := hex.EncodeToString(ed25519.Sign(f.Key, created.Challenge.SigningMessage()))
	if _, err := wrong.Authorize(ctx, f.Customer, created.Challenge.ID, f.Public, signature, ""); !errors.Is(err, application.ErrConflict) {
		t.Fatal("foreign network auth", err)
	}
	wrong = svc
	wrong.Environment = "production"
	if _, err := wrong.Authorize(ctx, f.Customer, created.Challenge.ID, f.Public, signature, ""); !errors.Is(err, application.ErrConflict) {
		t.Fatal("foreign environment auth", err)
	}
	for _, purpose := range []string{application.AuthLogin, application.VerifyProviderWallet} {
		message := strings.Replace(string(created.Challenge.SigningMessage()), "AUTHORIZE_REDEMPTION", purpose, 1)
		bad := hex.EncodeToString(ed25519.Sign(f.Key, []byte(message)))
		if _, err := svc.Authorize(ctx, f.Customer, created.Challenge.ID, f.Public, bad, ""); !errors.Is(err, application.ErrInvalidRedemptionSignature) {
			t.Fatal("cross-purpose accepted", err)
		}
	}
	// A valid signature over the right purpose spends the session outright:
	// there is no provider confirmation left to wait for.
	authorized := f.authorize(t, created)
	if authorized.Challenge.Status != domain.RedemptionConsumed || !authorized.HasRedemption {
		t.Fatalf("authorization did not consume: %+v", authorized.Challenge)
	}
	pass, err := f.Pool.GetPass(ctx, f.PassID, f.Customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if pass.UsedSessions != 1 {
		t.Fatalf("used sessions after authorization=%d, want 1", pass.UsedSessions)
	}
	chain := &testChain{}
	chain.set(nimiq.ChainEvidence{}, nimiq.ErrRPCUnavailable)
	now := f.Now
	payments := application.Payments{Store: f.Pool, Chain: chain, Network: domain.NimiqTestnet, Now: func() time.Time { return now }}
	// A Pass this customer is not already holding, because the subject here is
	// the retry backoff and not the ownership rule.
	purchase, _, err := payments.Create(ctx, f.Customer, siblingCatalogPass(t, f.Pool.Pool, pass.Snapshot.PassID, "Ten sessions, mornings"), "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := payments.Submit(ctx, f.Customer, purchase.Purchase.ID, strings.Repeat("f", 64)); err != nil {
		t.Fatal(err)
	}
	for range 10 {
		if _, err := payments.Reconcile(ctx, f.Customer, purchase.Purchase.ID); err != nil {
			t.Fatal(err)
		}
	}
	var retries int
	if err := f.Pool.Pool.QueryRow(ctx, `SELECT retry_count FROM payment_candidates WHERE purchase_id=$1`, purchase.Purchase.ID).Scan(&retries); err != nil || retries != 4 {
		t.Fatal("unbounded retry delay", retries, err)
	}
	due, err := f.Pool.Due(ctx, now.Add(7*time.Minute), 20)
	if err != nil || len(due) != 0 {
		t.Fatal("backoff ignored", err)
	}
	due, err = f.Pool.Due(ctx, now.Add(9*time.Minute), 20)
	if err != nil || len(due) != 1 {
		t.Fatal("restart recovery missing", err)
	}
	payments.Network = domain.NimiqMainnet
	if _, err := payments.Reconcile(ctx, f.Customer, purchase.Purchase.ID); !errors.Is(err, application.ErrConflict) {
		t.Fatal("config network mismatch accepted", err)
	}
}

func TestMission05FreshUpgradeAndReadiness(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	if err := CheckMigrations(ctx, pool, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, filepath.Base(file)), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	assertExec(t, pool, `UPDATE schema_migrations SET checksum=repeat('0',64) WHERE version=8`)
	if CheckMigrations(ctx, pool, dir) == nil {
		t.Fatal("readiness accepted changed migration")
	}
	if Migrate(ctx, pool, dir) == nil {
		t.Fatal("migration accepted checksum drift")
	}
}

func TestMission05UpgradeFromMission04PreservesRows(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	// Only this test's isolated schema is reset, never a user's database/schema.
	var schema string
	if err := pool.QueryRow(ctx, `SELECT current_schema()`).Scan(&schema); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(schema, "nimpass_test_") {
		t.Fatal("unsafe test schema")
	}
	assertExec(t, pool, `DROP SCHEMA `+schema+` CASCADE`)
	assertExec(t, pool, `CREATE SCHEMA `+schema)
	dir := t.TempDir()
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if filepath.Base(file) >= "000008" {
			continue
		}
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, filepath.Base(file)), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := Migrate(ctx, pool, dir); err != nil {
		t.Fatal(err)
	}
	_, _, pkg, _ := paymentOfferTable(t, pool, "packages")
	if err := Migrate(ctx, pool, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	offer, err := (CatalogRepository{Pool: pool}).GetPublicPass(ctx, pkg)
	if err != nil || offer.Pass.Title != "Ten sessions" || offer.Service.Category != "" || !strings.HasPrefix(offer.Provider.Slug, "studio-") {
		t.Fatalf("upgrade lost data: %+v %v", offer, err)
	}
	if err := CheckMigrations(ctx, pool, "../../migrations"); err != nil {
		t.Fatal(err)
	}
}

func TestMission05DatabaseCannotChangeNetworkOrEnvironment(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	if err := BindDeployment(ctx, pool, "TESTNET", "test"); err != nil {
		t.Fatal(err)
	}
	if err := BindDeployment(ctx, pool, "TESTNET", "test"); err != nil {
		t.Fatal("replica bind", err)
	}
	if BindDeployment(ctx, pool, "MAINNET", "test") == nil {
		t.Fatal("network switch accepted")
	}
	if BindDeployment(ctx, pool, "TESTNET", "production") == nil {
		t.Fatal("environment switch accepted")
	}
}

func TestRateLimitCleanupCannotDeleteConcurrentlyRenewedBucket(t *testing.T) {
	pool := missionPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	limiter := RateLimiter{Pool: pool}
	if !limiter.Allow(ctx, "renewing-key", 1, time.Minute) {
		t.Fatal("initial allowance")
	}
	assertExec(t, pool, `UPDATE rate_limit_buckets SET resets_at=now()-interval '1 second'`)
	renewal, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = renewal.Rollback(context.Background()) }()
	var renewalPID int
	if err := renewal.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&renewalPID); err != nil {
		t.Fatal(err)
	}
	// Hold the same row lock as Allow's renewal. Cleanup sees the previous expired
	// version until commit; it must recheck the newly committed expiry afterward.
	if _, err := renewal.Exec(ctx, `UPDATE rate_limit_buckets SET attempts=1,resets_at=now()+interval '1 minute'`); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- limiter.Cleanup(ctx) }()
	for {
		var waiting bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))`, renewalPID).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("cleanup did not wait on renewal: %v", err)
		case <-ctx.Done():
			t.Fatal("cleanup never reached row lock")
		case <-time.After(time.Millisecond):
		}
	}
	if err := renewal.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if limiter.Allow(ctx, "renewing-key", 1, time.Minute) {
		t.Fatal("cleanup erased active counter, bypassing rate limit")
	}
}

func TestReadinessRejectsDuplicateVersionMaskingMissingMigration(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	dir := t.TempDir()
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if strings.HasPrefix(filepath.Base(file), "000009_") {
			continue
		}
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, filepath.Base(file)), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	first, err := os.ReadFile("../../migrations/000001_core.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "000001_duplicate.up.sql"), first, 0600); err != nil {
		t.Fatal(err)
	}
	if CheckMigrations(ctx, pool, dir) == nil {
		t.Fatal("duplicate migration masked missing version")
	}
}
