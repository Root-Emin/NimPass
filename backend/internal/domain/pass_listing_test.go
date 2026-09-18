package domain

import (
	"testing"
	"time"
)

/*
The publication half of a Pass's life, as a state machine.

Two ways to take a Pass off sale exist and they are not the same act:

	ACTIVE -> UNAVAILABLE -> ACTIVE     removing it from the listing, reversible
	anything -> ARCHIVED                deleting it, terminal

`08-ARCHITECTURE.md` §34 allows the status to decide one thing — availability
for new purchases — and these assert both the transitions and that limit.
*/

func listingFixture(t *testing.T, now time.Time) Pass {
	t.Helper()
	p, err := NewPass(mustID(t), mustID(t), mustID(t), "10 Sessions", "Prepaid", 10, 25_000_000, ExpirationPolicy{}, "", now)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestUnpublishingIsReversibleAndArchivingIsNot(t *testing.T) {
	now := time.Now().UTC()
	pass := listingFixture(t, now)

	// A draft was never on sale, so there is nothing to withdraw.
	if err := pass.Unpublish(now); err == nil {
		t.Fatal("a DRAFT pass was unpublished")
	}
	if pass.Status != PassDraft {
		t.Fatalf("a refused unpublish moved the pass: %s", pass.Status)
	}

	if err := pass.Publish(now); err != nil || pass.Status != PassActive {
		t.Fatalf("publish: %s %v", pass.Status, err)
	}
	if !pass.CanPurchase(now) {
		t.Fatal("a published pass is not purchasable")
	}

	// Off the shelf.
	later := now.Add(time.Hour)
	if err := pass.Unpublish(later); err != nil || pass.Status != PassUnavailable {
		t.Fatalf("unpublish: %s %v", pass.Status, err)
	}
	if !pass.UpdatedAt.Equal(later) {
		t.Fatalf("unpublish did not stamp updated_at: %v", pass.UpdatedAt)
	}
	if pass.CanPurchase(later) {
		t.Fatal("an unpublished pass is still purchasable")
	}
	// The only thing that changed is availability. Everything a purchase would
	// snapshot is exactly as it was.
	if pass.Title != "10 Sessions" || pass.Sessions != 10 || pass.PriceLuna != 25_000_000 {
		t.Fatalf("unpublish altered the pass's terms: %+v", pass)
	}

	// And back, on the same record.
	again := later.Add(time.Hour)
	if err := pass.Publish(again); err != nil || pass.Status != PassActive {
		t.Fatalf("republish: %s %v", pass.Status, err)
	}
	if !pass.CanPurchase(again) {
		t.Fatal("a republished pass is not purchasable")
	}

	// Archiving is the other door, and it only opens one way.
	if err := pass.Archive(again); err != nil || pass.Status != PassArchived {
		t.Fatalf("archive: %s %v", pass.Status, err)
	}
	if err := pass.Publish(again); err == nil {
		t.Fatal("an archived pass was republished")
	}
	if err := pass.Unpublish(again); err == nil {
		t.Fatal("an archived pass was unpublished")
	}
	if pass.Status != PassArchived {
		t.Fatalf("archived pass left its terminal state: %s", pass.Status)
	}
}

func TestUnpublishRefusesAnInvalidTime(t *testing.T) {
	now := time.Now().UTC()
	pass := listingFixture(t, now)
	if err := pass.Publish(now); err != nil {
		t.Fatal(err)
	}
	if err := pass.Unpublish(time.Time{}); err == nil {
		t.Fatal("a zero time was accepted")
	}
	if pass.Status != PassActive {
		t.Fatalf("a refused unpublish moved the pass: %s", pass.Status)
	}
}
