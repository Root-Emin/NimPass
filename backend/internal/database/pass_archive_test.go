package database

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

/*
Deleting a Pass, and the four things that must survive it.

"Delete" is an archival write (docs/08-ARCHITECTURE.md §135-§136): the row
stays, because purchases, verified payments, purchased passes and the
redemption trail all point at it. What changes is availability, and these tests
pin both halves — what stops, and what carries on.
*/

// storeFixture is one provider with a published Pass, a rival provider who owns
// nothing of theirs, and a customer.
type storeFixture struct {
	pool     *pgxpool.Pool
	catalog  application.Catalog
	payments application.Payments
	chain    *testChain

	owner    application.Identity
	rival    application.Identity
	customer application.Identity

	providerID domain.ID
	serviceID  domain.ID
	passID     domain.ID
	// The provider's verified payout wallet — the address every payment for
	// this Pass must reach.
	payoutWallet string
}

func newStoreFixture(t *testing.T) storeFixture {
	t.Helper()
	pool := missionPool(t)
	ctx := context.Background()
	now := time.Now().UTC()

	ownerWallet, _, _ := missionKey(t)
	rivalWallet, _, _ := missionKey(t)
	customerWallet, _, _ := missionKey(t)
	payoutWallet, _, _ := missionKey(t)
	rivalPayout, _, _ := missionKey(t)

	f := storeFixture{
		pool:         pool,
		owner:        application.Identity{ID: paymentID(t), Wallet: ownerWallet},
		rival:        application.Identity{ID: paymentID(t), Wallet: rivalWallet},
		customer:     application.Identity{ID: paymentID(t), Wallet: customerWallet},
		payoutWallet: payoutWallet,
	}
	for _, row := range []struct {
		id     domain.ID
		wallet string
	}{{f.owner.ID, ownerWallet}, {f.rival.ID, rivalWallet}, {f.customer.ID, customerWallet}} {
		assertExec(t, pool, `INSERT INTO identities(id,wallet_address,created_at) VALUES($1,$2,$3)`, row.id, row.wallet, now)
	}

	f.catalog = application.Catalog{Store: CatalogRepository{Pool: pool}, Now: time.Now}
	f.chain = &testChain{}
	f.payments = application.Payments{Store: PaymentRepository{Pool: pool}, Chain: f.chain, Network: domain.NimiqTestnet, Now: time.Now}

	provider, err := f.catalog.CreateProvider(ctx, f.owner, "Alex Fitness")
	if err != nil {
		t.Fatal(err)
	}
	f.providerID = provider.ID
	// A rival provider exists so "another provider cannot delete it" is tested
	// against a real provider account rather than against a bare identity.
	rival, err := f.catalog.CreateProvider(ctx, f.rival, "Rival Studio")
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct {
		id     domain.ID
		wallet string
	}{{provider.ID, payoutWallet}, {rival.ID, rivalPayout}} {
		assertExec(t, pool, `UPDATE providers SET payout_wallet=$2,payout_verified_at=now() WHERE id=$1`, row.id, row.wallet)
	}

	service, err := f.catalog.CreateService(ctx, f.owner, provider.ID, "Personal Training", "", "fitness")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.catalog.UpdateService(ctx, f.owner, provider.ID, service.ID, service.Name, "", domain.ServiceActive, "fitness"); err != nil {
		t.Fatal(err)
	}
	f.serviceID = service.ID

	pass, err := f.catalog.CreatePass(ctx, f.owner, provider.ID, service.ID, "Ten sessions", "", 10, 12340000, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.catalog.PublishPass(ctx, f.owner, pass.ID); err != nil {
		t.Fatal(err)
	}
	f.passID = pass.ID
	return f
}

// buy runs one complete purchase to a settled Pass and returns the purchased
// pass id.
func (f storeFixture) buy(t *testing.T, hash string) (application.PurchaseRecord, domain.ID) {
	t.Helper()
	ctx := context.Background()
	p, _, err := f.payments.Create(ctx, f.customer, f.passID, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.payments.Submit(ctx, f.customer, p.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	f.chain.set(paymentEvidence(p, hash, true), nil)
	settled, err := f.payments.Reconcile(ctx, f.customer, p.Purchase.ID)
	if err != nil {
		t.Fatal(err)
	}
	if settled.Purchase.Status != domain.PurchaseConfirmed || settled.PassID == "" {
		t.Fatalf("purchase did not settle: %+v", settled)
	}
	return settled, settled.PassID
}

func TestArchivedPassStopsSellingAndKeepsEverythingSold(t *testing.T) {
	f := newStoreFixture(t)
	ctx := context.Background()
	repo := CatalogRepository{Pool: f.pool}

	// A customer buys it while it is on sale.
	purchase, purchasedPassID := f.buy(t, strings.Repeat("a", 64))

	// --- Only the owner may delete it -----------------------------------
	if _, err := f.catalog.ArchivePass(ctx, f.rival, f.passID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("a second provider archived somebody else's Pass: %v", err)
	}
	if _, err := f.catalog.ArchivePass(ctx, f.customer, f.passID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("a customer archived a Pass: %v", err)
	}
	// The refused attempts changed nothing.
	if still, err := repo.GetProviderPass(ctx, f.passID, f.owner.ID); err != nil || still.Status != domain.PassActive {
		t.Fatalf("a refused delete moved the Pass: %+v %v", still, err)
	}

	archived, err := f.catalog.ArchivePass(ctx, f.owner, f.passID)
	if err != nil || archived.Status != domain.PassArchived {
		t.Fatalf("owner archive: %+v %v", archived, err)
	}
	// Archiving twice is a conflict, not a silent success.
	if _, err := f.catalog.ArchivePass(ctx, f.owner, f.passID); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("re-archive: %v", err)
	}

	// --- It stops being sellable ----------------------------------------
	if _, _, err := f.payments.Create(ctx, f.customer, f.passID, "after-delete"); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("an archived Pass accepted a new purchase: %v", err)
	}
	if public, err := repo.ListPublicPasses(ctx, application.PublicPassFilter{}); err != nil || len(public) != 0 {
		t.Fatalf("archived Pass still in Discover: %+v %v", public, err)
	}
	if _, err := repo.GetPublicPass(ctx, f.passID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("archived Pass still has a public page: %v", err)
	}
	if storefront, err := repo.ListPublicPasses(ctx, application.PublicPassFilter{ProviderID: f.providerID}); err != nil || len(storefront) != 0 {
		t.Fatalf("archived Pass still on the storefront: %+v %v", storefront, err)
	}
	if directory, err := repo.ListPublicProviders(ctx, 0); err != nil || len(directory) != 0 {
		t.Fatalf("a provider with nothing left on sale is still in the directory: %+v %v", directory, err)
	}
	if own, err := repo.ListProviderPasses(ctx, f.providerID, f.owner.ID); err != nil || len(own) != 0 {
		t.Fatalf("archived Pass still in the owner's catalogue: %+v %v", own, err)
	}
	// Neither editable nor re-publishable: an archived Pass is finished.
	if _, err := f.catalog.UpdatePass(ctx, f.owner, f.passID, "Renamed", "", 10, 12340000, nil, "", nil); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("archived Pass was editable: %v", err)
	}
	if _, err := f.catalog.PublishPass(ctx, f.owner, f.passID); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("archived Pass was republished: %v", err)
	}

	// --- Everything already sold is untouched ----------------------------
	pass, role, err := PaymentRepository{Pool: f.pool}.GetPassForActor(ctx, purchasedPassID, f.customer.ID)
	if err != nil || role != domain.ViewerOwner {
		t.Fatalf("the customer lost their pass: %v", err)
	}
	if pass.Status != domain.PurchasedPassActive || pass.RemainingSessions != 10 || pass.Snapshot.PassTitle != "Ten sessions" {
		t.Fatalf("purchased pass changed: %+v", pass)
	}
	page, err := PaymentRepository{Pool: f.pool}.ListPasses(ctx, f.customer.ID, application.PurchasedPassFilter{Limit: 10})
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != purchasedPassID {
		t.Fatalf("My Passes lost the pass: %+v %v", page, err)
	}
	// Payment history and the transaction reconciliation record survive.
	replayed, err := PaymentRepository{Pool: f.pool}.Get(ctx, purchase.Purchase.ID, f.customer.ID)
	if err != nil || replayed.Purchase.Status != domain.PurchaseConfirmed || replayed.PassID != purchasedPassID {
		t.Fatalf("purchase history changed: %+v %v", replayed, err)
	}
	var receipts int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM verified_payments WHERE purchase_id=$1`, purchase.Purchase.ID).Scan(&receipts); err != nil || receipts != 1 {
		t.Fatalf("verified receipt count=%d err=%v", receipts, err)
	}
	// The session records issued with the pass are still there and still usable.
	sessions, err := PaymentRepository{Pool: f.pool}.ListPassSessions(ctx, purchasedPassID, f.customer.ID)
	if err != nil || len(sessions) != 10 {
		t.Fatalf("sessions after delete: %d %v", len(sessions), err)
	}
}

func TestArchivingOnePassLeavesTheProviderSellingTheOthers(t *testing.T) {
	f := newStoreFixture(t)
	ctx := context.Background()
	repo := CatalogRepository{Pool: f.pool}

	second, err := f.catalog.CreatePass(ctx, f.owner, f.providerID, f.serviceID, "Five sessions", "", 5, 6170000, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.catalog.PublishPass(ctx, f.owner, second.ID); err != nil {
		t.Fatal(err)
	}

	if _, err := f.catalog.ArchivePass(ctx, f.owner, f.passID); err != nil {
		t.Fatal(err)
	}

	public, err := repo.ListPublicPasses(ctx, application.PublicPassFilter{})
	if err != nil || len(public) != 1 || public[0].Pass.ID != second.ID {
		t.Fatalf("catalogue after one delete: %+v %v", public, err)
	}
	directory, err := repo.ListPublicProviders(ctx, 0)
	if err != nil || len(directory) != 1 || directory[0].Provider.ID != f.providerID || directory[0].PassCount != 1 {
		t.Fatalf("directory after one delete: %+v %v", directory, err)
	}
	// The surviving Pass still sells.
	if _, _, err := f.payments.Create(ctx, f.customer, second.ID, ""); err != nil {
		t.Fatalf("the remaining Pass stopped selling: %v", err)
	}
}
