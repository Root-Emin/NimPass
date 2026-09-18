package database

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

/*
The two refusals that stand between a customer and a purchase they did not mean
to make.

Both are decided in `PaymentRepository.Create`, under the same lock that
produces the price and the payout wallet, so a hand-rolled POST is answered the
same way a tapped Buy button is. ADR-012 already refused a provider buying from
their own *account*; what is measured here is the wallet behind the money and
the pass the customer is already holding.
*/

// buyOne takes one Pass all the way to a purchased pass and returns its id.
func buyOne(t *testing.T, svc application.Payments, customer application.Identity, chain *testChain, pass domain.ID, hash string) domain.ID {
	t.Helper()
	ctx := context.Background()
	intent, _, err := svc.Create(ctx, customer, pass, "")
	if err != nil {
		t.Fatalf("intent: %v", err)
	}
	if _, err := svc.Submit(ctx, customer, intent.Purchase.ID, hash); err != nil {
		t.Fatalf("submit: %v", err)
	}
	chain.set(paymentEvidence(intent, hash, true), nil)
	settled, err := svc.Reconcile(ctx, customer, intent.Purchase.ID)
	if err != nil || settled.PassID == "" {
		t.Fatalf("settle: %+v %v", settled, err)
	}
	return settled.PassID
}

// One live pass per Pass. Buying again is the end of the loop
// (`01-PRODUCT.md §56`), not a second copy of the same entitlement.
func TestASecondLivePassForTheSamePassIsRefused(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pass, _ := paymentOffer(t, pool)
	chain := &testChain{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	held := buyOne(t, svc, customer, chain, pass, strings.Repeat("1", 64))

	if _, _, err := svc.Create(ctx, customer, pass, ""); !errors.Is(err, application.ErrPassAlreadyOwned) {
		t.Fatalf("a second live pass was allowed: %v", err)
	}
	// Still a 409 to every caller that only asked whether this conflicted.
	if _, _, err := svc.Create(ctx, customer, pass, ""); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("the refusal stopped being a conflict: %v", err)
	}
	// It is this customer's shelf that is full, not the Pass that is closed.
	if _, _, err := svc.Create(ctx, other, pass, ""); err != nil {
		t.Fatalf("somebody else could not buy it: %v", err)
	}

	// Spent to the end: `Buy Again` opens the current terms and sells.
	completePass(t, pool, held)
	if _, _, err := svc.Create(ctx, customer, pass, ""); err != nil {
		t.Fatalf("Buy Again after completion: %v", err)
	}
}

// An expired pass is over too, whether or not anybody has read it since. The
// EXPIRED status is applied lazily, so the rule reads the date rather than the
// status word.
func TestAnExpiredPassDoesNotBlockBuyingAgain(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pass, _ := paymentOffer(t, pool)
	chain := &testChain{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	held := buyOne(t, svc, customer, chain, pass, strings.Repeat("2", 64))

	// The row still says ACTIVE, exactly as it would in production until
	// something reads it.
	assertExec(t, pool, `UPDATE purchased_passes SET expires_at=now()-interval '1 hour' WHERE id=$1`, held)
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM purchased_passes WHERE id=$1`, held).Scan(&status); err != nil || status != "ACTIVE" {
		t.Fatalf("fixture did not reproduce lazy expiry: %q %v", status, err)
	}
	if _, _, err := svc.Create(ctx, customer, pass, ""); err != nil {
		t.Fatalf("an expired pass blocked a new purchase: %v", err)
	}
}

// The payout wallet is the buyer's own address. The owning *account* is
// somebody else's, so ADR-012's check passes and this one has to fire: the
// payment would be a transfer to itself, which pays nobody.
func TestBuyingAPassThatPaysTheBuyerIsRefused(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pass, providerWallet := paymentOffer(t, pool)
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: &testChain{}, Network: domain.NimiqTestnet, Now: time.Now}

	// As bought from anybody else's payout address, this is an ordinary sale.
	if _, _, err := svc.Create(ctx, customer, pass, "control"); err != nil {
		t.Fatalf("control purchase: %v", err)
	}
	assertExec(t, pool, `UPDATE purchases SET status='CANCELLED' WHERE customer_context_id=$1`, customer.ID)
	if providerWallet == customer.Wallet {
		t.Fatal("fixture wallets collided")
	}

	assertExec(t, pool, `UPDATE providers SET payout_wallet=$1,updated_at=now() WHERE payout_wallet=$2`, customer.Wallet, providerWallet)
	if _, _, err := svc.Create(ctx, customer, pass, ""); !errors.Is(err, application.ErrSelfPurchase) {
		t.Fatalf("a purchase that pays the buyer was allowed: %v", err)
	}
}

// The address the intent could not have known.
//
// Nimiq Pay pays from whichever account the customer approves, so an intent
// created from a clean pair can still be settled by a transaction whose sender
// is the payee. Nothing moved, so nothing settles.
func TestATransactionToItselfSettlesNothing(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pass, _ := paymentOffer(t, pool)
	chain := &testChain{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	intent, _, err := svc.Create(ctx, customer, pass, "")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("3", 64)
	if _, err := svc.Submit(ctx, customer, intent.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	evidence := paymentEvidence(intent, hash, true)
	evidence.Transaction.From = evidence.Transaction.To
	chain.set(evidence, nil)
	if _, err := svc.Reconcile(ctx, customer, intent.Purchase.ID); err != nil {
		t.Fatal(err)
	}
	got, err := svc.Store.Get(ctx, intent.Purchase.ID, customer.ID)
	if err != nil || got.PassID != "" || got.CandidateStatus != "MISMATCH" || got.FailureCategory != "SELF_TRANSFER" {
		t.Fatalf("a self-transfer settled a purchase: %+v %v", got, err)
	}
}
