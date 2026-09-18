package database

import (
	"context"
	"errors"
	"strings"
	"testing"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

/*
Taking a Pass off the shelf, and putting it back.

The difference from `pass_archive_test.go` is the direction of travel. Deleting
a Pass is terminal and takes it out of the provider's own catalogue too;
removing it from the listing is reversible and leaves it exactly where the
provider manages it. Both must stop new sales, and neither may touch a thing
anybody has already bought (`08-ARCHITECTURE.md` §34, §136).

`newStoreFixture` is shared with the archive tests deliberately: the same
provider, the same rival, the same customer and the same published Pass, so the
two withdrawal routes are measured against one setup.
*/

func TestUnpublishedPassLeavesThePublicCatalogueAndComesBack(t *testing.T) {
	f := newStoreFixture(t)
	ctx := context.Background()
	repo := CatalogRepository{Pool: f.pool}

	// Somebody buys it while it is on sale. Everything below has to survive.
	purchase, purchasedPassID := f.buy(t, strings.Repeat("a", 64))

	// --- Only the owner may withdraw it ---------------------------------
	if _, err := f.catalog.UnpublishPass(ctx, f.rival, f.passID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("a second provider unpublished somebody else's Pass: %v", err)
	}
	if _, err := f.catalog.UnpublishPass(ctx, f.customer, f.passID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("a customer unpublished a Pass: %v", err)
	}
	if still, err := repo.GetProviderPass(ctx, f.passID, f.owner.ID); err != nil || still.Status != domain.PassActive {
		t.Fatalf("a refused unpublish moved the Pass: %+v %v", still, err)
	}
	// And a refused attempt did not quietly take it off Discover either.
	if public, err := repo.ListPublicPasses(ctx, application.PublicPassFilter{}); err != nil || len(public) != 1 {
		t.Fatalf("a refused unpublish changed the catalogue: %+v %v", public, err)
	}

	withdrawn, err := f.catalog.UnpublishPass(ctx, f.owner, f.passID)
	if err != nil || withdrawn.Status != domain.PassUnavailable {
		t.Fatalf("owner unpublish: %+v %v", withdrawn, err)
	}
	// Idempotent, unlike archiving: the caller asked for it to be off the
	// listing and it is.
	repeated, err := f.catalog.UnpublishPass(ctx, f.owner, f.passID)
	if err != nil || repeated.Status != domain.PassUnavailable {
		t.Fatalf("repeat unpublish: %+v %v", repeated, err)
	}

	// --- It stops selling and leaves every public surface ----------------
	if _, _, err := f.payments.Create(ctx, f.customer, f.passID, "after-unpublish"); !errors.Is(err, application.ErrPassUnavailable) {
		t.Fatalf("an unpublished Pass accepted a new purchase: %v", err)
	}
	if public, err := repo.ListPublicPasses(ctx, application.PublicPassFilter{}); err != nil || len(public) != 0 {
		t.Fatalf("unpublished Pass still in Discover: %+v %v", public, err)
	}
	if _, err := repo.GetPublicPass(ctx, f.passID); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("unpublished Pass still has a public page: %v", err)
	}
	if storefront, err := repo.ListPublicPasses(ctx, application.PublicPassFilter{ProviderID: f.providerID}); err != nil || len(storefront) != 0 {
		t.Fatalf("unpublished Pass still on the provider's public profile: %+v %v", storefront, err)
	}
	if directory, err := repo.ListPublicProviders(ctx, 0); err != nil || len(directory) != 0 {
		t.Fatalf("a provider with nothing on sale is still in the directory: %+v %v", directory, err)
	}

	// --- But it is still the provider's, and still theirs to work on -----
	own, err := repo.ListProviderPasses(ctx, f.providerID, f.owner.ID)
	if err != nil || len(own) != 1 || own[0].ID != f.passID || own[0].Status != domain.PassUnavailable {
		t.Fatalf("unpublished Pass left the owner's catalogue: %+v %v", own, err)
	}
	// Editable again, which an archived Pass is not.
	edited, err := f.catalog.UpdatePass(ctx, f.owner, f.passID, "Ten sessions, renamed", "", 10, 12340000, nil, "", nil)
	if err != nil || edited.Title != "Ten sessions, renamed" {
		t.Fatalf("unpublished Pass was not editable: %+v %v", edited, err)
	}

	// --- Back on sale, on the same row -----------------------------------
	republished, err := f.catalog.PublishPass(ctx, f.owner, f.passID)
	if err != nil || republished.Status != domain.PassActive || republished.ID != f.passID {
		t.Fatalf("republish: %+v %v", republished, err)
	}
	// Publishing an already-published Pass stays the conflict it has always
	// been (`mission02_test.go`), and it changes nothing: the idempotent half
	// of this feature is the withdrawal, which is the request a provider can
	// actually repeat by accident.
	if _, err := f.catalog.PublishPass(ctx, f.owner, f.passID); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("repeat publish: %v", err)
	}
	if still, err := repo.GetProviderPass(ctx, f.passID, f.owner.ID); err != nil || still.Status != domain.PassActive {
		t.Fatalf("a refused republish moved the Pass: %+v %v", still, err)
	}
	public, err := repo.ListPublicPasses(ctx, application.PublicPassFilter{})
	if err != nil || len(public) != 1 || public[0].Pass.ID != f.passID {
		t.Fatalf("republished Pass is not back in Discover: %+v %v", public, err)
	}
	if directory, err := repo.ListPublicProviders(ctx, 0); err != nil || len(directory) != 1 || directory[0].PassCount != 1 {
		t.Fatalf("provider directory after republish: %+v %v", directory, err)
	}
	// Asked of somebody who is not already holding it. The first customer
	// still has their ten sessions, and a second live pass for the same Pass
	// is refused whatever the listing says — a fact about that customer's
	// shelf, which would say nothing here about whether the Pass is back on
	// sale.
	if _, _, err := f.payments.Create(ctx, f.customer, f.passID, "after-republish"); !errors.Is(err, application.ErrPassAlreadyOwned) {
		t.Fatalf("a second live pass for the same Pass: %v", err)
	}
	if _, _, err := f.payments.Create(ctx, f.rival, f.passID, "after-republish"); err != nil {
		t.Fatalf("a republished Pass does not sell: %v", err)
	}

	// --- Everything already sold is exactly where it was -----------------
	pass, role, err := PaymentRepository{Pool: f.pool}.GetPassForActor(ctx, purchasedPassID, f.customer.ID)
	if err != nil || role != domain.ViewerOwner {
		t.Fatalf("the customer lost their pass: %v", err)
	}
	if pass.Status != domain.PurchasedPassActive || pass.RemainingSessions != 10 {
		t.Fatalf("purchased pass changed: %+v", pass)
	}
	// The snapshot is the terms they paid for, not the renamed live Pass.
	if pass.Snapshot.PassTitle != "Ten sessions" {
		t.Fatalf("purchased pass followed a later edit: %q", pass.Snapshot.PassTitle)
	}
	page, err := PaymentRepository{Pool: f.pool}.ListPasses(ctx, f.customer.ID, application.PurchasedPassFilter{Limit: 10})
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != purchasedPassID {
		t.Fatalf("My Passes lost the pass: %+v %v", page, err)
	}
	replayed, err := PaymentRepository{Pool: f.pool}.Get(ctx, purchase.Purchase.ID, f.customer.ID)
	if err != nil || replayed.Purchase.Status != domain.PurchaseConfirmed || replayed.PassID != purchasedPassID {
		t.Fatalf("purchase history changed: %+v %v", replayed, err)
	}
	var receipts int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM verified_payments WHERE purchase_id=$1`, purchase.Purchase.ID).Scan(&receipts); err != nil || receipts != 1 {
		t.Fatalf("verified receipt count=%d err=%v", receipts, err)
	}
	sessions, err := PaymentRepository{Pool: f.pool}.ListPassSessions(ctx, purchasedPassID, f.customer.ID)
	if err != nil || len(sessions) != 10 {
		t.Fatalf("sessions after unpublish: %d %v", len(sessions), err)
	}
}

// Unpublish and delete are separate actions that do not stand in for each
// other, in either order.
func TestUnpublishAndDeleteRemainIndependent(t *testing.T) {
	f := newStoreFixture(t)
	ctx := context.Background()
	repo := CatalogRepository{Pool: f.pool}

	// A withdrawn Pass can still be deleted, and deleting it is the terminal
	// act it always was.
	if _, err := f.catalog.UnpublishPass(ctx, f.owner, f.passID); err != nil {
		t.Fatal(err)
	}
	archived, err := f.catalog.ArchivePass(ctx, f.owner, f.passID)
	if err != nil || archived.Status != domain.PassArchived {
		t.Fatalf("delete after unpublish: %+v %v", archived, err)
	}
	if own, err := repo.ListProviderPasses(ctx, f.providerID, f.owner.ID); err != nil || len(own) != 0 {
		t.Fatalf("deleted Pass still in the owner's catalogue: %+v %v", own, err)
	}
	// And an archived Pass cannot be withdrawn "again" into a reversible state
	// — that would be a way back onto the shelf through the wrong door.
	if _, err := f.catalog.UnpublishPass(ctx, f.owner, f.passID); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("an archived Pass was unpublished: %v", err)
	}
	if still, err := repo.GetProviderPass(ctx, f.passID, f.owner.ID); err != nil || still.Status != domain.PassArchived {
		t.Fatalf("archived Pass left its terminal state: %+v %v", still, err)
	}

	// A never-published Pass has no listing to be removed from.
	draft, err := f.catalog.CreatePass(ctx, f.owner, f.providerID, f.serviceID, "Five sessions", "", 5, 6170000, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.catalog.UnpublishPass(ctx, f.owner, draft.ID); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("a DRAFT Pass was unpublished: %v", err)
	}
	if still, err := repo.GetProviderPass(ctx, draft.ID, f.owner.ID); err != nil || still.Status != domain.PassDraft {
		t.Fatalf("a refused unpublish moved a draft: %+v %v", still, err)
	}
}

// One Pass withdrawn leaves the provider's other Passes selling.
func TestUnpublishingOnePassLeavesTheProviderSellingTheOthers(t *testing.T) {
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
	if _, err := f.catalog.UnpublishPass(ctx, f.owner, f.passID); err != nil {
		t.Fatal(err)
	}

	public, err := repo.ListPublicPasses(ctx, application.PublicPassFilter{})
	if err != nil || len(public) != 1 || public[0].Pass.ID != second.ID {
		t.Fatalf("catalogue after one withdrawal: %+v %v", public, err)
	}
	directory, err := repo.ListPublicProviders(ctx, 0)
	if err != nil || len(directory) != 1 || directory[0].PassCount != 1 {
		t.Fatalf("directory after one withdrawal: %+v %v", directory, err)
	}
	// Both are still the provider's to manage.
	own, err := repo.ListProviderPasses(ctx, f.providerID, f.owner.ID)
	if err != nil || len(own) != 2 {
		t.Fatalf("owner catalogue after one withdrawal: %+v %v", own, err)
	}
	if _, _, err := f.payments.Create(ctx, f.customer, second.ID, ""); err != nil {
		t.Fatalf("the remaining Pass stopped selling: %v", err)
	}
}
