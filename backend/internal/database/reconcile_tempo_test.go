package database

import (
	"context"
	"strings"
	"testing"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

/*
How soon the reconciler is willing to look at a candidate again.

This is where a correctly-paid purchase used to spend its time. The worker
ticks every two seconds while any intent is live, but `Due` would not return a
candidate whose last check was under thirty seconds old — and a purchase passes
through two or three checks (submitted → included → finalised) before a Pass
exists. The wait the customer saw was that floor, three times over, not the
chain.

The rule now matches discovery's: backoff counts failures, not quiet.
*/

func TestHealthyCandidateIsRecheckedAtTheWorkerTempo(t *testing.T) {
	f := newStoreFixture(t)
	ctx := context.Background()
	repo := PaymentRepository{Pool: f.pool}

	p, _, err := f.payments.Create(ctx, f.customer, f.passID, "")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("b", 64)
	if _, err := f.payments.Submit(ctx, f.customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}

	// The chain has the transaction, included but not yet macro-final: the
	// ordinary middle of a healthy settlement.
	evidence := paymentEvidence(p, hash, false)
	f.chain.set(evidence, nil)
	if _, err := f.payments.Reconcile(ctx, f.customer, p.Purchase.ID); err != nil {
		t.Fatal(err)
	}
	after, err := repo.Get(ctx, p.Purchase.ID, f.customer.ID)
	if err != nil || after.CandidateStatus != "AWAITING_FINALITY" {
		t.Fatalf("candidate status = %q (%v)", after.CandidateStatus, err)
	}

	// Three seconds later it is due again. Under the old thirty-second floor
	// this list was empty, and the purchase sat on a spinner.
	due, err := repo.Due(ctx, time.Now().UTC().Add(3*time.Second), 20)
	if err != nil {
		t.Fatal(err)
	}
	if !containsPurchase(due, p.Purchase.ID) {
		t.Fatalf("a healthy candidate was not due after 3s: %+v", due)
	}

	// And that re-check settles it, because finality had in fact arrived.
	f.chain.set(paymentEvidence(p, hash, true), nil)
	settled, err := f.payments.Reconcile(ctx, f.customer, p.Purchase.ID)
	if err != nil || settled.Purchase.Status != domain.PurchaseConfirmed || settled.PassID == "" {
		t.Fatalf("settle: %+v %v", settled, err)
	}
}

func TestAnUnreachableNodeStillBacksTheCandidateOff(t *testing.T) {
	f := newStoreFixture(t)
	ctx := context.Background()
	repo := PaymentRepository{Pool: f.pool}

	p, _, err := f.payments.Create(ctx, f.customer, f.passID, "")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("9", 64)
	if _, err := f.payments.Submit(ctx, f.customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}

	// The RPC cannot answer. That is the case backoff exists for, and it is
	// deliberately unchanged: an endpoint we are hammering does not become
	// reachable by being asked more often.
	f.chain.set(nimiq.ChainEvidence{}, nimiq.ErrRPCUnavailable)
	if _, err := f.payments.Reconcile(ctx, f.customer, p.Purchase.ID); err != nil {
		t.Fatal(err)
	}
	after, err := repo.Get(ctx, p.Purchase.ID, f.customer.ID)
	if err != nil || after.CandidateStatus != "UNCERTAIN" {
		t.Fatalf("candidate status = %q (%v)", after.CandidateStatus, err)
	}

	if due, err := repo.Due(ctx, time.Now().UTC().Add(3*time.Second), 20); err != nil {
		t.Fatal(err)
	} else if containsPurchase(due, p.Purchase.ID) {
		t.Fatal("a failing candidate was retried after 3s")
	}
	// It comes back once the backoff has run out; an uncertain payment is never
	// abandoned.
	if due, err := repo.Due(ctx, time.Now().UTC().Add(90*time.Second), 20); err != nil {
		t.Fatal(err)
	} else if !containsPurchase(due, p.Purchase.ID) {
		t.Fatal("a failing candidate was never retried")
	}
}

// containsPurchase reports whether the due list names this purchase.
func containsPurchase(due []application.DuePurchase, id domain.ID) bool {
	for _, item := range due {
		if item.ID == id {
			return true
		}
	}
	return false
}
