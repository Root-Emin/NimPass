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
Public provider URLs.

A provider is addressed by a slug, never by their display name and never by the
raw UUID. Three things are checked against a real database here, because two of
them are database guarantees rather than code ones: uniqueness is a UNIQUE
constraint, and immutability is a trigger.
*/

func TestProviderSlugsAreReadableUniqueAndStable(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	repo := CatalogRepository{Pool: pool}
	catalog := application.Catalog{Store: repo, Now: time.Now}

	// Three different accounts, one identical display name.
	var created []domain.Provider
	for i := 0; i < 3; i++ {
		wallet, _, _ := missionKey(t)
		identity := application.Identity{ID: paymentID(t), Wallet: wallet}
		assertExec(t, pool, `INSERT INTO identities(id,wallet_address,created_at) VALUES($1,$2,now())`, identity.ID, wallet)
		p, err := catalog.CreateProvider(ctx, identity, "Emin")
		if err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
		assertExec(t, pool, `UPDATE providers SET payout_wallet=$2,payout_verified_at=now() WHERE id=$1`, p.ID, wallet)
		created = append(created, p)
	}

	// Readable first, then deterministically disambiguated.
	for i, want := range []string{"emin", "emin-2", "emin-3"} {
		if created[i].Slug != want {
			t.Fatalf("provider %d slug = %q, want %q", i, created[i].Slug, want)
		}
	}

	// Each slug resolves to its own provider, and to no other.
	for _, p := range created {
		public, err := repo.GetPublicProviderBySlug(ctx, p.Slug)
		if err != nil || public.ID != p.ID {
			t.Fatalf("lookup %q resolved to %q (%v)", p.Slug, public.ID, err)
		}
	}
	if _, err := repo.GetPublicProviderBySlug(ctx, "emin-4"); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("an unclaimed slug resolved: %v", err)
	}

	// A rename leaves the URL alone: a link already shared keeps working.
	renamed, err := catalog.UpdateProvider(ctx, application.Identity{ID: created[0].OwnerIdentityID}, created[0].ID, "Emin Kutlu")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != "Emin Kutlu" || renamed.Slug != "emin" {
		t.Fatalf("rename moved the slug: %+v", renamed)
	}
	// Even straight SQL cannot move it — the trigger is the real guarantee.
	assertReject(t, pool, `UPDATE providers SET slug='somewhere-else' WHERE id=$1`, created[0].ID)
}

func TestProviderSlugFallsBackToTheIdFormWhenTheNameCannotBeAUrl(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	catalog := application.Catalog{Store: CatalogRepository{Pool: pool}, Now: time.Now}

	wallet, _, _ := missionKey(t)
	identity := application.Identity{ID: paymentID(t), Wallet: wallet}
	assertExec(t, pool, `INSERT INTO identities(id,wallet_address,created_at) VALUES($1,$2,now())`, identity.ID, wallet)

	p, err := catalog.CreateProvider(ctx, identity, "体操")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(p.Slug, strings.ReplaceAll(string(p.ID), "-", "")) {
		t.Fatalf("slug = %q, want the id-suffixed fallback", p.Slug)
	}
	if _, err := domain.NormalizeSlug(p.Slug); err != nil {
		t.Fatalf("generated slug is invalid: %v", err)
	}
}

func TestProviderDirectoryListsEveryDiscoverableProvider(t *testing.T) {
	f := newStoreFixture(t)
	ctx := context.Background()
	repo := CatalogRepository{Pool: f.pool}

	// Only one of the two providers has published anything, so only one has a
	// storefront worth linking to.
	directory, err := repo.ListPublicProviders(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(directory) != 1 || directory[0].Provider.ID != f.providerID {
		t.Fatalf("directory: %+v", directory)
	}
	if directory[0].PassCount != 1 {
		t.Fatalf("passCount = %d, want 1", directory[0].PassCount)
	}
	if directory[0].Provider.Slug != "alex-fitness" {
		t.Fatalf("directory slug = %q", directory[0].Provider.Slug)
	}
	// The directory is public data only: the payout wallet is not on the DTO at
	// all, and the wallet it does carry is the owner identity used for the
	// identicon (ADR-010).
	if string(directory[0].Provider.Wallet) != f.owner.Wallet {
		t.Fatalf("directory wallet = %q, want the owner identity wallet", directory[0].Provider.Wallet)
	}
	if string(directory[0].Provider.Wallet) == f.payoutWallet {
		t.Fatal("the directory leaked the payout wallet")
	}

	// A second published Pass moves the count, not the row count.
	second, err := f.catalog.CreatePass(ctx, f.owner, f.providerID, f.serviceID, "Five sessions", "", 5, 6170000, nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.catalog.PublishPass(ctx, f.owner, second.ID); err != nil {
		t.Fatal(err)
	}
	directory, err = repo.ListPublicProviders(ctx, 0)
	if err != nil || len(directory) != 1 || directory[0].PassCount != 2 {
		t.Fatalf("directory after publish: %+v %v", directory, err)
	}

	// A draft Pass is not a storefront: the rival provider is verified but has
	// published nothing, and stays out.
	for _, item := range directory {
		if item.Provider.Name == "Rival Studio" {
			t.Fatal("a provider with nothing published is in the directory")
		}
	}
}
