package database

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// The two checkout entry paths reach exactly one settlement pipeline.
//
// The frontend now chooses how a transaction is *initiated* from the device
// class: a phone calls the Nimiq provider directly, a desktop shows a QR and
// the customer's phone pays the same intent after opening it. That choice is
// UX only, and this file is where that claim is held to account — the backend
// must be unable to tell the two apart, and must not have gained a softer route
// in the process.
//
// What actually differs on the wire is small and entirely benign: in the
// desktop path the wallet dispatch and the transaction hash arrive on a later
// request, from a different device, against an intent created earlier. Nothing
// about the terms, the verification or the issuance changes, and these tests
// exist to prove that both by construction and by counting Passes.

// desktopQrSettlement walks the desktop path end to end: intent created on one
// device, paid from another, verified by the same code as everything else.
func TestDesktopQrEntryPathSettlesThroughTheSamePipeline(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pass, _ := paymentOffer(t, pool)
	chain := &testChain{err: nimiq.ErrRPCNotFound}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}

	// 1. The desktop creates the intent. This is the only thing it ever does.
	intent, _, err := svc.Create(ctx, customer, pass, "desktop-buy")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !strings.HasPrefix(string(intent.Purchase.PaymentReference), "NP1:") {
		t.Fatalf("server must author the reference, got %q", intent.Purchase.PaymentReference)
	}
	// The terms the QR will carry are the server's snapshot, not anything the
	// client proposed.
	if intent.Purchase.Snapshot.PriceLuna == 0 || intent.Purchase.Snapshot.Recipient == "" {
		t.Fatalf("intent must snapshot recipient and price: %+v", intent.Purchase.Snapshot)
	}
	if intent.Purchase.ExpectedWallet != domain.WalletAddress(customer.Wallet) {
		t.Fatal("intent must bind the authenticated customer wallet")
	}

	// 2. The desktop watches. Polling is read-only: reading a purchase over and
	//    over cannot move it, and reconciling before any hash exists is a no-op.
	for range 5 {
		if _, err := svc.Store.Get(ctx, intent.Purchase.ID, customer.ID); err != nil {
			t.Fatalf("desktop poll: %v", err)
		}
		if _, err := svc.Reconcile(ctx, customer, intent.Purchase.ID); err != nil {
			t.Fatalf("desktop reconcile: %v", err)
		}
	}
	watched, err := svc.Store.Get(ctx, intent.Purchase.ID, customer.ID)
	if err != nil || watched.CandidateHash != "" || watched.Purchase.Status != intent.Purchase.Status {
		t.Fatalf("polling changed the purchase: %+v %v", watched, err)
	}

	// 3. The QR is a locator, so the phone has to authenticate as this customer
	//    to load it at all. Knowing the id is worth nothing on its own.
	if _, err := svc.Store.Get(ctx, intent.Purchase.ID, other.ID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("purchase id must not be a bearer credential: %v", err)
	}

	// 4. The phone takes the single wallet dispatch and reports its hash. This
	//    is the identical call the mobile path makes; only the device differs.
	attempt := paymentID(t)
	if _, err := svc.Store.BeginWalletAttempt(ctx, intent.Purchase.ID, customer.ID, attempt, time.Now().UTC()); err != nil {
		t.Fatalf("wallet attempt: %v", err)
	}
	hash := strings.Repeat("c", 64)
	if _, err := svc.Submit(ctx, customer, intent.Purchase.ID, hash); err != nil {
		t.Fatalf("phone submission: %v", err)
	}

	// 5. Verification. Every check the mobile path is subject to applies here,
	//    because it is literally the same function.
	evidence := paymentEvidence(intent, hash, false)
	chain.set(evidence, nil)
	pending, err := svc.Reconcile(ctx, customer, intent.Purchase.ID)
	if err != nil || pending.CandidateStatus != "AWAITING_FINALITY" {
		t.Fatalf("finality must still be required: %+v %v", pending, err)
	}
	if pending.PassID != "" {
		t.Fatal("no Pass may exist before finality")
	}

	evidence.Finalized = true
	evidence.FinalityBlock = 120
	evidence.FinalizedAt = time.Now().UTC()
	chain.set(evidence, nil)

	// 6. The desktop is still polling while the phone is done. Concurrent
	//    reconciliation from both devices must settle exactly once.
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.Reconcile(ctx, customer, intent.Purchase.ID)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent settlement: %v", err)
		}
	}

	settled, err := svc.Store.Get(ctx, intent.Purchase.ID, customer.ID)
	if err != nil || settled.Purchase.Status != domain.PurchaseConfirmed || settled.PassID == "" {
		t.Fatalf("desktop path must confirm: %+v %v", settled, err)
	}

	var receipts, passes int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM verified_payments WHERE purchase_id=$1`, intent.Purchase.ID).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchased_passes WHERE purchase_id=$1`, intent.Purchase.ID).Scan(&passes); err != nil {
		t.Fatal(err)
	}
	if receipts != 1 || passes != 1 {
		t.Fatalf("exactly one receipt and one Pass required: receipts=%d passes=%d", receipts, passes)
	}

	// 7. The Pass belongs to the customer the intent was issued for, and to
	//    nobody else — including whoever happened to hold the phone.
	owned, err := svc.Store.GetPass(ctx, settled.PassID, customer.ID)
	if err != nil || owned.OwnerWallet != domain.WalletAddress(customer.Wallet) {
		t.Fatalf("pass ownership: %+v %v", owned, err)
	}
	if _, err := svc.Store.GetPass(ctx, settled.PassID, other.ID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("pass must not be readable by another identity: %v", err)
	}

	// 8. The binding is not merely application logic. `purchased_passes` is
	//    joined to the purchase by its *verified on-chain sender*, so a Pass
	//    whose owner is not the wallet that actually paid cannot be stored at
	//    all — which is what makes paying from a second device safe.
	var owner, sender string
	if err := pool.QueryRow(ctx, `
		SELECT pp.owner_wallet, p.verified_sender_wallet
		FROM purchased_passes pp JOIN purchases p ON p.id = pp.purchase_id
		WHERE pp.purchase_id = $1`, intent.Purchase.ID).Scan(&owner, &sender); err != nil {
		t.Fatal(err)
	}
	if owner != customer.Wallet || sender != customer.Wallet {
		t.Fatalf("owner/sender binding broken: owner=%s sender=%s want=%s", owner, sender, customer.Wallet)
	}
}

// The case that used to strand a real payment forever.
//
// Nimiq Pay pays from whichever account the customer approves, and its
// provider API exposes no sender parameter — so a customer with two accounts
// in one wallet can pay perfectly and have the transaction arrive from an
// address Nimpass was not expecting. The old rule refused it as SENDER, which
// meant real NIM moved and no Pass could ever be issued.
//
// It settles now, because the transaction carries the intent's own payment
// reference: 16 random bytes the server issued for this one purchase and told
// nobody else. The correlation is stronger than an address, not weaker.
//
// What must *not* move is ownership. The Pass belongs to the authenticated
// buyer who created the intent, never to whichever address happened to pay.
func TestReferencedPaymentFromAnotherAccountSettlesToTheBuyer(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pass, _ := paymentOffer(t, pool)
	chain := &testChain{err: nimiq.ErrRPCNotFound}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}

	intent, _, err := svc.Create(ctx, customer, pass, "desktop-buy")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	hash := strings.Repeat("d", 64)
	if _, err := svc.Submit(ctx, customer, intent.Purchase.ID, hash); err != nil {
		t.Fatalf("submit: %v", err)
	}

	// Right recipient, right amount, right reference — and a sender the intent
	// never named. Exactly what a second account in the paying wallet produces.
	evidence := paymentEvidence(intent, hash, true)
	evidence.Transaction.From = other.Wallet
	chain.set(evidence, nil)

	got, err := svc.Reconcile(ctx, customer, intent.Purchase.ID)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if got.Purchase.Status != domain.PurchaseConfirmed {
		t.Fatalf("a referenced payment must settle, got %s/%s", got.Purchase.Status, got.FailureCategory)
	}
	if got.PassID == "" {
		t.Fatal("a settled payment must issue a Pass")
	}

	// The Pass is the buyer's. The payer is recorded, not enthroned.
	owned, err := PaymentRepository{Pool: pool}.GetPass(ctx, got.PassID, customer.ID)
	if err != nil {
		t.Fatalf("the buyer cannot read the Pass they bought: %v", err)
	}
	if owned.OwnerIdentityID != customer.ID {
		t.Fatalf("pass owner %q is not the buyer %q", owned.OwnerIdentityID, customer.ID)
	}
	if string(owned.OwnerWallet) != customer.Wallet {
		t.Fatalf("owner wallet %q is not the buyer's %q", owned.OwnerWallet, customer.Wallet)
	}
	var sender string
	if err := pool.QueryRow(ctx, `SELECT verified_sender_wallet FROM purchases WHERE id=$1`, intent.Purchase.ID).Scan(&sender); err != nil {
		t.Fatal(err)
	}
	if sender != other.Wallet {
		t.Fatalf("the paying address must still be recorded, got %q", sender)
	}
}

// The other half of the same rule: with nothing purchase-specific on chain,
// the sender is all that separates this customer's payment from a stranger's
// transfer of the same amount to the same provider — so it stays mandatory.
func TestUnreferencedPaymentFromAnotherWalletIssuesNoPass(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pass, _ := paymentOffer(t, pool)
	chain := &testChain{err: nimiq.ErrRPCNotFound}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}

	intent, _, err := svc.Create(ctx, customer, pass, "desktop-buy")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	hash := strings.Repeat("d", 64)
	if _, err := svc.Submit(ctx, customer, intent.Purchase.ID, hash); err != nil {
		t.Fatalf("submit: %v", err)
	}
	evidence := paymentEvidence(intent, hash, true)
	evidence.Transaction.From = other.Wallet
	evidence.Transaction.RecipientData = ""
	chain.set(evidence, nil)

	got, err := svc.Reconcile(ctx, customer, intent.Purchase.ID)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if got.CandidateStatus != "MISMATCH" || got.FailureCategory != "SENDER" {
		t.Fatalf("an unreferenced payment from another wallet must be refused as SENDER: %+v", got)
	}
	if got.PassID != "" {
		t.Fatal("no Pass may be issued for an unreferenced payment from the wrong wallet")
	}
	var passes int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchased_passes WHERE purchase_id=$1`, intent.Purchase.ID).Scan(&passes); err != nil {
		t.Fatal(err)
	}
	if passes != 0 {
		t.Fatalf("expected no Pass, found %d", passes)
	}
}

// Whichever device reported it, one on-chain transaction settles one purchase.
// The desktop path must not become a way to reuse a hash across intents.
func TestOneTransactionSettlesOnePurchaseAcrossEntryPaths(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pass, _ := paymentOffer(t, pool)
	chain := &testChain{err: nimiq.ErrRPCNotFound}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}

	// Paid the "mobile" way: dispatch lock, then hash.
	first, _, err := svc.Create(ctx, customer, pass, "mobile-buy")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := svc.Store.BeginWalletAttempt(ctx, first.Purchase.ID, customer.ID, paymentID(t), time.Now().UTC()); err != nil {
		t.Fatalf("wallet attempt: %v", err)
	}
	hash := strings.Repeat("e", 64)
	if _, err := svc.Submit(ctx, customer, first.Purchase.ID, hash); err != nil {
		t.Fatalf("submit: %v", err)
	}
	chain.set(paymentEvidence(first, hash, true), nil)
	if _, err := svc.Reconcile(ctx, customer, first.Purchase.ID); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	settled, err := svc.Store.Get(ctx, first.Purchase.ID, customer.ID)
	if err != nil || settled.PassID == "" {
		t.Fatalf("first purchase must confirm: %+v %v", settled, err)
	}

	// Now the same hash is offered against a second intent — what a confused
	// desktop, a replayed QR or a retried phone would produce.
	//
	// The first pass is spent to the end first, because a second intent for a
	// Pass the customer is still holding is refused before any of this can be
	// reached. That is Buy Again, and it leaves the replay question untouched.
	completePass(t, pool, settled.PassID)
	second, _, err := svc.Create(ctx, customer, pass, "desktop-buy")
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	if _, err := svc.Submit(ctx, customer, second.Purchase.ID, hash); err != nil {
		t.Fatalf("a candidate hash is only a hint and may be offered: %v", err)
	}

	// The real transaction carries the *first* purchase's reference, because a
	// transaction has exactly one data field. That is the check that actually
	// fires in production, and it fires on the reference bytes.
	chain.set(paymentEvidence(first, hash, true), nil)
	if _, err := svc.Reconcile(ctx, customer, second.Purchase.ID); err != nil {
		t.Fatalf("reconcile second: %v", err)
	}
	reused, err := svc.Store.Get(ctx, second.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reused.PassID != "" || reused.CandidateStatus != "MISMATCH" || reused.FailureCategory != "DATA" {
		t.Fatalf("one transaction must not settle two purchases: %+v", reused)
	}

	// Defence in depth. Suppose the reference check could somehow be satisfied
	// twice — the unique constraint on verified payments still refuses, so a
	// second Pass cannot be reached by any route.
	third, _, err := svc.Create(ctx, customer, pass, "third-buy")
	if err != nil {
		t.Fatalf("create third: %v", err)
	}
	if _, err := svc.Submit(ctx, customer, third.Purchase.ID, hash); err != nil {
		t.Fatalf("submit third: %v", err)
	}
	chain.set(paymentEvidence(third, hash, true), nil)
	if _, err := svc.Reconcile(ctx, customer, third.Purchase.ID); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("a verified hash must be globally unique, got %v", err)
	}

	var passes int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchased_passes WHERE owner_wallet=$1`, customer.Wallet).Scan(&passes); err != nil {
		t.Fatal(err)
	}
	if passes != 1 {
		t.Fatalf("exactly one Pass may exist for one transaction, found %d", passes)
	}
}

// The dispatch lock is per purchase, not per device: a desktop and a phone
// racing on one intent produce one wallet dispatch, which is the whole point of
// taking it server-side before the wallet is ever called.
func TestOneWalletDispatchPerIntentAcrossDevices(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pass, _ := paymentOffer(t, pool)
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: &testChain{err: nimiq.ErrRPCNotFound}, Network: domain.NimiqTestnet, Now: time.Now}

	intent, _, err := svc.Create(ctx, customer, pass, "shared-intent")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	var wg sync.WaitGroup
	granted := make(chan error, 6)
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.Store.BeginWalletAttempt(ctx, intent.Purchase.ID, customer.ID, paymentID(t), time.Now().UTC())
			granted <- err
		}()
	}
	wg.Wait()
	close(granted)

	var ok int
	for err := range granted {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, application.ErrConflict):
		default:
			t.Fatalf("unexpected dispatch error: %v", err)
		}
	}
	if ok != 1 {
		t.Fatalf("exactly one device may be granted a wallet dispatch, got %d", ok)
	}
}
