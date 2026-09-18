package database

import (
	"context"
	"strings"
	"testing"
	"time"

	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

/*
The invariant the whole product rests on:

	transaction recipient == the payout wallet of the provider who owns the Pass

Every step of the path is asserted here rather than assumed, because each one
is a place the answer could quietly become something else: the provider record
supplies the address, `NewPurchase` freezes it into the intent, the intent is
the only thing the payment request is rendered from, and `validateEvidence`
compares the finished chain transaction back against that same frozen value.

Provider A owns the Pass, customer B buys it, and the tests below check both
directions — that a payment to A's wallet settles, and that a payment to
anywhere else never can, however well-formed it otherwise is.
*/

func TestPaymentRecipientIsThePassOwnersPayoutWallet(t *testing.T) {
	f := newStoreFixture(t)
	ctx := context.Background()

	// 1. The intent snapshots the recipient from the provider row, not from
	//    anything the buyer sent.
	p, _, err := f.payments.Create(ctx, f.customer, f.passID, "")
	if err != nil {
		t.Fatal(err)
	}
	if got := string(p.Purchase.Snapshot.Recipient); got != f.payoutWallet {
		t.Fatalf("intent recipient=%q want the provider's payout wallet %q", got, f.payoutWallet)
	}
	if string(p.Purchase.ExpectedWallet) != f.customer.Wallet {
		t.Fatalf("intent was issued to %q, not the buyer", p.Purchase.ExpectedWallet)
	}
	// The recipient is emphatically not the buyer, and not the provider's
	// *owner* identity wallet either — payout and identity are separate
	// addresses and only one of them is paid.
	if string(p.Purchase.Snapshot.Recipient) == f.customer.Wallet || string(p.Purchase.Snapshot.Recipient) == f.owner.Wallet {
		t.Fatalf("recipient collided with another role: %q", p.Purchase.Snapshot.Recipient)
	}

	// 2. It is stored, so every later read of this purchase — including the one
	//    the payment request is rendered from — answers with the same address.
	stored, err := PaymentRepository{Pool: f.pool}.Get(ctx, p.Purchase.ID, f.customer.ID)
	if err != nil || string(stored.Purchase.Snapshot.Recipient) != f.payoutWallet {
		t.Fatalf("stored recipient: %+v %v", stored.Purchase.Snapshot, err)
	}
	var column string
	if err := f.pool.QueryRow(ctx, `SELECT recipient_wallet FROM purchases WHERE id=$1`, p.Purchase.ID).Scan(&column); err != nil || column != f.payoutWallet {
		t.Fatalf("purchases.recipient_wallet=%q err=%v", column, err)
	}

	// 3. A chain transaction that actually reached that address settles, and
	//    the verified receipt records the same recipient.
	hash := strings.Repeat("c", 64)
	if _, err := f.payments.Submit(ctx, f.customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	f.chain.set(paymentEvidence(p, hash, true), nil)
	settled, err := f.payments.Reconcile(ctx, f.customer, p.Purchase.ID)
	if err != nil || settled.Purchase.Status != domain.PurchaseConfirmed {
		t.Fatalf("settle: %+v %v", settled, err)
	}
	var receipt string
	if err := f.pool.QueryRow(ctx, `SELECT recipient_wallet FROM verified_payments WHERE purchase_id=$1`, p.Purchase.ID).Scan(&receipt); err != nil || receipt != f.payoutWallet {
		t.Fatalf("verified_payments.recipient_wallet=%q err=%v", receipt, err)
	}
	// And the Pass it issued belongs to the buyer, provided by that provider.
	pass, err := PaymentRepository{Pool: f.pool}.GetPass(ctx, settled.PassID, f.customer.ID)
	if err != nil || pass.Snapshot.ProviderID != f.providerID || pass.OwnerIdentityID != f.customer.ID {
		t.Fatalf("issued pass: %+v %v", pass, err)
	}
}

func TestPaymentToAnotherAddressNeverCompletesThePurchase(t *testing.T) {
	f := newStoreFixture(t)
	ctx := context.Background()

	// A second provider, so "another address" is a real payout wallet that the
	// system knows about rather than a random string — the realistic mistake is
	// paying the wrong provider, not paying nobody.
	stranger, _, _ := missionKey(t)

	p, _, err := f.payments.Create(ctx, f.customer, f.passID, "")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("d", 64)
	if _, err := f.payments.Submit(ctx, f.customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}

	// Correct in every other respect: right sender, exact Luna, right network,
	// this intent's own NP1 reference, executed and final. Only the recipient
	// is wrong.
	evidence := paymentEvidence(p, hash, true)
	evidence.Transaction.To = stranger
	f.chain.set(evidence, nil)

	after, err := f.payments.Reconcile(ctx, f.customer, p.Purchase.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Purchase.Status == domain.PurchaseConfirmed || after.PassID != "" {
		t.Fatalf("a payment to another address issued a Pass: %+v", after)
	}
	if after.CandidateStatus != "MISMATCH" || after.FailureCategory != "RECIPIENT" {
		t.Fatalf("wrong-recipient verdict: status=%q category=%q", after.CandidateStatus, after.FailureCategory)
	}
	var receipts int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM verified_payments WHERE purchase_id=$1`, p.Purchase.ID).Scan(&receipts); err != nil || receipts != 0 {
		t.Fatalf("a wrong-recipient payment was receipted: %d %v", receipts, err)
	}
}

func TestDiscoveryOnlyAdoptsTransactionsToThePassOwnersWallet(t *testing.T) {
	f := newStoreFixture(t)
	ctx := context.Background()

	p, _, err := f.payments.Create(ctx, f.customer, f.passID, "")
	if err != nil {
		t.Fatal(err)
	}
	stranger, _, _ := missionKey(t)

	// Server-side discovery is the other way a hash enters the pipeline, so the
	// recipient rule is asserted there too: a transfer of the exact amount,
	// from the right buyer, carrying this intent's own reference — to somebody
	// else's address.
	paidAt := time.Now().UTC()
	luna := uint64(p.Purchase.Snapshot.PriceLuna)
	reference := string(p.Purchase.PaymentReference)
	wrong := chainPayment(p, strings.Repeat("e", 64), luna, f.customer.Wallet, stranger, reference, paidAt)
	right := chainPayment(p, strings.Repeat("f", 64), luna, f.customer.Wallet, f.payoutWallet, reference, paidAt)

	f.payments.Discovery = &testDiscoverer{txs: []nimiq.ChainTransaction{wrong}}
	if err := f.payments.DiscoverDue(ctx); err != nil {
		t.Fatal(err)
	}
	after, err := PaymentRepository{Pool: f.pool}.Get(ctx, p.Purchase.ID, f.customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.CandidateHash != "" {
		t.Fatalf("discovery adopted a transaction paid to another address: %q", after.CandidateHash)
	}

	// The same transaction addressed to the Pass owner is adopted.
	f.chain.set(nimiq.ChainEvidence{Transaction: right, InclusionBlock: 100, IncludedAt: paidAt, Finalized: true, FinalityBlock: 120, FinalizedAt: paidAt}, nil)
	f.payments.Discovery = &testDiscoverer{txs: []nimiq.ChainTransaction{right}}
	if err := f.payments.DiscoverDue(ctx); err != nil {
		t.Fatal(err)
	}
	settled, err := PaymentRepository{Pool: f.pool}.Get(ctx, p.Purchase.ID, f.customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if settled.Purchase.Status != domain.PurchaseConfirmed || settled.PassID == "" {
		t.Fatalf("a correct discovered payment did not settle: %+v", settled)
	}
}
