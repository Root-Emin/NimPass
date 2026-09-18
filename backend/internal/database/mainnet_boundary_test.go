package database

import (
	"context"
	"strings"
	"testing"
	"time"

	"nimpass/backend/internal/domain"
)

// Historical Testnet rows are permanent, and they are what stops a Mainnet
// deployment from reusing the database it was developed against.
//
// A transaction hash belongs to the chain it was made on. Relabelling a
// Testnet purchase as MAINNET would not migrate it — it would create a
// confirmed purchase whose receipt names a transaction that does not exist on
// Mainnet, and whose Pass was issued for play money. The refusal below is what
// makes "use a separate production database" a property of the software rather
// than a line in a runbook.
func TestAMainnetServerRefusesADatabaseHoldingTestnetPurchases(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pass, _ := paymentOffer(t, pool)

	// An ordinary Testnet purchase, created through the repository so the row
	// is exactly what development leaves behind.
	repo := PaymentRepository{Pool: pool}
	created, _, err := repo.Create(ctx, customer.ID, domain.WalletAddress(customer.Wallet), pass, domain.NimiqTestnet, "", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if created.Purchase.Snapshot.Network != domain.NimiqTestnet {
		t.Fatalf("fixture network = %q", created.Purchase.Snapshot.Network)
	}

	// A Testnet server is happy with it.
	if err := BindDeployment(ctx, pool, "TESTNET", "development"); err != nil {
		t.Fatalf("a Testnet deployment must accept its own data: %v", err)
	}

	// A Mainnet server is not, and says so rather than starting.
	err = BindDeployment(ctx, pool, "MAINNET", "production")
	if err == nil {
		t.Fatal("a Mainnet deployment booted against Testnet purchase data")
	}
	if !strings.Contains(err.Error(), "network") && !strings.Contains(err.Error(), "environment") {
		t.Fatalf("the refusal must name what is wrong: %v", err)
	}

	// And nothing was rewritten on the way out: the purchase is still the
	// Testnet purchase it always was.
	after, err := repo.Get(ctx, created.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Purchase.Snapshot.Network != domain.NimiqTestnet {
		t.Fatalf("a historical Testnet purchase was relabelled to %q", after.Purchase.Snapshot.Network)
	}
	var bound string
	if err := pool.QueryRow(ctx, `SELECT network FROM deployment_context WHERE singleton`).Scan(&bound); err != nil {
		t.Fatal(err)
	}
	if bound != "TESTNET" {
		t.Fatalf("deployment context = %q, want the binding to be unchanged by a refused boot", bound)
	}
}

// The clean-database path: an empty database binds to Mainnet/production and
// then holds only Mainnet purchases. This is the production install, and it has
// to actually work — a guard that also blocks the correct setup is an outage.
func TestAnEmptyDatabaseBindsToMainnetAndStaysMainnet(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	if err := BindDeployment(ctx, pool, "MAINNET", "production"); err != nil {
		t.Fatalf("a clean database must accept a Mainnet production deployment: %v", err)
	}
	customer, _, pass, _ := paymentOffer(t, pool)
	created, _, err := (PaymentRepository{Pool: pool}).Create(ctx, customer.ID, domain.WalletAddress(customer.Wallet), pass, domain.NimiqMainnet, "", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if created.Purchase.Snapshot.Network != domain.NimiqMainnet {
		t.Fatalf("network = %q, want MAINNET stamped on the intent at creation", created.Purchase.Snapshot.Network)
	}
	// Re-binding is what every replica and every restart does.
	if err := BindDeployment(ctx, pool, "MAINNET", "production"); err != nil {
		t.Fatalf("replica bind: %v", err)
	}
	// And the Testnet server that was pointed here by mistake does not start.
	if BindDeployment(ctx, pool, "TESTNET", "development") == nil {
		t.Fatal("a Testnet deployment booted against Mainnet purchase data")
	}
}

// The intent snapshots the network at creation, alongside the recipient and
// the exact Luna price, and verification compares the chain against that
// snapshot rather than against whatever the deployment is configured for now.
func TestThePurchaseIntentSnapshotsItsNetworkWithItsTerms(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pass, payout := paymentOffer(t, pool)
	created, _, err := (PaymentRepository{Pool: pool}).Create(ctx, customer.ID, domain.WalletAddress(customer.Wallet), pass, domain.NimiqMainnet, "", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	snapshot := created.Purchase.Snapshot
	if snapshot.Network != domain.NimiqMainnet {
		t.Fatalf("network = %q", snapshot.Network)
	}
	if string(snapshot.Recipient) != normalised(payout) {
		t.Fatalf("recipient = %q, want the provider's verified payout wallet %q", snapshot.Recipient, normalised(payout))
	}
	// Exact integer Luna, never a float and never re-derived from the pass.
	if snapshot.PriceLuna != 12340000 {
		t.Fatalf("priceLuna = %d, want the exact integer Luna snapshotted at creation", snapshot.PriceLuna)
	}
	if !strings.HasPrefix(string(created.Purchase.PaymentReference), "NP1:") {
		t.Fatalf("payment reference = %q, want the NP1 format preserved", created.Purchase.PaymentReference)
	}

	// Editing the catalogue afterwards must not move the agreed price.
	if _, err := pool.Exec(ctx, `UPDATE passes SET price_luna=99999999 WHERE id=$1`, pass); err != nil {
		t.Fatal(err)
	}
	after, err := (PaymentRepository{Pool: pool}).Get(ctx, created.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Purchase.Snapshot.PriceLuna != 12340000 || after.Purchase.Snapshot.Network != domain.NimiqMainnet {
		t.Fatalf("the snapshot followed the catalogue: %+v", after.Purchase.Snapshot)
	}
}

// normalised is how wallet addresses are stored: upper case, no spaces.
func normalised(wallet string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(wallet), " ", ""))
}
