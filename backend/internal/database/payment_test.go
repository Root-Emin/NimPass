package database

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

type testChain struct {
	mu       sync.Mutex
	evidence nimiq.ChainEvidence
	err      error
}

func (c *testChain) Inspect(_ context.Context, _, _ string) (nimiq.ChainEvidence, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.evidence, c.err
}
func (c *testChain) set(e nimiq.ChainEvidence, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.evidence = e
	c.err = err
}

func paymentID(t *testing.T) domain.ID {
	t.Helper()
	id, err := domain.NewID()
	if err != nil {
		t.Fatal(err)
	}
	return id
}
func paymentOffer(t *testing.T, pool *pgxpool.Pool) (application.Identity, application.Identity, domain.ID, string) {
	return paymentOfferTable(t, pool, "passes")
}

func paymentOfferTable(t *testing.T, pool *pgxpool.Pool, catalogTable string) (application.Identity, application.Identity, domain.ID, string) {
	t.Helper()
	if catalogTable != "passes" && catalogTable != "packages" {
		t.Fatal("invalid fixture table")
	}
	ctx := context.Background()
	now := time.Now().UTC()
	customerWallet, _, _ := missionKey(t)
	otherWallet, _, _ := missionKey(t)
	providerWallet, _, _ := missionKey(t)
	customer := application.Identity{ID: paymentID(t), Wallet: customerWallet}
	other := application.Identity{ID: paymentID(t), Wallet: otherWallet}
	owner := paymentID(t)
	provider := paymentID(t)
	service := paymentID(t)
	pkg := paymentID(t)
	for _, row := range []struct {
		id     domain.ID
		wallet string
	}{{customer.ID, customerWallet}, {other.ID, otherWallet}, {owner, providerWallet}} {
		if _, err := pool.Exec(ctx, `INSERT INTO identities(id,wallet_address,created_at) VALUES($1,$2,$3)`, row.id, row.wallet, now); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO providers(id,owner_identity_id,name,payout_wallet,payout_verified_at,created_at,updated_at) VALUES($1,$2,'Studio',$3,$4,$4,$4)`, provider, owner, providerWallet, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO services(id,provider_id,name,status,created_at,updated_at) VALUES($1,$2,'Yoga','ACTIVE',$3,$3)`, service, provider, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO `+catalogTable+`(id,provider_id,service_id,title,session_count,price_luna,status,created_at,updated_at) VALUES($1,$2,$3,'Ten sessions',10,12340000,'ACTIVE',$4,$4)`, pkg, provider, service, now); err != nil {
		t.Fatal(err)
	}
	return customer, other, pkg, providerWallet
}

// completePass spends a purchased pass down to zero, which is the state
// `01-PRODUCT.md §56` calls completed and the one `Buy Again` starts from.
//
// Tests that buy the same Pass a second time need it because holding two live
// passes for one Pass is refused (`application.ErrPassAlreadyOwned`). The
// sessions are written directly rather than redeemed, because the subject of
// those tests is the second purchase and not the signature that spent the
// first; the session rows are completed alongside the counter so the fixture
// leaves the two agreeing, as ADR-012 requires of every real write.
func completePass(t *testing.T, pool *pgxpool.Pool, passID domain.ID) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE pass_sessions SET status='COMPLETED',completed_at=now(),completed_by='PROVIDER',updated_at=now() WHERE purchased_pass_id=$1 AND status<>'COMPLETED'`, passID); err != nil {
		t.Fatal(err)
	}
	tag, err := pool.Exec(ctx, `UPDATE purchased_passes SET used_sessions=original_sessions,remaining_sessions=0,status='COMPLETED',completed_at=now() WHERE id=$1`, passID)
	if err != nil {
		t.Fatal(err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("completePass matched %d rows", tag.RowsAffected())
	}
}

// siblingCatalogPass adds a second Pass to the same provider and service.
//
// A customer may hold many passes; what they may not hold is two live ones for
// the same Pass. Tests that need a customer with several passes therefore buy
// several Passes, which is also what the product looks like.
func siblingCatalogPass(t *testing.T, pool *pgxpool.Pool, from domain.ID, title string) domain.ID {
	t.Helper()
	id := paymentID(t)
	tag, err := pool.Exec(context.Background(), `INSERT INTO passes(id,provider_id,service_id,title,description,session_count,price_luna,expiration_at,status,created_at,updated_at) SELECT $1,provider_id,service_id,$2,description,session_count,price_luna,expiration_at,'ACTIVE',now(),now() FROM passes WHERE id=$3`, id, title, from)
	if err != nil {
		t.Fatal(err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("siblingCatalogPass copied %d rows", tag.RowsAffected())
	}
	return id
}

func paymentEvidence(p application.PurchaseRecord, hash string, final bool) nimiq.ChainEvidence {
	zero := uint8(0)
	net := uint8(5)
	value := uint64(p.Purchase.Snapshot.PriceLuna)
	yes := true
	block := uint32(100)
	tx := nimiq.ChainTransaction{Hash: hash, BlockNumber: &block, From: string(p.Purchase.ExpectedWallet), FromType: &zero, To: string(p.Purchase.Snapshot.Recipient), ToType: &zero, Value: &value, RecipientData: hex.EncodeToString([]byte(p.Purchase.PaymentReference)), Flags: &zero, Proof: "aa", NetworkID: &net, ExecutionResult: &yes}
	// FinalityBlock is set whether or not finality has happened, because that
	// is what the real client does (see RPCClient.Inspect): the macro height
	// covering an inclusion is arithmetic on the batch length, so it is known
	// as soon as the block number is. `Finalized` is what separates a height
	// from a settlement.
	result := nimiq.ChainEvidence{Transaction: tx, InclusionBlock: block, IncludedAt: p.Purchase.CreatedAt, FinalityBlock: 120}
	if final {
		result.Finalized = true
		result.FinalizedAt = p.Purchase.CreatedAt.Add(time.Second)
	}
	return result
}

func TestPaymentLifecycleRecoveryAndConcurrentAtomicity(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pkg, _ := paymentOffer(t, pool)
	chain := &testChain{err: nimiq.ErrRPCNotFound}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	p, reused, err := svc.Create(ctx, customer, pkg, "click-1")
	if err != nil || reused {
		t.Fatalf("create: %v %v", reused, err)
	}
	if p.Purchase.ExpiresAt.Sub(p.Purchase.CreatedAt) != 30*time.Minute || !strings.HasPrefix(string(p.Purchase.PaymentReference), "NP1:") {
		t.Fatal("intent TTL/reference")
	}
	if _, _, err := svc.Create(ctx, customer, pkg, "click-1"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.Create(ctx, customer, paymentID(t), "click-1"); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("idempotency payload conflict: %v", err)
	}
	if _, err := svc.Store.Get(ctx, p.Purchase.ID, other.ID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("IDOR: %v", err)
	}
	if _, err := svc.Store.GetPass(ctx, paymentID(t), other.ID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("pass IDOR: %v", err)
	}
	hash := strings.Repeat("a", 64)
	if _, err := svc.Submit(ctx, customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Submit(ctx, customer, p.Purchase.ID, hash); err != nil {
		t.Fatal("duplicate submit", err)
	}
	if _, err := svc.Submit(ctx, customer, p.Purchase.ID, strings.Repeat("b", 64)); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("candidate replacement: %v", err)
	}
	if _, err := svc.Reconcile(ctx, customer, p.Purchase.ID); err != nil {
		t.Fatal(err)
	}
	got, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil || got.CandidateStatus != "NOT_FOUND" {
		t.Fatalf("not-found: %+v %v", got, err)
	}
	e := paymentEvidence(p, hash, false)
	chain.set(e, nil)
	got, err = svc.Reconcile(ctx, customer, p.Purchase.ID)
	if err != nil || got.CandidateStatus != "AWAITING_FINALITY" || got.PassID != "" {
		t.Fatalf("finality pending: %+v %v", got, err)
	}
	e.Finalized = true
	e.FinalityBlock = 120
	e.FinalizedAt = time.Now().UTC()
	chain.set(e, nil)
	var wg sync.WaitGroup
	errs := make(chan error, 12)
	for range 12 {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := svc.Reconcile(ctx, customer, p.Purchase.ID); errs <- err }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	got, err = svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil || got.Purchase.Status != domain.PurchaseConfirmed || got.PassID == "" {
		t.Fatalf("confirmation: %+v %v", got, err)
	}
	var receipts, passes int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM verified_payments WHERE purchase_id=$1`, p.Purchase.ID).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchased_passes WHERE purchase_id=$1`, p.Purchase.ID).Scan(&passes); err != nil {
		t.Fatal(err)
	}
	if receipts != 1 || passes != 1 {
		t.Fatalf("non-atomic/duplicate: receipts=%d passes=%d", receipts, passes)
	}
	pass, err := svc.Store.GetPass(ctx, got.PassID, customer.ID)
	if err != nil || pass.RemainingSessions != 10 || pass.UsedSessions != 0 {
		t.Fatalf("pass: %+v %v", pass, err)
	}
	if _, err := svc.Store.GetPass(ctx, got.PassID, other.ID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("pass IDOR: %v", err)
	}
	// Buying the same Pass again while the first one still has sessions on it
	// is refused — one entitlement, not two (`application.ErrPassAlreadyOwned`).
	if _, _, err := svc.Create(ctx, customer, pkg, "click-2"); !errors.Is(err, application.ErrPassAlreadyOwned) {
		t.Fatalf("a second live pass for the same Pass: %v", err)
	}
	// Spent to the end, the same customer may buy it again: this is §56's
	// Buy Again, and it is what the rest of this test runs on.
	completePass(t, pool, got.PassID)
	second, _, err := svc.Create(ctx, customer, pkg, "click-2")
	if err != nil || second.Purchase.ID == p.Purchase.ID {
		t.Fatalf("repeat purchase: %v", err)
	}
	if _, err := svc.Submit(ctx, customer, second.Purchase.ID, hash); err != nil {
		t.Fatal("unverified hash must not reserve", err)
	}
	if _, err := svc.Reconcile(ctx, customer, second.Purchase.ID); err != nil {
		t.Fatal(err)
	}
	secondResult, err := svc.Store.Get(ctx, second.Purchase.ID, customer.ID)
	if err != nil || secondResult.PassID != "" || secondResult.CandidateStatus != "MISMATCH" {
		t.Fatalf("duplicate verified hash accepted: %+v %v", secondResult, err)
	}
}

func TestPaymentMismatchAndCandidateNotGlobalReservation(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pkg, _ := paymentOffer(t, pool)
	chain := &testChain{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	p, _, err := svc.Create(ctx, customer, pkg, "")
	if err != nil {
		t.Fatal(err)
	}
	q, _, err := svc.Create(ctx, other, pkg, "")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("c", 64)
	if _, err := svc.Submit(ctx, customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Submit(ctx, other, q.Purchase.ID, hash); err != nil {
		t.Fatal("public hash squatted", err)
	}
	cases := []struct {
		name   string
		mutate func(*nimiq.ChainEvidence)
	}{
		// A stranger's sender *and* no reference on chain. Both halves are the
		// case: with this intent's reference present the sender no longer
		// gates the match, because the reference is the stronger binding and
		// Nimiq Pay chooses the paying account itself. Stripping the data
		// field is what puts this back on the sender rule, which is exactly
		// where an unreferenced payment belongs.
		{"wrong sender", func(e *nimiq.ChainEvidence) {
			e.Transaction.From = string(q.Purchase.ExpectedWallet)
			e.Transaction.RecipientData = ""
		}},
		{"wrong recipient", func(e *nimiq.ChainEvidence) { e.Transaction.To = string(q.Purchase.ExpectedWallet) }},
		{"wrong amount", func(e *nimiq.ChainEvidence) { v := uint64(1); e.Transaction.Value = &v }},
		{"wrong data", func(e *nimiq.ChainEvidence) { e.Transaction.RecipientData = "00" }},
		{"wrong network", func(e *nimiq.ChainEvidence) { v := uint8(24); e.Transaction.NetworkID = &v }},
		{"failed execution", func(e *nimiq.ChainEvidence) { v := false; e.Transaction.ExecutionResult = &v }},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Each mismatch needs its own outstanding intent. Creating again for
			// the same customer/product correctly reuses the still-pending one.
			customer, _, product, _ := paymentOffer(t, pool)
			attack, _, err := svc.Create(ctx, customer, product, "attack-"+tc.name)
			if err != nil {
				t.Fatal(err)
			}
			attackHash := fmt.Sprintf("%064x", i+13)
			if _, err := svc.Submit(ctx, customer, attack.Purchase.ID, attackHash); err != nil {
				t.Fatal(err)
			}
			e := paymentEvidence(attack, attackHash, true)
			tc.mutate(&e)
			chain.set(e, nil)
			if _, err := svc.Reconcile(ctx, customer, attack.Purchase.ID); err != nil {
				t.Fatal(err)
			}
			got, err := svc.Store.Get(ctx, attack.Purchase.ID, customer.ID)
			if err != nil || got.CandidateStatus != "MISMATCH" || got.PassID != "" {
				t.Fatalf("malicious payment accepted: %+v %v", got, err)
			}
		})
	}
	valid := paymentEvidence(p, hash, true)
	chain.set(valid, nil)
	if _, err := svc.Reconcile(ctx, customer, p.Purchase.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Reconcile(ctx, other, q.Purchase.ID); err != nil {
		t.Fatal(err)
	}
	got, err := svc.Store.Get(ctx, q.Purchase.ID, other.ID)
	if err != nil || got.CandidateStatus != "MISMATCH" {
		t.Fatalf("other customer claimed payment: %+v %v", got, err)
	}
}

func TestIntentEligibilitySnapshotCancellationAndTiming(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pkg, recipient := paymentOffer(t, pool)
	chain := &testChain{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	p, _, err := svc.Create(ctx, customer, pkg, "snapshot")
	if err != nil {
		t.Fatal(err)
	}
	if p.Purchase.ExpectedWallet != domain.WalletAddress(customer.Wallet) || p.Purchase.Snapshot.Recipient != domain.WalletAddress(recipient) || p.Purchase.Snapshot.PriceLuna != 12_340_000 || p.Purchase.Snapshot.Sessions != 10 {
		t.Fatal("commercial snapshot wrong")
	}
	otherPayout, _, _ := missionKey(t)
	if _, err := pool.Exec(ctx, `UPDATE passes SET price_luna=99000000,session_count=2 WHERE id=$1`, pkg); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE providers SET payout_wallet=$2 WHERE id=(SELECT provider_id FROM passes WHERE id=$1)`, pkg, otherPayout); err != nil {
		t.Fatal(err)
	}
	reloaded, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Purchase.Snapshot.PriceLuna != 12_340_000 || reloaded.Purchase.Snapshot.Sessions != 10 || reloaded.Purchase.Snapshot.Recipient != domain.WalletAddress(recipient) {
		t.Fatal("historical snapshot followed mutable catalog")
	}
	if _, err := svc.Store.Cancel(ctx, p.Purchase.ID, other.ID, time.Now()); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("cancel IDOR: %v", err)
	}
	if _, err := svc.Store.Cancel(ctx, p.Purchase.ID, customer.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Submit(ctx, customer, p.Purchase.ID, strings.Repeat("a", 64)); !errors.Is(err, application.ErrExpired) {
		t.Fatalf("cancelled intent accepted payment: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE passes SET status='DRAFT' WHERE id=$1`, pkg); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.Create(ctx, other, pkg, ""); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("draft purchase: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE passes SET status='ACTIVE',expiration_at=$2 WHERE id=$1`, pkg, time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.Create(ctx, other, pkg, ""); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("expired pass purchase: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE passes SET expiration_at=NULL WHERE id=$1`, pkg); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE providers SET payout_wallet=NULL,payout_verified_at=NULL WHERE id=(SELECT provider_id FROM passes WHERE id=$1)`, pkg); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.Create(ctx, other, pkg, ""); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("unverified payout purchase: %v", err)
	}
}

func TestSettlementGraceRequiresInWindowSubmission(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, _ := paymentOffer(t, pool)
	chain := &testChain{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	p, _, err := svc.Create(ctx, customer, pkg, "")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("e", 64)
	if _, err := svc.Submit(ctx, customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	svc.Now = func() time.Time { return p.Purchase.ExpiresAt.Add(10 * time.Minute) }
	e := paymentEvidence(p, hash, true)
	e.IncludedAt = p.Purchase.ExpiresAt.Add(6 * time.Minute)
	chain.set(e, nil)
	got, err := svc.Reconcile(ctx, customer, p.Purchase.ID)
	if err != nil || got.CandidateStatus != "MISMATCH" || got.FailureCategory != "TIMING" {
		t.Fatalf("late settlement accepted: %+v %v", got, err)
	}
	second, _, err := svc.Create(ctx, customer, pkg, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Submit(ctx, customer, second.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	svc.Now = func() time.Time { return second.Purchase.ExpiresAt.Add(time.Second) }
	if _, err := svc.Submit(ctx, customer, second.Purchase.ID, strings.Repeat("f", 64)); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("post-expiry candidate replacement: %v", err)
	}
}

func TestObservedMempoolEnablesOnlyBoundedSettlementGrace(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, _ := paymentOffer(t, pool)
	chain := &testChain{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	p, _, err := svc.Create(ctx, customer, pkg, "")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("f", 64)
	if _, err := svc.Submit(ctx, customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	e := paymentEvidence(p, hash, false)
	e.InclusionBlock = 0
	e.IncludedAt = time.Time{}
	e.Transaction.BlockNumber = nil
	e.Transaction.ExecutionResult = nil
	chain.set(e, nil)
	observed, err := svc.Reconcile(ctx, customer, p.Purchase.ID)
	if err != nil || observed.BroadcastObservedAt == nil || !observed.BroadcastObservedAt.Before(p.Purchase.ExpiresAt) {
		t.Fatalf("mempool not observed in-window: %+v %v", observed, err)
	}
	e = paymentEvidence(p, hash, true)
	e.IncludedAt = p.Purchase.ExpiresAt.Add(4 * time.Minute)
	e.FinalizedAt = p.Purchase.ExpiresAt.Add(5 * time.Minute)
	chain.set(e, nil)
	svc.Now = func() time.Time { return p.Purchase.ExpiresAt.Add(6 * time.Minute) }
	completed, err := svc.Reconcile(ctx, customer, p.Purchase.ID)
	if err != nil || completed.PassID == "" {
		t.Fatalf("observed grace not settled: %+v %v", completed, err)
	}
}

func TestBackgroundReconciliationAfterBrowserCloses(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, _ := paymentOffer(t, pool)
	chain := &testChain{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	p, _, err := svc.Create(ctx, customer, pkg, "")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("b", 64)
	if _, err := svc.Submit(ctx, customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	chain.set(paymentEvidence(p, hash, true), nil)
	if err := svc.ReconcileDue(ctx); err != nil {
		t.Fatal(err)
	}
	got, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil || got.Purchase.Status != domain.PurchaseConfirmed || got.PassID == "" {
		t.Fatalf("background did not recover payment: %+v %v", got, err)
	}
}

func TestFinalizedPaymentUsesHistoricalCommercialSnapshot(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, oldRecipient := paymentOffer(t, pool)
	chain := &testChain{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	p, _, err := svc.Create(ctx, customer, pkg, "")
	if err != nil {
		t.Fatal(err)
	}
	newRecipient, _, _ := missionKey(t)
	if _, err := pool.Exec(ctx, `UPDATE passes SET price_luna=88000000,session_count=2 WHERE id=$1`, pkg); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE providers SET payout_wallet=$2 WHERE id=(SELECT provider_id FROM passes WHERE id=$1)`, pkg, newRecipient); err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("c", 64)
	if _, err := svc.Submit(ctx, customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	chain.set(paymentEvidence(p, hash, true), nil)
	got, err := svc.Reconcile(ctx, customer, p.Purchase.ID)
	if err != nil || got.PassID == "" {
		t.Fatalf("historical payment rejected: %+v %v", got, err)
	}
	pass, err := svc.Store.GetPass(ctx, got.PassID, customer.ID)
	if err != nil || pass.Snapshot.PriceLuna != 12_340_000 || pass.RemainingSessions != 10 || p.Purchase.Snapshot.Recipient != domain.WalletAddress(oldRecipient) {
		t.Fatalf("current catalog changed paid pass: %+v %v", pass, err)
	}
}

func assertPaymentCounts(t *testing.T, pool *pgxpool.Pool, purchaseID domain.ID, hash string, receipts, passes, cases, compensationEvents int) {
	t.Helper()
	ctx := context.Background()
	var gotReceipts, gotPasses, gotCases, gotEvents int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM verified_payments WHERE purchase_id=$1 AND transaction_hash=$2`, purchaseID, hash).Scan(&gotReceipts); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchased_passes WHERE purchase_id=$1`, purchaseID).Scan(&gotPasses); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM compensation_cases WHERE purchase_id=$1 AND transaction_hash=$2`, purchaseID, hash).Scan(&gotCases); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchase_events WHERE purchase_id=$1 AND kind='COMPENSATION_REQUIRED'`, purchaseID).Scan(&gotEvents); err != nil {
		t.Fatal(err)
	}
	if gotReceipts != receipts || gotPasses != passes || gotCases != cases || gotEvents != compensationEvents {
		t.Fatalf("counts receipts/passes/cases/events=%d/%d/%d/%d want %d/%d/%d/%d", gotReceipts, gotPasses, gotCases, gotEvents, receipts, passes, cases, compensationEvents)
	}
}

func TestOpenEndedPassCreatesIntentInsideThirtyFiveMinuteWindow(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, _ := paymentOffer(t, pool)
	started := time.Now().UTC()
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: &testChain{}, Network: domain.NimiqTestnet, Now: func() time.Time { return started.Add(40 * time.Minute) }}
	if _, reused, err := svc.Create(ctx, customer, pkg, ""); err != nil || reused {
		t.Fatalf("open-ended pass cutoff: reused=%v err=%v", reused, err)
	}
}

func TestFixedPassCutoffPreservesValidIntentAndSnapshot(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pkg, _ := paymentOffer(t, pool)
	chain := &testChain{}
	started := time.Now().UTC().Truncate(time.Microsecond).Add(time.Second)
	expires := started.Add(domain.PurchaseCutoffBuffer + time.Microsecond)
	if _, err := pool.Exec(ctx, `UPDATE passes SET expiration_at=$2 WHERE id=$1`, pkg, expires); err != nil {
		t.Fatal(err)
	}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: func() time.Time { return started }}
	p, _, err := svc.Create(ctx, customer, pkg, "fixed-cutoff")
	if err != nil {
		t.Fatal(err)
	}
	if p.Purchase.Snapshot.Expiration.ExpiresAt == nil || !p.Purchase.Snapshot.Expiration.ExpiresAt.Equal(expires) {
		t.Fatal("fixed expiry not snapshotted")
	}
	cutoff := expires.Add(-domain.PurchaseCutoffBuffer)
	if !started.Before(cutoff) {
		t.Fatal("fixture is not before cutoff")
	}
	var storedExpiry time.Time
	if err := pool.QueryRow(ctx, `SELECT expiration_at FROM passes WHERE id=$1`, pkg).Scan(&storedExpiry); err != nil || !storedExpiry.Equal(expires) {
		t.Fatalf("cutoff mutated pass expiration: %v %v", storedExpiry, err)
	}
	svc.Now = func() time.Time { return cutoff }
	if _, _, err := svc.Create(ctx, other, pkg, ""); !errors.Is(err, application.ErrPurchaseCutoff) {
		t.Fatalf("intent at cutoff: %v", err)
	}
	svc.Now = func() time.Time { return cutoff.Add(time.Microsecond) }
	if _, _, err := svc.Create(ctx, other, pkg, ""); !errors.Is(err, application.ErrPurchaseCutoff) {
		t.Fatalf("intent after cutoff: %v", err)
	}
	if same, reused, err := svc.Create(ctx, customer, pkg, "fixed-cutoff"); err != nil || !reused || same.Purchase.ID != p.Purchase.ID {
		t.Fatalf("pre-cutoff intent not recoverable: %+v %v %v", same, reused, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE passes SET title='Changed title',price_luna=88000000,expiration_at=$2 WHERE id=$1`, pkg, expires.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE passes SET status='UNAVAILABLE' WHERE id=$1`, pkg); err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("d", 64)
	if _, err := svc.Submit(ctx, customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	e := paymentEvidence(p, hash, true)
	chain.set(e, nil)
	svc.Now = func() time.Time { return started.Add(time.Minute) }
	got, err := svc.Reconcile(ctx, customer, p.Purchase.ID)
	if err != nil || got.Purchase.Status != domain.PurchaseConfirmed || got.PassID == "" {
		t.Fatalf("valid historical payment did not provision pass: %+v %v", got, err)
	}
	pass, err := svc.Store.GetPass(ctx, got.PassID, customer.ID)
	if err != nil || pass.ExpiresAt == nil || !pass.ExpiresAt.Equal(expires) || pass.Snapshot.PassTitle != "Ten sessions" || pass.Snapshot.PriceLuna != 12_340_000 {
		t.Fatalf("historical terms changed: %+v %v", pass, err)
	}
}

func TestFixedPassExpiryAfterFinalityRequiresDurableCompensation(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pkg, _ := paymentOffer(t, pool)
	chain := &testChain{}
	started := time.Now().UTC().Truncate(time.Microsecond).Add(time.Second)
	expires := started.Add(36 * time.Minute)
	if _, err := pool.Exec(ctx, `UPDATE passes SET expiration_at=$2 WHERE id=$1`, pkg, expires); err != nil {
		t.Fatal(err)
	}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: func() time.Time { return started }}
	p, _, err := svc.Create(ctx, customer, pkg, "compensation")
	if err != nil {
		t.Fatal(err)
	}
	otherIntent, _, err := svc.Create(ctx, other, pkg, "other-customer")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("e", 64)
	if _, err := svc.Submit(ctx, customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	e := paymentEvidence(p, hash, true)
	e.IncludedAt = started.Add(time.Minute)
	e.FinalizedAt = expires.Add(time.Minute)
	chain.set(e, nil)
	svc.Now = func() time.Time { return expires.Add(2 * time.Minute) }
	var wg sync.WaitGroup
	errs := make(chan error, 16)
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.Reconcile(ctx, customer, p.Purchase.ID)
			errs <- err
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		errs <- svc.ReconcileDue(ctx)
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	got, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil || got.Purchase.Status != domain.PurchaseCompensationRequired || got.CompensationStatus != "OPEN" || got.CompensationReason != "PASS_EXPIRED_BEFORE_ACTIVATION" || got.PassID != "" || got.Purchase.TransactionHash != hash || got.Purchase.ConfirmedAt == nil {
		t.Fatalf("payment not durably compensated: %+v %v", got, err)
	}
	var receipts, passes, cases, events int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM verified_payments WHERE purchase_id=$1 AND transaction_hash=$2`, p.Purchase.ID, hash).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchased_passes WHERE purchase_id=$1`, p.Purchase.ID).Scan(&passes); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM compensation_cases WHERE purchase_id=$1 AND transaction_hash=$2 AND status='OPEN' AND resolved_at IS NULL AND resolution_kind IS NULL`, p.Purchase.ID, hash).Scan(&cases); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchase_events WHERE purchase_id=$1 AND kind='COMPENSATION_REQUIRED'`, p.Purchase.ID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if receipts != 1 || passes != 0 || cases != 1 || events != 1 {
		t.Fatalf("receipt/pass/case/event counts: %d/%d/%d/%d", receipts, passes, cases, events)
	}
	assertReject(t, pool, `UPDATE compensation_cases SET status='RESOLVED',resolved_at=$2,resolution_kind='MANUAL_REFUND' WHERE purchase_id=$1`, p.Purchase.ID, expires.Add(time.Hour))
	assertReject(t, pool, `UPDATE compensation_cases SET status='RESOLVED',resolved_at=$2,resolution_kind='REISSUE',resolution_reference=' ' WHERE purchase_id=$1`, p.Purchase.ID, expires.Add(time.Hour))
	if _, err := svc.Reconcile(ctx, customer, p.Purchase.ID); err != nil {
		t.Fatalf("terminal reconciliation: %v", err)
	}
	if again, err := svc.Submit(ctx, customer, p.Purchase.ID, hash); err != nil || again.Purchase.Status != domain.PurchaseCompensationRequired {
		t.Fatalf("same payment requested again: %+v %v", again, err)
	}
	if _, err := svc.Submit(ctx, customer, p.Purchase.ID, strings.Repeat("f", 64)); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("second payment accepted: %v", err)
	}
	if again, reused, err := svc.Create(ctx, customer, pkg, "compensation"); err != nil || !reused || again.Purchase.Status != domain.PurchaseCompensationRequired || again.PassID != "" || again.CompensationStatus != "OPEN" {
		t.Fatalf("idempotency key requested another payment: %+v %v %v", again, reused, err)
	}
	listed, err := svc.Store.List(ctx, customer.ID)
	if err != nil || len(listed) == 0 || listed[0].Purchase.Status != domain.PurchaseCompensationRequired || listed[0].PassID != "" || listed[0].CompensationReason != "PASS_EXPIRED_BEFORE_ACTIVATION" {
		t.Fatalf("recovery list lost compensation: %+v %v", listed, err)
	}
	assertPaymentCounts(t, pool, p.Purchase.ID, hash, 1, 0, 1, 1)
	if _, err := svc.Reconcile(ctx, customer, p.Purchase.ID); err != nil {
		t.Fatal(err)
	}
	assertPaymentCounts(t, pool, p.Purchase.ID, hash, 1, 0, 1, 1)
	assertReject(t, pool, `INSERT INTO verified_payments(transaction_hash,purchase_id,sender_wallet,recipient_wallet,value_luna,network,inclusion_block,included_at,finality_block,finalized_at) VALUES($1,$2,$3,$4,12340000,'TESTNET',100,$5,120,$6)`, hash, otherIntent.Purchase.ID, other.Wallet, got.Purchase.Snapshot.Recipient, started, e.FinalizedAt)
	var totalReceipts int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM verified_payments WHERE transaction_hash=$1`, hash).Scan(&totalReceipts); err != nil || totalReceipts != 1 {
		t.Fatalf("verified hash reused: %d %v", totalReceipts, err)
	}
}

func TestFinalityBeforeAndAfterPassExpiry(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pkg, _ := paymentOffer(t, pool)
	started := time.Now().UTC().Truncate(time.Microsecond).Add(time.Second)
	expires := started.Add(36 * time.Minute)
	if _, err := pool.Exec(ctx, `UPDATE passes SET expiration_at=$2 WHERE id=$1`, pkg, expires); err != nil {
		t.Fatal(err)
	}
	chain := &testChain{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: func() time.Time { return started }}
	before, _, err := svc.Create(ctx, customer, pkg, "before")
	if err != nil {
		t.Fatal(err)
	}
	after, _, err := svc.Create(ctx, other, pkg, "after")
	if err != nil {
		t.Fatal(err)
	}
	beforeHash := strings.Repeat("1", 64)
	afterHash := strings.Repeat("2", 64)
	if _, err := svc.Submit(ctx, customer, before.Purchase.ID, beforeHash); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Submit(ctx, other, after.Purchase.ID, afterHash); err != nil {
		t.Fatal(err)
	}
	pending := paymentEvidence(before, beforeHash, false)
	chain.set(pending, nil)
	got, err := svc.Reconcile(ctx, customer, before.Purchase.ID)
	if err != nil || got.PassID != "" || got.Purchase.Status != domain.PurchaseAwaitingFinality || got.CompensationStatus != "" {
		t.Fatalf("premature activation: %+v %v", got, err)
	}
	pendingAfter := paymentEvidence(after, afterHash, false)
	chain.set(pendingAfter, nil)
	got, err = svc.Reconcile(ctx, other, after.Purchase.ID)
	if err != nil || got.PassID != "" || got.Purchase.Status != domain.PurchaseAwaitingFinality || got.CompensationStatus != "" {
		t.Fatalf("premature compensation: %+v %v", got, err)
	}
	finalBefore := paymentEvidence(before, beforeHash, true)
	chain.set(finalBefore, nil)
	svc.Now = func() time.Time { return expires.Add(-time.Minute) }
	got, err = svc.Reconcile(ctx, customer, before.Purchase.ID)
	if err != nil || got.Purchase.Status != domain.PurchaseConfirmed || got.PassID == "" {
		t.Fatalf("finality before expiry: %+v %v", got, err)
	}
	pass, err := svc.Store.GetPass(ctx, got.PassID, customer.ID)
	if err != nil || pass.Status != domain.PurchasedPassActive || pass.OriginalSessions != 10 || pass.RemainingSessions != 10 || pass.UsedSessions != 0 {
		t.Fatalf("pass regression: %+v %v", pass, err)
	}
	assertPaymentCounts(t, pool, before.Purchase.ID, beforeHash, 1, 1, 0, 0)
	finalAfter := paymentEvidence(after, afterHash, true)
	finalAfter.IncludedAt = started.Add(time.Minute)
	finalAfter.FinalizedAt = expires.Add(time.Minute)
	chain.set(finalAfter, nil)
	svc.Now = func() time.Time { return expires.Add(2 * time.Minute) }
	got, err = svc.Reconcile(ctx, other, after.Purchase.ID)
	if err != nil || got.Purchase.Status != domain.PurchaseCompensationRequired || got.PassID != "" || got.Purchase.Status == domain.PurchaseFailed {
		t.Fatalf("finality after expiry: %+v %v", got, err)
	}
	assertPaymentCounts(t, pool, after.Purchase.ID, afterHash, 1, 0, 1, 1)
}
