package httpapi

import (
	"net/http"
	"testing"
)

/*
Deleting a Pass over the real HTTP surface.

The frontend hides the button for anyone but the owner, and that is
presentation. This is the rule: the route is authorised from the session, and a
provider who does not own the Pass cannot reach it however the request is
shaped (docs/09-SECURITY.md §33).
*/

func TestOnlyThePassOwnerCanDeleteIt(t *testing.T) {
	pool := httpTestPool(t)
	router := identityRouter(pool)

	owner := signedIn(t, router)
	providerID, _, passID := owner.publish("Alex Fitness", "", 0, "Personal Training", "Ten sessions")

	rival := signedIn(t, router)
	rival.publish("Rival Studio", "", 0, "Yoga", "Five sessions")

	// A signed-in stranger with no provider at all.
	customer := signedIn(t, router)

	for who, client := range map[string]*identityClient{"another provider": rival, "a customer": customer} {
		if status, body := client.do("DELETE", "/api/v1/catalog/passes/"+passID, nil); status != http.StatusNotFound {
			t.Fatalf("%s deleted somebody else's Pass: %d %v", who, status, body)
		}
	}
	// A visitor with no session at all is refused before authorisation runs.
	if status, _ := anonymous(t, router).do("DELETE", "/api/v1/catalog/passes/"+passID, nil); status != http.StatusUnauthorized {
		t.Fatalf("an anonymous delete was not refused: %d", status)
	}
	// Still on sale after every refused attempt.
	if status, listed := anonymous(t, router).do("GET", "/api/v1/public/passes", nil); status != 200 || len(listed["items"].([]any)) != 2 {
		t.Fatalf("a refused delete changed the catalogue: %d %v", status, listed)
	}

	// The owner deletes it, and the response says what actually happened.
	status, deleted := owner.do("DELETE", "/api/v1/catalog/passes/"+passID, nil)
	if status != http.StatusOK || deleted["status"] != "ARCHIVED" || deleted["id"] != passID {
		t.Fatalf("owner delete: %d %v", status, deleted)
	}

	// Gone from public discovery and from the owner's own catalogue.
	if _, listed := anonymous(t, router).do("GET", "/api/v1/public/passes", nil); len(listed["items"].([]any)) != 1 {
		t.Fatalf("deleted Pass still public: %v", listed)
	}
	if status, _ := anonymous(t, router).do("GET", "/api/v1/public/passes/"+passID, nil); status != http.StatusNotFound {
		t.Fatalf("deleted Pass still has a public page: %d", status)
	}
	if _, own := owner.do("GET", "/api/v1/providers/"+providerID+"/passes", nil); len(own["items"].([]any)) != 0 {
		t.Fatalf("deleted Pass still in My Store: %v", own)
	}
	// Not purchasable, and a second delete is a conflict rather than a repeat
	// success.
	if status, refused := customer.do("POST", "/api/v1/purchases", map[string]any{"passId": passID}); status != http.StatusConflict {
		t.Fatalf("a deleted Pass accepted a purchase: %d %v", status, refused)
	}
	if status, _ := owner.do("DELETE", "/api/v1/catalog/passes/"+passID, nil); status != http.StatusConflict {
		t.Fatalf("second delete: %d", status)
	}
}

func TestProviderDirectoryAndStorefrontAreServedPublicly(t *testing.T) {
	pool := httpTestPool(t)
	router := identityRouter(pool)

	first := signedIn(t, router)
	firstProvider, _, _ := first.publish("Alex Fitness", "", 0, "Personal Training", "Ten sessions")
	second := signedIn(t, router)
	second.publish("Lucía Ortega", "", 0, "Spanish", "Eight lessons")

	visitor := anonymous(t, router)
	status, directory := visitor.do("GET", "/api/v1/public/providers", nil)
	if status != 200 {
		t.Fatalf("directory %d %v", status, directory)
	}
	items := directory["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("directory listed %d providers, want 2: %v", len(items), items)
	}
	names := map[string]float64{}
	for _, entry := range items {
		row := entry.(map[string]any)
		provider := row["provider"].(map[string]any)
		names[provider["name"].(string)] = row["passCount"].(float64)
		// Every card links by slug, and the slug is a real readable one.
		if provider["slug"] == "" || provider["slug"] == provider["id"] {
			t.Fatalf("directory row has no usable slug: %v", provider)
		}
		if _, leaked := provider["payoutWallet"]; leaked {
			t.Fatalf("directory leaked the payout wallet: %v", provider)
		}
	}
	if names["Alex Fitness"] != 1 || names["Lucía Ortega"] != 1 {
		t.Fatalf("pass counts: %v", names)
	}

	// The storefront filter narrows the public catalogue to one provider.
	status, storefront := visitor.do("GET", "/api/v1/public/passes?provider="+firstProvider, nil)
	if status != 200 || len(storefront["items"].([]any)) != 1 {
		t.Fatalf("storefront %d %v", status, storefront)
	}
	got := storefront["items"].([]any)[0].(map[string]any)
	if got["provider"].(map[string]any)["id"] != firstProvider {
		t.Fatalf("storefront returned another provider's pass: %v", got)
	}
	// A malformed filter is a 400, never a silently unfiltered catalogue.
	if status, _ := visitor.do("GET", "/api/v1/public/passes?provider=not-a-uuid", nil); status != http.StatusBadRequest {
		t.Fatalf("malformed provider filter: %d", status)
	}
}
