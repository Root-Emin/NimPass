package database

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// testHead is a chain height the test controls, standing in for the node's own.
type testHead struct {
	mu     sync.Mutex
	number uint32
	err    error
}

func (h *testHead) Head(context.Context, string) (nimiq.ChainHead, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return nimiq.ChainHead{Number: h.number, Hash: strings.Repeat("d", 64)}, h.err
}

func (h *testHead) set(number uint32, err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.number, h.err = number, err
}

// settlementFixture is one purchase with a reported candidate hash, ready to be
// reconciled under whichever policy the test names.
type settlementFixture struct {
	pool     *pgxpool.Pool
	svc      application.Payments
	chain    *testChain
	head     *testHead
	customer application.Identity
	other    application.Identity
	intent   application.PurchaseRecord
	hash     string
}

func newSettlementFixture(t *testing.T, policy domain.ConfirmationPolicy, hash string) settlementFixture {
	t.Helper()
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pkg, _ := paymentOffer(t, pool)
	chain := &testChain{err: nimiq.ErrRPCNotFound}
	head := &testHead{number: 100}
	svc := application.Payments{
		Store: PaymentRepository{Pool: pool}, Chain: chain, Head: head,
		Network: domain.NimiqTestnet, Confirmation: policy, Now: time.Now,
	}
	intent, _, err := svc.Create(ctx, customer, pkg, "click-"+hash[:8])
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Submit(ctx, customer, intent.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	return settlementFixture{pool: pool, svc: svc, chain: chain, head: head, customer: customer, other: other, intent: intent, hash: hash}
}

func (f settlementFixture) reconcile(t *testing.T) application.PurchaseRecord {
	t.Helper()
	got, err := f.svc.Reconcile(context.Background(), f.customer, f.intent.Purchase.ID)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	return got
}

func (f settlementFixture) reload(t *testing.T) application.PurchaseRecord {
	t.Helper()
	got, err := f.svc.Store.Get(context.Background(), f.intent.Purchase.ID, f.customer.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	return got
}

func (f settlementFixture) settlementRow(t *testing.T) (status string, finalityBlock *int64, finalizedAt *time.Time, attempts int) {
	t.Helper()
	err := f.pool.QueryRow(context.Background(), `SELECT settlement_status,finality_block,finalized_at,settlement_attempts FROM verified_payments WHERE transaction_hash=$1`, f.hash).
		Scan(&status, &finalityBlock, &finalizedAt, &attempts)
	if err != nil {
		t.Fatalf("read receipt: %v", err)
	}
	return status, finalityBlock, finalizedAt, attempts
}

func (f settlementFixture) events(t *testing.T) map[string]int {
	t.Helper()
	rows, err := f.pool.Query(context.Background(), `SELECT kind,count(*) FROM purchase_events WHERE purchase_id=$1 GROUP BY kind`, f.intent.Purchase.ID)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var kind string
		var count int
		if err := rows.Scan(&kind, &count); err != nil {
			t.Fatal(err)
		}
		out[kind] = count
	}
	return out
}

// The mission in one test: a fully validated transaction that is in a canonical
// micro block and nothing more must produce a Pass.
//
// Everything asserted here was previously impossible. The purchase waited at
// AWAITING_FINALITY for the macro block — up to a batch, roughly a minute on
// Mainnet — before any of it happened.
func TestInclusionPolicyIssuesThePassBeforeMacroFinality(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnInclusion, strings.Repeat("a", 64))
	f.chain.set(paymentEvidence(f.intent, f.hash, false), nil)

	got := f.reconcile(t)
	if got.Purchase.Status != domain.PurchaseConfirmed {
		t.Fatalf("included payment did not confirm the purchase: %s", got.Purchase.Status)
	}
	if got.PassID == "" {
		t.Fatal("no Pass was created for a validated canonical inclusion")
	}
	if got.Settlement == nil || !got.Settlement.Provisional() {
		t.Fatalf("receipt is not provisional: %+v", got.Settlement)
	}
	if got.Settlement.ExpectedFinalityBlock != 120 || got.Settlement.FinalityBlock != 0 || got.Settlement.FinalizedAt != nil {
		t.Fatalf("provisional receipt claims finality: %+v", got.Settlement)
	}

	// The Pass is the server's, not the screen's. A reload — and a restart, of
	// which a fresh read through the repository is the observable part — must
	// still find it.
	reloaded := f.reload(t)
	if reloaded.PassID != got.PassID || reloaded.Purchase.Status != domain.PurchaseConfirmed {
		t.Fatalf("Pass did not survive a reload: %+v", reloaded)
	}
	pass, err := f.svc.Store.GetPass(context.Background(), got.PassID, f.customer.ID)
	if err != nil || pass.Status != domain.PurchasedPassActive || pass.RemainingSessions != 10 {
		t.Fatalf("provisional Pass is not usable: %+v %v", pass, err)
	}

	status, finalityBlock, finalizedAt, _ := f.settlementRow(t)
	if status != "INCLUDED" || finalityBlock != nil || finalizedAt != nil {
		t.Fatalf("stored receipt is not provisional: %s %v %v", status, finalityBlock, finalizedAt)
	}
	// The audit trail must not claim a certainty the chain had not granted.
	if events := f.events(t); events["PAYMENT_PROVISIONAL"] != 1 || events["PAYMENT_FINALIZED"] != 0 {
		t.Fatalf("event log misstates settlement: %v", events)
	}
}

// The same evidence under the other policy. This is the old behaviour, and it
// has to still be available: the policy is a risk decision, so choosing the
// conservative one must not need a code change.
func TestFinalityPolicyStillWaitsForTheMacroBlock(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnFinality, strings.Repeat("b", 64))
	evidence := paymentEvidence(f.intent, f.hash, false)
	f.chain.set(evidence, nil)

	pending := f.reconcile(t)
	if pending.Purchase.Status != domain.PurchaseAwaitingFinality || pending.CandidateStatus != "AWAITING_FINALITY" {
		t.Fatalf("finality policy settled on inclusion alone: %+v", pending)
	}
	if pending.PassID != "" {
		t.Fatal("finality policy created a Pass before the macro block")
	}
	if pending.Settlement != nil {
		t.Fatalf("finality policy persisted a receipt early: %+v", pending.Settlement)
	}

	evidence.Finalized = true
	evidence.FinalizedAt = evidence.IncludedAt.Add(time.Second)
	f.chain.set(evidence, nil)

	settled := f.reconcile(t)
	if settled.Purchase.Status != domain.PurchaseConfirmed || settled.PassID == "" {
		t.Fatalf("macro finality did not settle: %+v", settled)
	}
	if settled.Settlement == nil || settled.Settlement.Status != domain.SettlementFinalized || settled.Settlement.FinalizedAt == nil {
		t.Fatalf("receipt is not finalised: %+v", settled.Settlement)
	}
	if events := f.events(t); events["PAYMENT_FINALIZED"] != 1 || events["PAYMENT_PROVISIONAL"] != 0 {
		t.Fatalf("event log misstates settlement: %v", events)
	}
}

// Case A: the macro block arrives and the inclusion is still where we left it.
//
// Also the restart case. The work list is a query over stored receipts, so a
// `PromoteDue` on a freshly built service — which is all a restart is, from the
// database's point of view — finds the provisional payment and resumes.
func TestProvisionalReceiptIsPromotedOnceMacroFinalityArrives(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnInclusion, strings.Repeat("c", 64))
	evidence := paymentEvidence(f.intent, f.hash, false)
	f.chain.set(evidence, nil)
	issued := f.reconcile(t)
	if issued.PassID == "" {
		t.Fatal("setup did not issue a Pass")
	}
	ctx := context.Background()

	// The macro block has not been produced. A sweep must leave the receipt
	// alone and must not count it as a failure — a payment one second old is
	// not a payment going wrong.
	if err := f.svc.PromoteDue(ctx); err != nil {
		t.Fatalf("promote before finality: %v", err)
	}
	if status, _, _, attempts := f.settlementRow(t); status != "INCLUDED" || attempts != 0 {
		t.Fatalf("waiting for a macro block was treated as a problem: %s attempts=%d", status, attempts)
	}

	// Now it exists, and the chain still agrees about the inclusion block.
	f.head.set(121, nil)
	evidence.Finalized = true
	evidence.FinalizedAt = evidence.IncludedAt.Add(time.Second)
	f.chain.set(evidence, nil)

	// A fresh service over the same database: nothing about this promotion
	// depends on state the original process was holding.
	clearSettlementBackoff(t, f.pool, f.hash)
	restarted := application.Payments{
		Store: PaymentRepository{Pool: f.pool}, Chain: f.chain, Head: f.head,
		Network: domain.NimiqTestnet, Confirmation: domain.ConfirmOnInclusion, Now: time.Now,
	}
	if err := restarted.PromoteDue(ctx); err != nil {
		t.Fatalf("promote: %v", err)
	}
	status, finalityBlock, finalizedAt, _ := f.settlementRow(t)
	if status != "FINALIZED" || finalityBlock == nil || *finalityBlock != 120 || finalizedAt == nil {
		t.Fatalf("receipt not promoted: %s %v %v", status, finalityBlock, finalizedAt)
	}

	// Idempotent. Three more sweeps — a second replica, a retry, a duplicate
	// timer — must not write a second finalisation or a second Pass.
	for range 3 {
		clearSettlementBackoff(t, f.pool, f.hash)
		if err := restarted.PromoteDue(ctx); err != nil {
			t.Fatalf("repeat promote: %v", err)
		}
	}
	if events := f.events(t); events["PAYMENT_FINALIZED"] != 1 {
		t.Fatalf("finality recorded %d times", events["PAYMENT_FINALIZED"])
	}
	after := f.reload(t)
	if after.PassID != issued.PassID {
		t.Fatalf("promotion changed the Pass: %q -> %q", issued.PassID, after.PassID)
	}
	assertPassCount(t, f.pool, f.intent.Purchase.ID, 1)
}

// Two workers observing the same macro block at the same moment.
func TestConcurrentPromotionFinalisesOnce(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnInclusion, strings.Repeat("1", 64))
	evidence := paymentEvidence(f.intent, f.hash, false)
	f.chain.set(evidence, nil)
	f.reconcile(t)

	f.head.set(121, nil)
	evidence.Finalized = true
	evidence.FinalizedAt = evidence.IncludedAt.Add(time.Second)
	f.chain.set(evidence, nil)

	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- f.svc.PromoteDue(context.Background()) }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil && !errors.Is(err, application.ErrConflict) {
			t.Fatalf("racing promotion: %v", err)
		}
	}
	if status, _, _, _ := f.settlementRow(t); status != "FINALIZED" {
		t.Fatalf("racing promotions left %s", status)
	}
	if events := f.events(t); events["PAYMENT_FINALIZED"] != 1 {
		t.Fatalf("finality recorded %d times", events["PAYMENT_FINALIZED"])
	}
	assertPassCount(t, f.pool, f.intent.Purchase.ID, 1)
}

// Case B: the block the payment was accepted in stopped being canonical, but
// the payment itself survived into the winning chain.
//
// Nothing economic changed, so the purchase and its Pass must stand and only
// the inclusion evidence is corrected. Creating a second Pass here would be
// inventing an entitlement out of a chain reorganisation.
func TestReorgReanchorsTheReceiptAndKeepsTheOnePass(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnInclusion, strings.Repeat("2", 64))
	evidence := paymentEvidence(f.intent, f.hash, false)
	f.chain.set(evidence, nil)
	issued := f.reconcile(t)
	if issued.PassID == "" {
		t.Fatal("setup did not issue a Pass")
	}
	ctx := context.Background()

	// Same transaction, new block, one batch later.
	moved := uint32(104)
	reanchored := evidence
	reanchored.Transaction.BlockNumber = &moved
	reanchored.InclusionBlock = moved
	reanchored.IncludedAt = evidence.IncludedAt.Add(4 * time.Second)
	reanchored.FinalityBlock = 140
	f.chain.set(reanchored, nil)
	f.head.set(121, nil)

	if err := f.svc.PromoteDue(ctx); err != nil {
		t.Fatalf("promote after reorg: %v", err)
	}
	// Re-anchored, not finalised: the payment now waits for a different macro
	// block, and nothing may claim finality over a block it no longer sits in.
	after := f.reload(t)
	if after.Settlement == nil || after.Settlement.Status != domain.SettlementIncluded {
		t.Fatalf("re-anchoring finalised or contested the receipt: %+v", after.Settlement)
	}
	if after.Settlement.InclusionBlock != moved || after.Settlement.ExpectedFinalityBlock != 140 {
		t.Fatalf("evidence not re-anchored: %+v", after.Settlement)
	}
	if after.Purchase.Status != domain.PurchaseConfirmed || after.PassID != issued.PassID {
		t.Fatalf("re-anchoring disturbed the purchase: %s %q", after.Purchase.Status, after.PassID)
	}
	if events := f.events(t); events["PAYMENT_REANCHORED"] != 1 {
		t.Fatalf("re-anchoring not recorded: %v", events)
	}
	assertPassCount(t, f.pool, f.intent.Purchase.ID, 1)

	// And it still reaches finality, from the new height.
	reanchored.Finalized = true
	reanchored.FinalizedAt = reanchored.IncludedAt.Add(time.Second)
	f.chain.set(reanchored, nil)
	f.head.set(141, nil)
	clearSettlementBackoff(t, f.pool, f.hash)
	if err := f.svc.PromoteDue(ctx); err != nil {
		t.Fatalf("promote after re-anchoring: %v", err)
	}
	status, finalityBlock, _, _ := f.settlementRow(t)
	if status != "FINALIZED" || finalityBlock == nil || *finalityBlock != 140 {
		t.Fatalf("re-anchored receipt did not finalise: %s %v", status, finalityBlock)
	}
	assertPassCount(t, f.pool, f.intent.Purchase.ID, 1)
}

// Case C: the transaction never became canonical.
//
// The slowest path in the system on purpose. Absence has to be established
// twice over — the chain past the height where the transaction had to reappear,
// and the node saying so repeatedly — before a Pass is withdrawn, because the
// alternative reading of the same observation is a node that cannot see.
func TestLostTransactionReversesTheSettlementIntoCompensation(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnInclusion, strings.Repeat("3", 64))
	f.chain.set(paymentEvidence(f.intent, f.hash, false), nil)
	issued := f.reconcile(t)
	if issued.PassID == "" {
		t.Fatal("setup did not issue a Pass")
	}
	ctx := context.Background()

	// The transaction is gone from the node's view.
	f.chain.set(nimiq.ChainEvidence{}, nimiq.ErrRPCNotFound)

	// Before the expected macro height, absence proves nothing at all.
	f.head.set(110, nil)
	if err := f.svc.PromoteDue(ctx); err != nil {
		t.Fatalf("early absence: %v", err)
	}
	if status, _, _, _ := f.settlementRow(t); status != "INCLUDED" {
		t.Fatalf("withdrew a Pass before the macro block: %s", status)
	}

	// Past it, but the first two answers still only count as attempts.
	f.head.set(125, nil)
	for i := range settlementAttemptsBeforeContest {
		clearSettlementBackoff(t, f.pool, f.hash)
		if err := f.svc.PromoteDue(ctx); err != nil {
			t.Fatalf("absence %d: %v", i, err)
		}
		status, _, _, attempts := f.settlementRow(t)
		if status != "INCLUDED" || attempts != i+1 {
			t.Fatalf("attempt %d: status=%s attempts=%d", i, status, attempts)
		}
	}

	clearSettlementBackoff(t, f.pool, f.hash)
	if err := f.svc.PromoteDue(ctx); err != nil {
		t.Fatalf("contest: %v", err)
	}

	// The receipt is kept. It is the evidence of what was accepted, on what
	// basis, and at which block — which is the whole record of why a Pass was
	// withdrawn.
	status, finalityBlock, _, _ := f.settlementRow(t)
	if status != "CONTESTED" || finalityBlock != nil {
		t.Fatalf("contested receipt: %s %v", status, finalityBlock)
	}
	var inclusionBlock int64
	var contestReason string
	var contestedAt *time.Time
	if err := f.pool.QueryRow(ctx, `SELECT inclusion_block,contest_reason,contested_at FROM verified_payments WHERE transaction_hash=$1`, f.hash).Scan(&inclusionBlock, &contestReason, &contestedAt); err != nil {
		t.Fatal(err)
	}
	if inclusionBlock != 100 || contestReason != domain.SettlementReversed || contestedAt == nil {
		t.Fatalf("audit trail incomplete: block=%d reason=%s at=%v", inclusionBlock, contestReason, contestedAt)
	}

	// The purchase moves into the recovery state the product already has, in
	// the existing ledger rather than a second one.
	reversed := f.reload(t)
	if reversed.Purchase.Status != domain.PurchaseCompensationRequired {
		t.Fatalf("purchase not moved to compensation: %s", reversed.Purchase.Status)
	}
	if reversed.CompensationStatus != "OPEN" || reversed.CompensationReason != domain.SettlementReversed {
		t.Fatalf("compensation case: %s %s", reversed.CompensationStatus, reversed.CompensationReason)
	}
	if reversed.CandidateStatus != "SETTLEMENT_REVERSED" {
		t.Fatalf("candidate state: %s", reversed.CandidateStatus)
	}

	// Nothing may be spent against a payment that did not happen — and the
	// thing that stops it is the Pass's status, not its counters (ADR-024).
	pass, err := f.svc.Store.GetPass(ctx, issued.PassID, f.customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if pass.Status != domain.PurchasedPassCancelled {
		t.Fatalf("withdrawn Pass not cancelled: %+v", pass)
	}
	var openSessions int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM pass_sessions WHERE purchased_pass_id=$1 AND status IN ('UNSCHEDULED','SCHEDULED')`, issued.PassID).Scan(&openSessions); err != nil {
		t.Fatal(err)
	}
	if openSessions != 0 {
		t.Fatalf("%d sessions left open on a withdrawn Pass", openSessions)
	}

	// The counters still describe what actually happened. This customer
	// attended nothing, so the Pass must not claim they used anything.
	//
	// The regression this pins is a counter that lied in the customer's
	// disfavour: the withdrawal used to write `used_sessions =
	// original_sessions` — forced by `used + remaining = original` once
	// `remaining` was zeroed — so a Pass nobody had used reported every
	// session consumed, and the compensation case was read off that number.
	// Migration 000015 states the invariant this restores: every COMPLETED
	// row corresponds to exactly one increment of `used_sessions`.
	var completedRows, used, remaining, original int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM pass_sessions WHERE purchased_pass_id=$1 AND status='COMPLETED'`, issued.PassID).Scan(&completedRows); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(ctx, `SELECT used_sessions,remaining_sessions,original_sessions FROM purchased_passes WHERE id=$1`, issued.PassID).Scan(&used, &remaining, &original); err != nil {
		t.Fatal(err)
	}
	if used != completedRows {
		t.Fatalf("used_sessions=%d but %d sessions were ever completed", used, completedRows)
	}
	if used+remaining != original {
		t.Fatalf("counters inconsistent: %d + %d != %d", used, remaining, original)
	}

	// And the status alone is what refuses a redemption, at every layer.
	if _, err := f.svc.Store.GetPass(ctx, issued.PassID, f.customer.ID); err != nil {
		t.Fatalf("a withdrawn Pass must still be readable by its owner: %v", err)
	}
	if err := (&pass).ConsumeSession(time.Now().UTC()); err == nil {
		t.Fatal("a cancelled Pass was consumable despite its remaining counter")
	}
	assertPassCount(t, f.pool, f.intent.Purchase.ID, 1)

	// Idempotent, and it never becomes a finalisation afterwards.
	for range 3 {
		clearSettlementBackoff(t, f.pool, f.hash)
		if err := f.svc.PromoteDue(ctx); err != nil {
			t.Fatalf("repeat contest: %v", err)
		}
	}
	events := f.events(t)
	if events["PAYMENT_SETTLEMENT_REVERSED"] != 1 || events["PASS_WITHDRAWN"] != 1 || events["PAYMENT_FINALIZED"] != 0 {
		t.Fatalf("reversal recorded more than once: %v", events)
	}
}

// An unreachable node is not a missing payment, and the finality worker must
// hold that line as firmly as the verifier does.
//
// This is the failure mode that would matter most in production: a rate-limited
// or resyncing endpoint during a normal batch would otherwise withdraw every
// Pass issued in the last minute.
func TestUnavailableRPCNeverContestsASettlement(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnInclusion, strings.Repeat("4", 64))
	f.chain.set(paymentEvidence(f.intent, f.hash, false), nil)
	issued := f.reconcile(t)
	ctx := context.Background()
	f.head.set(200, nil)

	for _, failure := range []error{nimiq.ErrRPCUnavailable, nimiq.ErrRPCRateLimited, nimiq.ErrRPCMalformed, context.DeadlineExceeded} {
		f.chain.set(nimiq.ChainEvidence{}, failure)
		for range settlementAttemptsBeforeContest + 2 {
			clearSettlementBackoff(t, f.pool, f.hash)
			if err := f.svc.PromoteDue(ctx); err != nil {
				t.Fatalf("%v: %v", failure, err)
			}
		}
		if status, _, _, _ := f.settlementRow(t); status != "INCLUDED" {
			t.Fatalf("%v was treated as a missing payment: %s", failure, status)
		}
	}
	// A node that cannot tell us the height is the same kind of ignorance, and
	// it must not be resolved against the customer either.
	f.head.set(0, nimiq.ErrRPCUnavailable)
	f.chain.set(nimiq.ChainEvidence{}, nimiq.ErrRPCNotFound)
	for range settlementAttemptsBeforeContest + 2 {
		clearSettlementBackoff(t, f.pool, f.hash)
		if err := f.svc.PromoteDue(ctx); err != nil {
			t.Fatalf("unknown head: %v", err)
		}
	}
	if status, _, _, _ := f.settlementRow(t); status != "INCLUDED" {
		t.Fatalf("absence without a known head contested the receipt: %s", status)
	}
	still := f.reload(t)
	if still.Purchase.Status != domain.PurchaseConfirmed || still.PassID != issued.PassID {
		t.Fatalf("RPC trouble disturbed a paid purchase: %+v", still)
	}
}

// Mempool is a UI fact, not a settlement. This boundary is the one thing fast
// settlement does not move.
func TestMempoolTransactionNeverCreatesAPassUnderInclusionPolicy(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnInclusion, strings.Repeat("5", 64))
	evidence := paymentEvidence(f.intent, f.hash, false)
	evidence.Transaction.BlockNumber = nil
	evidence.Transaction.ExecutionResult = nil
	evidence.InclusionBlock = 0
	evidence.IncludedAt = time.Time{}
	evidence.FinalityBlock = 0
	f.chain.set(evidence, nil)

	got := f.reconcile(t)
	if got.PassID != "" {
		t.Fatal("a mempool transaction created a Pass")
	}
	if got.Purchase.Status == domain.PurchaseConfirmed {
		t.Fatal("a mempool transaction confirmed a purchase")
	}
	if got.Settlement != nil {
		t.Fatalf("a mempool transaction produced a receipt: %+v", got.Settlement)
	}
	// It may still say "payment detected", which is what the observation is
	// worth and no more.
	if got.CandidateStatus != "SUBMITTED" || got.BroadcastObservedAt == nil {
		t.Fatalf("mempool sighting not recorded for the UI: %+v", got)
	}
	var receipts int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM verified_payments WHERE transaction_hash=$1`, f.hash).Scan(&receipts); err != nil || receipts != 0 {
		t.Fatalf("mempool receipt count %d %v", receipts, err)
	}
}

// Every economic check still runs before a provisional settlement. Removing the
// wait must not have removed any of the validation it was standing next to.
func TestInclusionPolicyStillRefusesEveryBadPayment(t *testing.T) {
	for name, corrupt := range map[string]func(*nimiq.ChainEvidence, application.PurchaseRecord){
		"wrong recipient": func(e *nimiq.ChainEvidence, _ application.PurchaseRecord) {
			e.Transaction.To = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000"
		},
		"wrong amount": func(e *nimiq.ChainEvidence, _ application.PurchaseRecord) {
			value := *e.Transaction.Value + 1
			e.Transaction.Value = &value
		},
		"wrong sender": func(e *nimiq.ChainEvidence, _ application.PurchaseRecord) {
			e.Transaction.From = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000"
			e.Transaction.RecipientData = ""
		},
		"wrong reference": func(e *nimiq.ChainEvidence, _ application.PurchaseRecord) {
			e.Transaction.RecipientData = "4e50313a30303030303030303030303030303030303030303030303030303030"
		},
		"wrong network": func(e *nimiq.ChainEvidence, _ application.PurchaseRecord) {
			mainnet := uint8(24)
			e.Transaction.NetworkID = &mainnet
		},
		"failed execution": func(e *nimiq.ChainEvidence, _ application.PurchaseRecord) {
			no := false
			e.Transaction.ExecutionResult = &no
		},
		"contract recipient": func(e *nimiq.ChainEvidence, _ application.PurchaseRecord) {
			htlc := uint8(2)
			e.Transaction.ToType = &htlc
		},
		"signalling flags": func(e *nimiq.ChainEvidence, _ application.PurchaseRecord) {
			flag := uint8(1)
			e.Transaction.Flags = &flag
		},
		"unsigned": func(e *nimiq.ChainEvidence, _ application.PurchaseRecord) {
			e.Transaction.Proof = ""
		},
		"inclusion before the intent existed": func(e *nimiq.ChainEvidence, p application.PurchaseRecord) {
			e.IncludedAt = p.Purchase.CreatedAt.Add(-time.Hour)
		},
		"inclusion beyond the settlement grace": func(e *nimiq.ChainEvidence, p application.PurchaseRecord) {
			e.IncludedAt = p.Purchase.ExpiresAt.Add(time.Hour)
		},
		"no macro height to wait for": func(e *nimiq.ChainEvidence, _ application.PurchaseRecord) {
			// A receipt that cannot name the block it is waiting for could
			// never be promoted or contested, so it may not be written.
			e.FinalityBlock = 0
		},
	} {
		t.Run(name, func(t *testing.T) {
			f := newSettlementFixture(t, domain.ConfirmOnInclusion, settlementHash(name))
			evidence := paymentEvidence(f.intent, f.hash, false)
			corrupt(&evidence, f.intent)
			f.chain.set(evidence, nil)

			got := f.reconcile(t)
			if got.PassID != "" {
				t.Fatalf("%s produced a Pass", name)
			}
			if got.Purchase.Status == domain.PurchaseConfirmed {
				t.Fatalf("%s confirmed the purchase", name)
			}
			if got.Settlement != nil {
				t.Fatalf("%s produced a receipt: %+v", name, got.Settlement)
			}
		})
	}
}

// One transaction funds one purchase, and a provisional receipt reserves its
// hash exactly as firmly as a finalised one.
//
// The reservation lives in `verified_payments`' primary key, not in the
// candidate table — reporting a hash was never a claim on it. What matters here
// is that the claim is now made a minute earlier than it used to be, and is no
// weaker for it.
func TestProvisionalReceiptStillClaimsTheHashExclusively(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnInclusion, strings.Repeat("6", 64))
	f.chain.set(paymentEvidence(f.intent, f.hash, false), nil)
	issued := f.reconcile(t)
	if issued.PassID == "" {
		t.Fatal("setup did not issue a Pass")
	}
	ctx := context.Background()

	// A second purchase — another customer, same pass — reporting the same
	// transaction. Reporting it is allowed; settling on it is not.
	second, _, err := f.svc.Create(ctx, f.other, f.intent.Purchase.Snapshot.PassID, "click-second")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Submit(ctx, f.other, second.Purchase.ID, f.hash); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Reconcile(ctx, f.other, second.Purchase.ID); err != nil && !errors.Is(err, application.ErrConflict) {
		t.Fatalf("second claim: %v", err)
	}
	stolen, err := f.svc.Store.Get(ctx, second.Purchase.ID, f.other.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stolen.Purchase.Status == domain.PurchaseConfirmed || stolen.PassID != "" {
		t.Fatalf("one transaction funded two purchases: %+v", stolen)
	}

	var receipts int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM verified_payments WHERE transaction_hash=$1`, f.hash).Scan(&receipts); err != nil || receipts != 1 {
		t.Fatalf("receipts for one transaction: %d %v", receipts, err)
	}
	assertPassCount(t, f.pool, second.Purchase.ID, 0)
}

// Concurrent reconciliation of one purchase, with only an inclusion to go on.
// The whole race now happens in the window that used to be a minute of waiting,
// so the guarantee matters more than it did, not less.
func TestConcurrentInclusionSettlementIssuesOnePass(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnInclusion, strings.Repeat("7", 64))
	f.chain.set(paymentEvidence(f.intent, f.hash, false), nil)

	var wg sync.WaitGroup
	results := make(chan application.PurchaseRecord, 12)
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, err := f.svc.Reconcile(context.Background(), f.customer, f.intent.Purchase.ID)
			if err == nil {
				results <- got
			}
		}()
	}
	wg.Wait()
	close(results)
	passes := map[domain.ID]bool{}
	for got := range results {
		if got.PassID != "" {
			passes[got.PassID] = true
		}
	}
	if len(passes) != 1 {
		t.Fatalf("racing reconciliations produced %d distinct Passes", len(passes))
	}
	assertPassCount(t, f.pool, f.intent.Purchase.ID, 1)
	var receipts int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM verified_payments WHERE purchase_id=$1`, f.intent.Purchase.ID).Scan(&receipts); err != nil || receipts != 1 {
		t.Fatalf("receipts: %d %v", receipts, err)
	}
}

// The existing late-payment policy, under the new settlement path.
//
// A valid payment for a pass that expired before it could be activated still
// becomes a compensation case and still issues no Pass. Faster settlement must
// not have turned this into an entitlement.
func TestLateButValidInclusionStillCompensatesInsteadOfIssuing(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pass, _ := paymentOffer(t, pool)
	started := time.Now().UTC().Truncate(time.Microsecond).Add(time.Second)
	// Just inside the purchase cutoff, so the intent is legal to create and
	// the pass expires while it is still live.
	expires := started.Add(36 * time.Minute)
	if _, err := pool.Exec(ctx, `UPDATE passes SET expiration_at=$2 WHERE id=$1`, pass, expires); err != nil {
		t.Fatal(err)
	}
	chain := &testChain{err: nimiq.ErrRPCNotFound}
	svc := application.Payments{
		Store: PaymentRepository{Pool: pool}, Chain: chain, Head: &testHead{number: 100},
		Network: domain.NimiqTestnet, Confirmation: domain.ConfirmOnInclusion,
		Now: func() time.Time { return started },
	}
	intent, _, err := svc.Create(ctx, customer, pass, "click-late")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("8", 64)
	if _, err := svc.Submit(ctx, customer, intent.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	evidence := paymentEvidence(intent, hash, false)
	evidence.IncludedAt = started.Add(time.Minute)
	chain.set(evidence, nil)
	svc.Now = func() time.Time { return expires.Add(time.Minute) }

	got, err := svc.Reconcile(ctx, customer, intent.Purchase.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Purchase.Status != domain.PurchaseCompensationRequired || got.PassID != "" {
		t.Fatalf("late inclusion issued a Pass: %+v", got)
	}
	if got.CompensationReason != domain.PassExpiredBeforeActivation {
		t.Fatalf("wrong compensation reason: %s", got.CompensationReason)
	}
	// The receipt is provisional here too, and its finality is still tracked —
	// a compensation case needs to know whether the money it is about is real.
	if got.Settlement == nil || !got.Settlement.Provisional() {
		t.Fatalf("compensation receipt: %+v", got.Settlement)
	}
}

// Restart recovery, stated on its own because the architecture depends on it.
//
// The window this mission opened — Pass issued, payment not yet irreversible —
// is the one interval where a crash could strand economic state. So nothing
// about it may live in the process: the work list is a query, the deadline is a
// stored column, and the attempt count is a row. A service built from nothing
// but a pool must be able to finish what its predecessor started.
func TestRestartResumesFinalityTrackingFromTheDatabaseAlone(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnInclusion, settlementHash("restart"))
	evidence := paymentEvidence(f.intent, f.hash, false)
	f.chain.set(evidence, nil)
	issued := f.reconcile(t)
	if issued.PassID == "" || issued.Settlement == nil || !issued.Settlement.Provisional() {
		t.Fatalf("setup did not issue a Pass on a provisional receipt: %+v", issued)
	}
	ctx := context.Background()

	// The process is gone. Everything below runs on a service that has never
	// seen this purchase, holding no timers, no caches and no queue.
	fresh := func() application.Payments {
		return application.Payments{
			Store: PaymentRepository{Pool: f.pool}, Chain: f.chain, Head: f.head,
			Network: domain.NimiqTestnet, Confirmation: domain.ConfirmOnInclusion, Now: time.Now,
		}
	}

	// 1. The receipt is still findable as outstanding work.
	due, err := PaymentRepository{Pool: f.pool}.DueSettlements(ctx, time.Now().UTC(), 10)
	if err != nil {
		t.Fatalf("due settlements: %v", err)
	}
	var found bool
	for _, item := range due {
		if item.Receipt.Hash == f.hash {
			found = true
			if item.Receipt.InclusionBlock != evidence.InclusionBlock || item.PurchaseID != f.intent.Purchase.ID {
				t.Fatalf("recovered receipt lost its evidence: %+v", item)
			}
		}
	}
	if !found {
		t.Fatal("a provisional receipt was invisible to a restarted worker")
	}

	// 2. The reconciler still knows to run at its active tempo, which is what
	// keeps the unnoticed-reorg window short rather than half a minute long.
	live, err := PaymentRepository{Pool: f.pool}.HasLiveIntents(ctx, time.Now().UTC())
	if err != nil || !live {
		t.Fatalf("restarted reconciler saw no live work: %v %v", live, err)
	}

	// 3. Tracking resumes and completes.
	f.head.set(121, nil)
	evidence.Finalized = true
	evidence.FinalizedAt = evidence.IncludedAt.Add(time.Second)
	f.chain.set(evidence, nil)
	if err := fresh().PromoteDue(ctx); err != nil {
		t.Fatalf("promote after restart: %v", err)
	}
	if status, block, at, _ := f.settlementRow(t); status != "FINALIZED" || block == nil || at == nil {
		t.Fatalf("restarted worker did not finalise: %s %v %v", status, block, at)
	}

	// 4. A second restart re-reads a finalised receipt and does nothing with
	// it: no second finalisation event, no second Pass, no re-entitlement.
	clearSettlementBackoff(t, f.pool, f.hash)
	if err := fresh().PromoteDue(ctx); err != nil {
		t.Fatalf("promote after second restart: %v", err)
	}
	if events := f.events(t); events["PAYMENT_FINALIZED"] != 1 {
		t.Fatalf("finality recorded %d times across restarts", events["PAYMENT_FINALIZED"])
	}
	after := f.reload(t)
	if after.PassID != issued.PassID || after.Purchase.Status != domain.PurchaseConfirmed {
		t.Fatalf("restart changed the customer's outcome: %+v", after)
	}
	assertPassCount(t, f.pool, f.intent.Purchase.ID, 1)

	// And a finalised receipt stops being work at all, so the sweep does not
	// carry every historical payment forever.
	settled, err := PaymentRepository{Pool: f.pool}.DueSettlements(ctx, time.Now().UTC(), 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range settled {
		if item.Receipt.Hash == f.hash {
			t.Fatal("a finalised receipt is still queued for promotion")
		}
	}
}

// The schema's own guarantees, independent of any Go code that writes to it.
//
// Migration 000017 made the finality columns nullable, which is the change that
// lets a provisional payment exist at all — and the whole risk of that change
// is a row that claims more certainty than it has. So every rule the old NOT
// NULL columns implied is asserted here against a live database: not as
// something the application promises, but as something the database refuses.
func TestProvisionalSettlementConstraints(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnInclusion, strings.Repeat("9", 64))
	f.chain.set(paymentEvidence(f.intent, f.hash, false), nil)
	if f.reconcile(t).PassID == "" {
		t.Fatal("setup did not issue a Pass")
	}
	ctx := context.Background()
	reject := func(name, statement string, args ...any) {
		t.Helper()
		if _, err := f.pool.Exec(ctx, statement, args...); err == nil {
			t.Fatalf("database accepted %s", name)
		}
	}
	hash := f.hash
	at := time.Now().UTC()

	reject("a provisional receipt carrying a finality block",
		`UPDATE verified_payments SET finality_block=120 WHERE transaction_hash=$1`, hash)
	reject("a provisional receipt carrying a finality timestamp",
		`UPDATE verified_payments SET finalized_at=$2 WHERE transaction_hash=$1`, hash, at)
	reject("finality without naming its macro block",
		`UPDATE verified_payments SET settlement_status='FINALIZED' WHERE transaction_hash=$1`, hash)
	reject("finality without the moment it happened",
		`UPDATE verified_payments SET settlement_status='FINALIZED',finality_block=120 WHERE transaction_hash=$1`, hash)
	reject("a macro block at or below the inclusion block",
		`UPDATE verified_payments SET settlement_status='FINALIZED',finality_block=100,finalized_at=$2 WHERE transaction_hash=$1`, hash, at)
	reject("finality predating the block it finalises",
		`UPDATE verified_payments SET settlement_status='FINALIZED',finality_block=120,finalized_at=included_at - interval '1 second' WHERE transaction_hash=$1`, hash)
	reject("a contest with no reason",
		`UPDATE verified_payments SET settlement_status='CONTESTED',contested_at=$2 WHERE transaction_hash=$1`, hash, at)
	reject("a finalised receipt that is also contested",
		`UPDATE verified_payments SET settlement_status='FINALIZED',finality_block=120,finalized_at=$2,contested_at=$2,contest_reason='X' WHERE transaction_hash=$1`, hash, at)
	reject("an invented settlement state",
		`UPDATE verified_payments SET settlement_status='PROBABLY_FINE' WHERE transaction_hash=$1`, hash)
	reject("an expected macro block at or below the inclusion block",
		`UPDATE verified_payments SET expected_finality_block=100 WHERE transaction_hash=$1`, hash)
	reject("a receipt with no inclusion at all",
		`UPDATE verified_payments SET inclusion_block=NULL WHERE transaction_hash=$1`, hash)
	reject("a receipt with no inclusion time",
		`UPDATE verified_payments SET included_at=NULL WHERE transaction_hash=$1`, hash)
	reject("a negative attempt count",
		`UPDATE verified_payments SET settlement_attempts=-1 WHERE transaction_hash=$1`, hash)

	// And the shape that is now legal, which is the point of the migration.
	if _, err := f.pool.Exec(ctx, `UPDATE verified_payments SET settlement_status='FINALIZED',finality_block=120,finalized_at=included_at WHERE transaction_hash=$1`, hash); err != nil {
		t.Fatalf("a correctly finalised receipt was refused: %v", err)
	}
}

// settlementAttemptsBeforeContest mirrors the application's own threshold. Kept
// as a local constant rather than exported: a test that could read the real one
// would pass if the real one became 1.
const settlementAttemptsBeforeContest = 2

// clearSettlementBackoff makes a receipt due again without waiting out its
// backoff, which is what the backoff is for and what a test cannot afford.
func clearSettlementBackoff(t *testing.T, pool *pgxpool.Pool, hash string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `UPDATE verified_payments SET settlement_checked_at=NULL WHERE transaction_hash=$1`, hash); err != nil {
		t.Fatal(err)
	}
}

// settlementHash turns a subtest name into a distinct valid transaction hash.
func settlementHash(name string) string {
	hash := make([]byte, 0, 64)
	for i := 0; len(hash) < 64; i++ {
		hash = append(hash, "0123456789abcdef"[(int(name[i%len(name)])+i)%16])
	}
	return string(hash)
}

func assertPassCount(t *testing.T, pool *pgxpool.Pool, purchaseID domain.ID, want int) {
	t.Helper()
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM purchased_passes WHERE purchase_id=$1`, purchaseID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("purchase has %d Passes, want %d", count, want)
	}
}

// The case the old withdrawal destroyed: a reversal after real sessions were
// delivered.
//
// This is where `used_sessions = original_sessions` did its actual damage. A
// customer who attended two of ten sessions had a withdrawn Pass reporting ten
// used, and the compensation case — the thing a human settles the money on —
// was read off that number. The provider's two delivered sessions and the
// customer's eight undelivered ones became indistinguishable.
//
// What must survive a withdrawal: the count of what was delivered, the count of
// what was not, and the COMPLETED rows that say which was which.
func TestWithdrawalKeepsTheRecordOfSessionsAlreadyDelivered(t *testing.T) {
	f := newSettlementFixture(t, domain.ConfirmOnInclusion, strings.Repeat("7", 64))
	ctx := context.Background()
	f.chain.set(paymentEvidence(f.intent, f.hash, false), nil)
	issued := f.reconcile(t)
	if issued.PassID == "" {
		t.Fatal("no Pass issued")
	}

	// The provider records delivering two sessions, through the ordinary path.
	var providerOwner domain.ID
	if err := f.pool.QueryRow(ctx, `SELECT pr.owner_identity_id FROM purchased_passes pa JOIN providers pr ON pr.id=pa.provider_id WHERE pa.id=$1`, issued.PassID).Scan(&providerOwner); err != nil {
		t.Fatal(err)
	}
	repo := PaymentRepository{Pool: f.pool}
	for i := 0; i < 2; i++ {
		sessions, err := repo.ListPassSessions(ctx, issued.PassID, providerOwner)
		if err != nil {
			t.Fatalf("list sessions: %v", err)
		}
		var next domain.ID
		for _, s := range sessions {
			if s.Status != domain.PassSessionCompleted && s.Status != domain.PassSessionCancelled {
				next = s.ID
				break
			}
		}
		if next == "" {
			t.Fatalf("no open session to deliver (iteration %d)", i)
		}
		if _, _, err := repo.CompleteSession(ctx, next, providerOwner, time.Now().UTC()); err != nil {
			t.Fatalf("complete session %d: %v", i, err)
		}
	}

	// Then the payment turns out never to have become canonical.
	f.head.set(200, nil)
	f.chain.set(nimiq.ChainEvidence{}, nimiq.ErrRPCNotFound)
	for i := 0; i <= settlementAttemptsBeforeContest; i++ {
		clearSettlementBackoff(t, f.pool, f.hash)
		if err := f.svc.PromoteDue(ctx); err != nil {
			t.Fatalf("absence %d: %v", i, err)
		}
	}
	if reversed := f.reload(t); reversed.Purchase.Status != domain.PurchaseCompensationRequired {
		t.Fatalf("settlement not reversed: %s", reversed.Purchase.Status)
	}

	var completed, cancelled, used, remaining, original int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status='COMPLETED'), count(*) FILTER (WHERE status='CANCELLED') FROM pass_sessions WHERE purchased_pass_id=$1`, issued.PassID).Scan(&completed, &cancelled); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(ctx, `SELECT used_sessions,remaining_sessions,original_sessions FROM purchased_passes WHERE id=$1`, issued.PassID).Scan(&used, &remaining, &original); err != nil {
		t.Fatal(err)
	}

	// Two delivered, and they stay delivered.
	if completed != 2 || used != 2 {
		t.Fatalf("delivered sessions lost: COMPLETED=%d used_sessions=%d, want 2 and 2", completed, used)
	}
	// The rest are cancelled, and the counter agrees they were never used.
	if cancelled != original-2 || remaining != original-2 {
		t.Fatalf("undelivered sessions: CANCELLED=%d remaining=%d, want %d each", cancelled, remaining, original-2)
	}
	// The invariant migration 000015 states, restated as an assertion.
	if used != completed || used+remaining != original {
		t.Fatalf("counters and rows disagree: used=%d completed=%d remaining=%d original=%d", used, completed, remaining, original)
	}
}
