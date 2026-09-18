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
)

/*
The window between an intent expiring and its payment stopping being accepted.

An intent is payable for longer than it is current. `Submit` takes a hash until
`expires_at + PurchaseSettlementGrace`, `DueDiscoveryAddresses` keeps sweeping
the payout address for the same span, and `validateEvidence` allows a report
inside it — all so that a QR payment made in time but noticed late still
settles instead of failing with the money already moved.

The reuse predicate in `Create` used a different clock: `expires_at`. Between
the two there were five minutes in which the customer could be issued a
*second* intent for a pass the first one could still buy them — and paying
both is two payments for one entitlement.
*/
func TestAnExpiredIntentStillInGraceBlocksASecondOne(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pass, _ := paymentOffer(t, pool)
	chain := &testChain{}
	now := time.Now().UTC()
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: func() time.Time { return now }}

	first, _, err := svc.Create(ctx, customer, pass, "")
	if err != nil {
		t.Fatal(err)
	}
	// The customer walks to their phone with the QR on screen. The intent's
	// 30-minute TTL runs out; the five-minute settlement grace has not.
	now = first.Purchase.ExpiresAt.Add(time.Minute)
	if !now.Before(first.Purchase.ExpiresAt.Add(domain.PurchaseSettlementGrace)) {
		t.Fatal("fixture left the grace window")
	}

	// A second intent must not be issued while the first can still be paid.
	if _, _, err := svc.Create(ctx, customer, pass, ""); err == nil {
		t.Fatal("a second intent was issued while the first was still payable")
	} else if !errors.Is(err, application.ErrPurchaseInSettlement) {
		t.Fatalf("second intent refused for the wrong reason: %v", err)
	}

	// And the first one still settles, which is the whole reason the grace
	// exists: paid in time, reported late.
	hash := strings.Repeat("5", 64)
	if _, err := svc.Submit(ctx, customer, first.Purchase.ID, hash); err != nil {
		t.Fatalf("a payment inside the grace was refused: %v", err)
	}
	chain.set(paymentEvidence(first, hash, true), nil)
	settled, err := svc.Reconcile(ctx, customer, first.Purchase.ID)
	if err != nil || settled.PassID == "" {
		t.Fatalf("late-reported payment did not settle: %+v %v", settled, err)
	}
	var passes int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchased_passes WHERE owner_identity_id=$1 AND pass_id=$2`, customer.ID, pass).Scan(&passes); err != nil {
		t.Fatal(err)
	}
	if passes != 1 {
		t.Fatalf("one payment produced %d passes", passes)
	}
}

// Once the grace is over the intent can settle nothing, so it blocks nothing.
func TestOnceTheGraceIsOverANewIntentIsIssued(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pass, _ := paymentOffer(t, pool)
	now := time.Now().UTC()
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: &testChain{}, Network: domain.NimiqTestnet, Now: func() time.Time { return now }}

	first, _, err := svc.Create(ctx, customer, pass, "")
	if err != nil {
		t.Fatal(err)
	}
	now = first.Purchase.ExpiresAt.Add(domain.PurchaseSettlementGrace).Add(time.Second)
	second, reused, err := svc.Create(ctx, customer, pass, "")
	if err != nil || reused || second.Purchase.ID == first.Purchase.ID {
		t.Fatalf("a dead intent blocked a new purchase: reused=%v %v", reused, err)
	}
	// The dead one can no longer take a payment either, so there is no path
	// left on which both could settle.
	if _, err := svc.Submit(ctx, customer, first.Purchase.ID, strings.Repeat("6", 64)); !errors.Is(err, application.ErrExpired) {
		t.Fatalf("an intent past its grace accepted a payment: %v", err)
	}
}

// The invariant, stated against concurrency rather than against a sequence.
//
// Every guard in `Create` runs under the advisory lock on customer+pass, so the
// question is not whether each check is right on its own but whether twenty of
// them racing can still produce two entitlements.
func TestConcurrentPurchasesOfOnePassNeverProduceTwo(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pass, _ := paymentOffer(t, pool)
	chain := &testChain{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}

	// Twenty simultaneous taps on Buy. One intent, nineteen reuses of it.
	const racers = 20
	var wg sync.WaitGroup
	ids := make([]domain.ID, racers)
	errs := make([]error, racers)
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			p, _, err := svc.Create(ctx, customer, pass, "")
			ids[i], errs[i] = p.Purchase.ID, err
		}(i)
	}
	wg.Wait()
	unique := map[domain.ID]bool{}
	for i, err := range errs {
		if err != nil {
			t.Fatalf("racer %d: %v", i, err)
		}
		unique[ids[i]] = true
	}
	if len(unique) != 1 {
		t.Fatalf("%d concurrent taps produced %d intents", racers, len(unique))
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchases WHERE customer_context_id=$1 AND pass_id=$2`, customer.ID, pass).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("%d purchase rows for one intended purchase", rows)
	}

	// Settle it, then race again: now every attempt must be refused, and the
	// customer must still hold exactly one pass.
	var intent domain.ID
	for id := range unique {
		intent = id
	}
	record, err := svc.Store.Get(ctx, intent, customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("9", 64)
	if _, err := svc.Submit(ctx, customer, intent, hash); err != nil {
		t.Fatal(err)
	}
	chain.set(paymentEvidence(record, hash, true), nil)
	if _, err := svc.Reconcile(ctx, customer, intent); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _, errs[i] = svc.Create(ctx, customer, pass, "")
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if !errors.Is(err, application.ErrPassAlreadyOwned) {
			t.Fatalf("racer %d bought a second pass: %v", i, err)
		}
	}
	var passes int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchased_passes WHERE owner_identity_id=$1 AND pass_id=$2`, customer.ID, pass).Scan(&passes); err != nil {
		t.Fatal(err)
	}
	if passes != 1 {
		t.Fatalf("the customer holds %d passes for one Pass", passes)
	}
}
