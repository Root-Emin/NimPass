package database

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// sessionWorld is one complete, settled purchase: a provider, a buyer, a pass
// the buyer paid for and had verified on chain, and the sessions that came
// with it. Everything below starts from the state the product is actually in
// after somebody buys something.
type sessionWorld struct {
	pool     *pgxpool.Pool
	repo     PaymentRepository
	svc      application.PassSessions
	buyer    application.Identity
	stranger application.Identity
	provider application.Identity
	pass     domain.PurchasedPass
	sessions []domain.PassSession
}

// providerOwner recovers the account behind a fixture's provider record.
func providerOwner(t *testing.T, pool *pgxpool.Pool, passID domain.ID) application.Identity {
	t.Helper()
	var identity application.Identity
	err := pool.QueryRow(context.Background(), `SELECT pr.owner_identity_id,i.wallet_address FROM passes pk JOIN providers pr ON pr.id=pk.provider_id JOIN identities i ON i.id=pr.owner_identity_id WHERE pk.id=$1`, passID).Scan(&identity.ID, &identity.Wallet)
	if err != nil {
		t.Fatal(err)
	}
	return identity
}

func newSessionWorld(t *testing.T) sessionWorld {
	t.Helper()
	pool := missionPool(t)
	ctx := context.Background()
	buyer, stranger, catalogPass, _ := paymentOffer(t, pool)
	provider := providerOwner(t, pool, catalogPass)
	repo := PaymentRepository{Pool: pool}
	chain := &testChain{err: nimiq.ErrRPCNotFound}
	payments := application.Payments{Store: repo, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}

	intent, _, err := payments.Create(ctx, buyer, catalogPass, "buy")
	if err != nil {
		t.Fatal(err)
	}
	hash := hashFixture('a')
	submitted, err := payments.Submit(ctx, buyer, intent.Purchase.ID, hash)
	if err != nil {
		t.Fatal(err)
	}
	chain.set(paymentEvidence(submitted, hash, true), nil)
	settled, err := payments.Reconcile(ctx, buyer, intent.Purchase.ID)
	if err != nil {
		t.Fatal(err)
	}
	if settled.Purchase.Status != domain.PurchaseConfirmed || settled.PassID == "" {
		t.Fatalf("purchase did not settle: %s pass=%q", settled.Purchase.Status, settled.PassID)
	}

	svc := application.PassSessions{Store: repo, Now: time.Now}
	view, err := svc.View(ctx, buyer, settled.PassID)
	if err != nil {
		t.Fatal(err)
	}
	return sessionWorld{pool: pool, repo: repo, svc: svc, buyer: buyer, stranger: stranger, provider: provider, pass: view.Pass, sessions: view.Sessions}
}

func hashFixture(c byte) string {
	out := make([]byte, 64)
	for i := range out {
		out[i] = c
	}
	return string(out)
}

// A verified payment puts the pass in the buyer's account, with both parties
// named on it and one session record per session paid for.
func TestVerifiedPurchaseCreatesOwnedPassWithSessions(t *testing.T) {
	w := newSessionWorld(t)
	if w.pass.OwnerIdentityID != w.buyer.ID {
		t.Fatalf("pass owner %q is not the buyer %q", w.pass.OwnerIdentityID, w.buyer.ID)
	}
	if w.pass.ProviderIdentityID != w.provider.ID {
		t.Fatalf("pass provider %q is not the seller %q", w.pass.ProviderIdentityID, w.provider.ID)
	}
	if w.pass.OriginalSessions != 10 || w.pass.RemainingSessions != 10 || w.pass.UsedSessions != 0 {
		t.Fatalf("session counters: %+v", w.pass)
	}
	if len(w.sessions) != 10 {
		t.Fatalf("expected 10 session records, got %d", len(w.sessions))
	}
	for i, session := range w.sessions {
		if session.SequenceNumber != int32(i+1) || session.Status != domain.PassSessionUnscheduled || session.ScheduledAt != nil || session.CompletedAt != nil {
			t.Fatalf("session %d: %+v", i, session)
		}
	}
}

// The collection is a property of the pass, not of the browser that bought
// it: a fresh read with only the account id finds it.
func TestOwnedPassSurvivesANewSession(t *testing.T) {
	w := newSessionWorld(t)
	ctx := context.Background()
	// A brand new repository value, as a later process would have.
	page, err := PaymentRepository{Pool: w.pool}.ListPasses(ctx, w.buyer.ID, application.PurchasedPassFilter{Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != w.pass.ID {
		t.Fatalf("buyer cannot see their pass after re-reading: %+v", page.Items)
	}
	stranger, err := PaymentRepository{Pool: w.pool}.ListPasses(ctx, w.stranger.ID, application.PurchasedPassFilter{Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(stranger.Items) != 0 {
		t.Fatal("another account can list this buyer's passes")
	}
}

// Re-running verification on a purchase that already settled must not mint a
// second pass or a second set of sessions.
func TestDuplicateReconciliationCreatesNoSecondPass(t *testing.T) {
	w := newSessionWorld(t)
	ctx := context.Background()
	chain := &testChain{}
	payments := application.Payments{Store: w.repo, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	record, err := w.repo.Get(ctx, w.pass.PurchaseID, w.buyer.ID)
	if err != nil {
		t.Fatal(err)
	}
	chain.set(paymentEvidence(record, record.CandidateHash, true), nil)
	for i := 0; i < 3; i++ {
		if _, err := payments.Reconcile(ctx, w.buyer, w.pass.PurchaseID); err != nil {
			t.Fatalf("reconcile %d: %v", i, err)
		}
	}
	var passes, sessions int
	if err := w.pool.QueryRow(ctx, `SELECT count(*) FROM purchased_passes WHERE purchase_id=$1`, w.pass.PurchaseID).Scan(&passes); err != nil {
		t.Fatal(err)
	}
	if err := w.pool.QueryRow(ctx, `SELECT count(*) FROM pass_sessions WHERE purchased_pass_id=$1`, w.pass.ID).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if passes != 1 || sessions != 10 {
		t.Fatalf("duplicate reconciliation produced passes=%d sessions=%d", passes, sessions)
	}
}

// A provider may not buy from their own catalogue, decided in the repository
// against the provider record rather than against anything a client sent.
func TestProviderCannotPurchaseOwnPass(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	buyer, _, catalogPass, _ := paymentOffer(t, pool)
	provider := providerOwner(t, pool, catalogPass)
	payments := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: &testChain{}, Network: domain.NimiqTestnet, Now: time.Now}

	if _, _, err := payments.Create(ctx, provider, catalogPass, ""); !errors.Is(err, application.ErrSelfPurchase) {
		t.Fatalf("provider bought their own pass: %v", err)
	}
	// And the refusal is specific to that relationship, not a broken route for
	// everyone: an ordinary buyer still gets an intent.
	if _, _, err := payments.Create(ctx, buyer, catalogPass, ""); err != nil {
		t.Fatalf("ordinary purchase refused: %v", err)
	}
	var intents int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchases WHERE customer_context_id=$1`, provider.ID).Scan(&intents); err != nil {
		t.Fatal(err)
	}
	if intents != 0 {
		t.Fatalf("a refused self-purchase still wrote %d intents", intents)
	}
}

// Dates live in the database, not in a screen, and either party may set one.
func TestSessionSchedulingPersistsForBothParties(t *testing.T) {
	w := newSessionWorld(t)
	ctx := context.Background()
	when := time.Now().UTC().Add(72 * time.Hour).Truncate(time.Second)

	if _, err := w.svc.Schedule(ctx, w.buyer, w.sessions[0].ID, &when); err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.Schedule(ctx, w.provider, w.sessions[1].ID, &when); err != nil {
		t.Fatalf("provider cannot schedule: %v", err)
	}
	if _, err := w.svc.Schedule(ctx, w.stranger, w.sessions[2].ID, &when); !errors.Is(err, application.ErrPassNotFound) {
		t.Fatalf("a stranger scheduled somebody's session: %v", err)
	}

	// Both parties read the same rows.
	for _, actor := range []application.Identity{w.buyer, w.provider} {
		view, err := w.svc.View(ctx, actor, w.pass.ID)
		if err != nil {
			t.Fatal(err)
		}
		if view.Sessions[0].Status != domain.PassSessionScheduled || view.Sessions[0].ScheduledAt == nil || !view.Sessions[0].ScheduledAt.Equal(when) {
			t.Fatalf("session 1 not scheduled for %v: %+v", actor.ID, view.Sessions[0])
		}
		if view.Sessions[1].Status != domain.PassSessionScheduled {
			t.Fatalf("session 2 not scheduled for %v", actor.ID)
		}
		if view.Sessions[2].Status != domain.PassSessionUnscheduled || view.Sessions[2].ScheduledAt != nil {
			t.Fatalf("session 3 should still be unscheduled: %+v", view.Sessions[2])
		}
	}

	// Clearing is a real instruction, not an omission.
	if _, err := w.svc.Schedule(ctx, w.buyer, w.sessions[0].ID, nil); err != nil {
		t.Fatal(err)
	}
	view, err := w.svc.View(ctx, w.buyer, w.pass.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Sessions[0].Status != domain.PassSessionUnscheduled || view.Sessions[0].ScheduledAt != nil {
		t.Fatalf("clearing a date left: %+v", view.Sessions[0])
	}
	if view.Pass.RemainingSessions != 10 {
		t.Fatal("scheduling moved the counter")
	}
}

// Completion is the provider's, and it moves the shared counter once.
func TestProviderCompletionSpendsExactlyOneSession(t *testing.T) {
	w := newSessionWorld(t)
	ctx := context.Background()

	if _, _, err := w.svc.Complete(ctx, w.stranger, w.sessions[2].ID); !errors.Is(err, application.ErrPassNotFound) {
		t.Fatalf("a stranger completed somebody's session: %v", err)
	}
	if _, _, err := w.svc.Complete(ctx, w.buyer, w.sessions[2].ID); !errors.Is(err, application.ErrForbidden) {
		t.Fatalf("owner completed without a signature: %v", err)
	}

	session, pass, err := w.svc.Complete(ctx, w.provider, w.sessions[2].ID)
	if err != nil {
		t.Fatal(err)
	}
	if session.Status != domain.PassSessionCompleted || session.CompletedBy != domain.PassSessionByProvider || session.CompletedAt == nil {
		t.Fatalf("session not completed: %+v", session)
	}
	if pass.UsedSessions != 1 || pass.RemainingSessions != 9 {
		t.Fatalf("counter after one completion: used=%d remaining=%d", pass.UsedSessions, pass.RemainingSessions)
	}

	// The second attempt on the same session changes nothing.
	if _, _, err := w.svc.Complete(ctx, w.provider, w.sessions[2].ID); !errors.Is(err, application.ErrRedemptionConsumed) {
		t.Fatalf("same session completed twice: %v", err)
	}
	after, err := w.svc.View(ctx, w.buyer, w.pass.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Pass.RemainingSessions != 9 || after.Pass.UsedSessions != 1 {
		t.Fatalf("repeat completion moved the counter: %+v", after.Pass)
	}
	// And the buyer sees the provider's write, from the same rows.
	if after.Sessions[2].Status != domain.PassSessionCompleted {
		t.Fatal("buyer does not see the provider's completion")
	}
	if after.Role != domain.ViewerOwner {
		t.Fatalf("buyer role reported as %q", after.Role)
	}
}

// Two requests racing on one session must spend it once.
func TestConcurrentCompletionSpendsOneSession(t *testing.T) {
	w := newSessionWorld(t)
	ctx := context.Background()
	const racers = 6
	var wg sync.WaitGroup
	results := make(chan error, racers)
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := w.svc.Complete(ctx, w.provider, w.sessions[0].ID)
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	won := 0
	for err := range results {
		if err == nil {
			won++
		} else if !errors.Is(err, application.ErrRedemptionConsumed) && !errors.Is(err, application.ErrConflict) {
			t.Fatalf("unexpected racing error: %v", err)
		}
	}
	if won != 1 {
		t.Fatalf("%d of %d concurrent completions succeeded", won, racers)
	}
	view, err := w.svc.View(ctx, w.provider, w.pass.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Pass.UsedSessions != 1 || view.Pass.RemainingSessions != 9 {
		t.Fatalf("race moved the counter %d times", view.Pass.UsedSessions)
	}
	if domain.CountCompleted(view.Sessions) != view.Pass.UsedSessions {
		t.Fatalf("records say %d completed, counter says %d", domain.CountCompleted(view.Sessions), view.Pass.UsedSessions)
	}
}

// Spending every session completes the pass, and the counter can never go
// below zero on the way.
func TestSpendingEverySessionCompletesThePassAndStopsThere(t *testing.T) {
	w := newSessionWorld(t)
	ctx := context.Background()
	for i, session := range w.sessions {
		_, pass, err := w.svc.Complete(ctx, w.provider, session.ID)
		if err != nil {
			t.Fatalf("session %d: %v", i+1, err)
		}
		if pass.RemainingSessions != int32(len(w.sessions)-i-1) {
			t.Fatalf("after %d completions remaining=%d", i+1, pass.RemainingSessions)
		}
	}
	view, err := w.svc.View(ctx, w.provider, w.pass.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Pass.Status != domain.PurchasedPassCompleted || view.Pass.RemainingSessions != 0 || view.Pass.CompletedAt == nil {
		t.Fatalf("pass not completed: %+v", view.Pass)
	}
	// Nothing is left to spend, and asking again neither succeeds nor
	// underflows.
	if _, _, err := w.svc.Complete(ctx, w.provider, w.sessions[0].ID); err == nil {
		t.Fatal("an eleventh completion succeeded on a ten-session pass")
	}
	var remaining int32
	if err := w.pool.QueryRow(ctx, `SELECT remaining_sessions FROM purchased_passes WHERE id=$1`, w.pass.ID).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("remaining_sessions=%d", remaining)
	}
}

// A provider sees the passes sold from their own catalogue, and only those.
func TestProviderSeesOwnSoldPassesOnly(t *testing.T) {
	w := newSessionWorld(t)
	ctx := context.Background()
	items, err := w.svc.ProviderPasses(ctx, w.provider, w.pass.Snapshot.ProviderID, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != w.pass.ID {
		t.Fatalf("provider sold-pass list: %+v", items)
	}
	foreign, err := w.svc.ProviderPasses(ctx, w.stranger, w.pass.Snapshot.ProviderID, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(foreign) != 0 {
		t.Fatal("an unrelated account read another provider's customers")
	}
	// And a stranger cannot open the pass itself either.
	if _, _, err := w.repo.GetPassForActor(ctx, w.pass.ID, w.stranger.ID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("stranger opened the pass: %v", err)
	}
	// while the provider can, and is told which party they are.
	_, role, err := w.repo.GetPassForActor(ctx, w.pass.ID, w.provider.ID)
	if err != nil || role != domain.ViewerProvider {
		t.Fatalf("provider view role=%q err=%v", role, err)
	}
}

// The regression that made a real payment end as a permanent failure.
//
// Server-side discovery is allowed to look for a payment until
// `expires_at + PurchaseSettlementGrace`, and it records the moment it found
// one as the submission time. The verifier then demanded a submission time
// strictly inside the intent's lifetime — so a transaction that was on chain,
// for the right amount, to the right provider, from the right wallet, and
// included well inside the window, was rejected as TIMING the moment it was
// discovered a minute after the intent lapsed. MISMATCH is terminal: the
// customer's purchase ended as `permanently_failed` with their money gone.
//
// Both windows are the same width now. This proves it with a report that
// arrives after `expires_at` for a transaction included before it.
func TestPaymentReportedAfterExpiryStillSettles(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	buyer, _, catalogPass, _ := paymentOffer(t, pool)
	repo := PaymentRepository{Pool: pool}
	chain := &testChain{err: nimiq.ErrRPCNotFound}
	payments := application.Payments{Store: repo, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}

	intent, _, err := payments.Create(ctx, buyer, catalogPass, "late")
	if err != nil {
		t.Fatal(err)
	}
	// Age the intent so that "now" is past its expiry but inside the
	// settlement grace, exactly as a late discovery sweep sees it.
	shift := domain.PurchaseIntentTTL + time.Minute
	if _, err := pool.Exec(ctx, `UPDATE purchases SET created_at=created_at-$2::interval,expires_at=expires_at-$2::interval WHERE id=$1`, intent.Purchase.ID, shift); err != nil {
		t.Fatal(err)
	}

	hash := hashFixture('b')
	reported, err := payments.Submit(ctx, buyer, intent.Purchase.ID, hash)
	if err != nil {
		t.Fatalf("a payment reported inside the settlement grace was refused: %v", err)
	}
	if reported.SubmittedAt.Before(reported.Purchase.ExpiresAt) {
		t.Fatal("fixture did not produce a post-expiry submission time")
	}

	// The transaction itself was included inside the intent's own lifetime,
	// which is the property that actually matters.
	evidence := paymentEvidence(reported, hash, true)
	evidence.IncludedAt = reported.Purchase.CreatedAt.Add(time.Minute)
	evidence.FinalizedAt = evidence.IncludedAt.Add(time.Minute)
	chain.set(evidence, nil)

	settled, err := payments.Reconcile(ctx, buyer, intent.Purchase.ID)
	if err != nil {
		t.Fatal(err)
	}
	if settled.Purchase.Status != domain.PurchaseConfirmed {
		t.Fatalf("late report ended as %s (%s/%s) instead of CONFIRMED", settled.Purchase.Status, settled.CandidateStatus, settled.FailureCategory)
	}
	if settled.PassID == "" {
		t.Fatal("settled payment issued no pass")
	}
	var sessions int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pass_sessions WHERE purchased_pass_id=$1`, settled.PassID).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if sessions != 10 {
		t.Fatalf("pass issued with %d session records", sessions)
	}
}

// A transaction included outside the intent's window still settles nothing —
// the widening above must not have relaxed the rule that matters.
func TestPaymentIncludedOutsideTheWindowIsStillRefused(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	buyer, _, catalogPass, _ := paymentOffer(t, pool)
	repo := PaymentRepository{Pool: pool}
	chain := &testChain{err: nimiq.ErrRPCNotFound}
	payments := application.Payments{Store: repo, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}

	intent, _, err := payments.Create(ctx, buyer, catalogPass, "old-tx")
	if err != nil {
		t.Fatal(err)
	}
	hash := hashFixture('c')
	reported, err := payments.Submit(ctx, buyer, intent.Purchase.ID, hash)
	if err != nil {
		t.Fatal(err)
	}
	evidence := paymentEvidence(reported, hash, true)
	// Included an hour before this intent existed: somebody else's payment, or
	// this customer's own older one being presented again.
	evidence.IncludedAt = reported.Purchase.CreatedAt.Add(-time.Hour)
	chain.set(evidence, nil)

	refused, err := payments.Reconcile(ctx, buyer, intent.Purchase.ID)
	if err != nil {
		t.Fatal(err)
	}
	if refused.Purchase.Status == domain.PurchaseConfirmed || refused.PassID != "" {
		t.Fatalf("a transaction from outside the intent window settled it: %+v", refused.Purchase.Status)
	}
	if refused.FailureCategory != "TIMING" {
		t.Fatalf("expected TIMING, got %q", refused.FailureCategory)
	}
}
