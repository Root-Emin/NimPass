package database

import (
	"context"
	"strings"
	"testing"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

// A Pass at the limit sells, settles and gets every session row it was sold
// with — the case the bound must not break.
func TestAFullSizePassSettlesWithAllItsSessions(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, seed, _ := paymentOffer(t, pool)
	var providerID, serviceID, ownerID domain.ID
	if err := pool.QueryRow(ctx, `SELECT pk.provider_id,pk.service_id,pr.owner_identity_id FROM passes pk JOIN providers pr ON pr.id=pk.provider_id WHERE pk.id=$1`, seed).Scan(&providerID, &serviceID, &ownerID); err != nil {
		t.Fatal(err)
	}
	var ownerWallet string
	if err := pool.QueryRow(ctx, `SELECT wallet_address FROM identities WHERE id=$1`, ownerID).Scan(&ownerWallet); err != nil {
		t.Fatal(err)
	}
	owner := application.Identity{ID: ownerID, Wallet: ownerWallet}
	catalog := application.Catalog{Store: CatalogRepository{Pool: pool}, Now: time.Now}

	// 501 is refused at the application boundary, as a validation error.
	if _, err := catalog.CreatePass(ctx, owner, providerID, serviceID, "Too many", "", int32(domain.MaxSessionsPerPass)+1, 12340000, nil, "", ""); err == nil {
		t.Fatal("a Pass above the session limit was created")
	} else if !strings.Contains(err.Error(), "validation") {
		t.Fatalf("501 sessions refused as something other than validation: %v", err)
	}

	full, err := catalog.CreatePass(ctx, owner, providerID, serviceID, "Full size", "", int32(domain.MaxSessionsPerPass), 12340000, nil, "", "")
	if err != nil {
		t.Fatalf("a Pass at the limit was refused: %v", err)
	}
	if _, err := catalog.PublishPass(ctx, owner, full.ID); err != nil {
		t.Fatal(err)
	}

	chain := &testChain{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	intent, _, err := svc.Create(ctx, customer, full.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("4", 64)
	if _, err := svc.Submit(ctx, customer, intent.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	chain.set(paymentEvidence(intent, hash, true), nil)
	settled, err := svc.Reconcile(ctx, customer, intent.Purchase.ID)
	if err != nil || settled.PassID == "" {
		t.Fatalf("a full-size purchase did not settle: %+v %v", settled, err)
	}

	// Every session exists, numbered 1..500, and the counter agrees with them.
	var rows, distinct, lowest, highest int32
	if err := pool.QueryRow(ctx, `SELECT count(*),count(DISTINCT sequence_number),min(sequence_number),max(sequence_number) FROM pass_sessions WHERE purchased_pass_id=$1`, settled.PassID).Scan(&rows, &distinct, &lowest, &highest); err != nil {
		t.Fatal(err)
	}
	if rows != int32(domain.MaxSessionsPerPass) || distinct != rows || lowest != 1 || highest != int32(domain.MaxSessionsPerPass) {
		t.Fatalf("session rows: count=%d distinct=%d range=%d..%d", rows, distinct, lowest, highest)
	}
	pass, err := svc.Store.GetPass(ctx, settled.PassID, customer.ID)
	if err != nil || pass.RemainingSessions != int32(domain.MaxSessionsPerPass) || pass.UsedSessions != 0 {
		t.Fatalf("counter disagrees with the rows: %+v %v", pass, err)
	}
}

// The same bound, said where the rows live.
//
// The application refuses 501 long before this, so reaching the constraint
// means something bypassed the application entirely — which is exactly the
// case a database constraint is for.
func TestTheDatabaseRefusesAnOversizedPassOnItsOwn(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	_, _, seed, _ := paymentOffer(t, pool)
	var providerID, serviceID domain.ID
	if err := pool.QueryRow(ctx, `SELECT provider_id,service_id FROM passes WHERE id=$1`, seed).Scan(&providerID, &serviceID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	_, err := pool.Exec(ctx, `INSERT INTO passes(id,provider_id,service_id,title,session_count,price_luna,status,created_at,updated_at) VALUES($1,$2,$3,'Bypass',$4,1,'ACTIVE',$5,$5)`, mustNewID(), providerID, serviceID, int32(domain.MaxSessionsPerPass)+1, now)
	if err == nil {
		t.Fatal("the database accepted a Pass above the session limit")
	}
	if !strings.Contains(err.Error(), "passes_sessions_within_limit") {
		t.Fatalf("refused by something other than the limit: %v", err)
	}
	// And raising an existing Pass past it is refused too, which is the half a
	// NOT VALID constraint still has to cover.
	if _, err := pool.Exec(ctx, `UPDATE passes SET session_count=$2 WHERE id=$1`, seed, int32(domain.MaxSessionsPerPass)+1); err == nil {
		t.Fatal("an existing Pass was raised above the session limit")
	}
}
