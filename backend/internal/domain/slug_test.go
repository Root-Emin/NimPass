package domain

import (
	"strings"
	"testing"
	"time"
)

// testNow is the fixed clock the domain tests share.
func testNow() time.Time { return time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC) }

/*
A provider's public URL.

Two properties matter and they pull against each other: it has to be readable
enough to send to a customer, and it has to be unique. `SlugCandidates` resolves
that by offering readability first and guaranteeing uniqueness last — the caller
walks the list and the database decides.
*/

func TestSlugCandidatesOfferReadableNamesThenAGuaranteedOne(t *testing.T) {
	id := ID("0f3ac1d2-4b7e-4f0a-91c5-d8e2b6704a13")
	got := SlugCandidates("Emin Kutlu", id)

	if got[0] != "emin-kutlu" {
		t.Fatalf("first candidate = %q, want the plain name", got[0])
	}
	for i, want := range []string{"emin-kutlu-2", "emin-kutlu-3"} {
		if got[i+1] != want {
			t.Fatalf("candidate %d = %q, want %q", i+1, got[i+1], want)
		}
	}
	last := got[len(got)-1]
	if last != "emin-kutlu-0f3ac1d24b7e4f0a91c5d8e2b6704a13" {
		t.Fatalf("last candidate = %q, want the id-suffixed form", last)
	}
	// The last one carries the provider's own id, so it cannot collide with
	// another provider however contended the name is.
	if !strings.HasSuffix(last, strings.ReplaceAll(string(id), "-", "")) {
		t.Fatalf("last candidate does not carry the id: %q", last)
	}
	// Every candidate has to be a slug the contract accepts, or the walk would
	// offer a URL the validator refuses.
	for _, candidate := range got {
		if _, err := NormalizeSlug(candidate); err != nil {
			t.Fatalf("candidate %q is not a valid slug: %v", candidate, err)
		}
	}
}

func TestSlugCandidatesSkipStraightToTheIdFormWhenTheNameCannotBeOne(t *testing.T) {
	id := ID("0f3ac1d2-4b7e-4f0a-91c5-d8e2b6704a13")
	for _, name := range []string{
		"Jo",        // too short to be a slug on its own
		"— — —",     // nothing ASCII survives
		"providers", // reserved route name
		"passes",    // reserved route name
	} {
		got := SlugCandidates(name, id)
		if len(got) != 1 {
			t.Fatalf("%q offered readable candidates: %v", name, got)
		}
		if _, err := NormalizeSlug(got[0]); err != nil {
			t.Fatalf("%q fallback %q is not a valid slug: %v", name, got[0], err)
		}
		if !strings.HasSuffix(got[0], strings.ReplaceAll(string(id), "-", "")) {
			t.Fatalf("%q fallback is not id-suffixed: %q", name, got[0])
		}
	}
}

func TestSlugCandidatesAreStableForOneProvider(t *testing.T) {
	id := ID("0f3ac1d2-4b7e-4f0a-91c5-d8e2b6704a13")
	// The list is a pure function of name and id, so a provider that retries
	// creation asks for the same URLs in the same order.
	first := SlugCandidates("Fitness With Alex", id)
	second := SlugCandidates("Fitness With Alex", id)
	if len(first) != len(second) {
		t.Fatal("candidate count changed between calls")
	}
	for i := range first {
		if first[i] != second[i] {
			t.Fatalf("candidate %d differs: %q vs %q", i, first[i], second[i])
		}
	}
	if first[0] != "fitness-with-alex" {
		t.Fatalf("readable candidate = %q", first[0])
	}
}

func TestArchivedPassCannotBeSoldOrRepublished(t *testing.T) {
	p, err := NewPass(ID("0f3ac1d2-4b7e-4f0a-91c5-d8e2b6704a13"), ID("1f3ac1d2-4b7e-4f0a-91c5-d8e2b6704a13"), ID("2f3ac1d2-4b7e-4f0a-91c5-d8e2b6704a13"), "Ten sessions", "", SessionCount(10), Luna(1000), ExpirationPolicy{}, "", testNow())
	if err != nil {
		t.Fatal(err)
	}
	if err := p.Publish(testNow()); err != nil {
		t.Fatal(err)
	}
	if !p.CanPurchase(testNow()) {
		t.Fatal("a published pass must be purchasable")
	}
	if err := p.Archive(testNow()); err != nil {
		t.Fatal(err)
	}
	if p.Status != PassArchived {
		t.Fatalf("status = %s", p.Status)
	}
	if p.CanPurchase(testNow()) {
		t.Fatal("an archived pass is still purchasable")
	}
	if err := p.Publish(testNow()); err == nil {
		t.Fatal("an archived pass was republished")
	}
	if err := p.Archive(testNow()); err == nil {
		t.Fatal("archiving twice succeeded")
	}
}
