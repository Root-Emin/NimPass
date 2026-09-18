package httpapi

import (
	"net/http"
	"testing"
)

/*
Removing a Pass from the listing, over the real HTTP surface.

The UI shows the action only to the provider who owns the Pass. That is
presentation. These are the rules: the route is authorised from the session, and
a withdrawn Pass is refused a purchase however the request is shaped — including
from a browser tab that still shows the Buy button (docs/09-SECURITY.md §33,
§37).
*/

func TestOnlyThePassOwnerCanUnpublishIt(t *testing.T) {
	pool := httpTestPool(t)
	router := identityRouter(pool)

	owner := signedIn(t, router)
	providerID, _, passID := owner.publish("Alex Fitness", "", 0, "Personal Training", "Ten sessions")

	rival := signedIn(t, router)
	rival.publish("Rival Studio", "", 0, "Yoga", "Five sessions")

	customer := signedIn(t, router)
	unpublish := "/api/v1/catalog/passes/" + passID + "/unpublish"

	for who, client := range map[string]*identityClient{"another provider": rival, "a customer": customer} {
		if status, body := client.do("POST", unpublish, nil); status != http.StatusNotFound {
			t.Fatalf("%s unpublished somebody else's Pass: %d %v", who, status, body)
		}
	}
	if status, _ := anonymous(t, router).do("POST", unpublish, nil); status != http.StatusUnauthorized {
		t.Fatalf("an anonymous unpublish was not refused: %d", status)
	}
	// Every refused attempt left it on sale.
	if status, listed := anonymous(t, router).do("GET", "/api/v1/public/passes", nil); status != 200 || len(listed["items"].([]any)) != 2 {
		t.Fatalf("a refused unpublish changed the catalogue: %d %v", status, listed)
	}

	// The owner withdraws it, and the response names the new state.
	status, withdrawn := owner.do("POST", unpublish, nil)
	if status != http.StatusOK || withdrawn["status"] != "UNAVAILABLE" || withdrawn["id"] != passID {
		t.Fatalf("owner unpublish: %d %v", status, withdrawn)
	}
	// Repeating it is a success, not a conflict.
	if status, again := owner.do("POST", unpublish, nil); status != http.StatusOK || again["status"] != "UNAVAILABLE" {
		t.Fatalf("repeat unpublish: %d %v", status, again)
	}

	// Gone from every public surface.
	if _, listed := anonymous(t, router).do("GET", "/api/v1/public/passes", nil); len(listed["items"].([]any)) != 1 {
		t.Fatalf("unpublished Pass still public: %v", listed)
	}
	if status, _ := anonymous(t, router).do("GET", "/api/v1/public/passes/"+passID, nil); status != http.StatusNotFound {
		t.Fatalf("unpublished Pass still has a public page: %d", status)
	}
	if _, storefront := anonymous(t, router).do("GET", "/api/v1/public/passes?provider="+providerID, nil); len(storefront["items"].([]any)) != 0 {
		t.Fatalf("unpublished Pass still on the public storefront: %v", storefront)
	}

	// Still in My Store, and labelled — this is the whole difference from
	// delete (`02-USER-FLOWS.md` §80).
	_, own := owner.do("GET", "/api/v1/providers/"+providerID+"/passes", nil)
	items := own["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("unpublished Pass left My Store: %v", own)
	}
	if row := items[0].(map[string]any); row["id"] != passID || row["status"] != "UNAVAILABLE" {
		t.Fatalf("My Store row: %v", row)
	}
}

// The stale tab: the Pass was on Discover when the page rendered, the provider
// withdrew it, and Buy is pressed anyway. The backend is what stops it.
func TestAnUnpublishedPassRefusesAPurchaseFromAStaleClient(t *testing.T) {
	pool := httpTestPool(t)
	router := identityRouter(pool)

	owner := signedIn(t, router)
	_, _, passID := owner.publish("Alex Fitness", "", 0, "Personal Training", "Ten sessions")
	customer := signedIn(t, router)

	// The customer's screen was rendered while it was for sale.
	if status, offer := anonymous(t, router).do("GET", "/api/v1/public/passes/"+passID, nil); status != 200 {
		t.Fatalf("pass page before withdrawal: %d %v", status, offer)
	}

	if status, _ := owner.do("POST", "/api/v1/catalog/passes/"+passID+"/unpublish", nil); status != http.StatusOK {
		t.Fatalf("unpublish: %d", status)
	}

	// The tap that follows. It carries nothing but the pass id, and is refused
	// with a code the customer can be told the meaning of.
	status, refused := customer.do("POST", "/api/v1/purchases", map[string]any{"passId": passID})
	if status != http.StatusConflict {
		t.Fatalf("an unpublished Pass accepted a purchase: %d %v", status, refused)
	}
	if code := refused["error"].(map[string]any)["code"]; code != "PASS_UNAVAILABLE" {
		t.Fatalf("refusal code %v, want PASS_UNAVAILABLE: %v", code, refused)
	}

	// Published again, it sells again — same id, no re-creation.
	if status, back := owner.do("POST", "/api/v1/catalog/passes/"+passID+"/publish", nil); status != 200 || back["status"] != "ACTIVE" {
		t.Fatalf("republish: %d %v", status, back)
	}
	if status, _ := anonymous(t, router).do("GET", "/api/v1/public/passes/"+passID, nil); status != 200 {
		t.Fatalf("republished Pass has no public page: %d", status)
	}
	if status, intent := customer.do("POST", "/api/v1/purchases", map[string]any{"passId": passID}); status != 201 {
		t.Fatalf("a republished Pass does not sell: %d %v", status, intent)
	}
}

// Unpublish and delete are separate routes with separate meanings, and neither
// is reachable through the other.
func TestUnpublishAndDeleteAreSeparateActionsOverHTTP(t *testing.T) {
	pool := httpTestPool(t)
	router := identityRouter(pool)

	owner := signedIn(t, router)
	providerID, _, passID := owner.publish("Alex Fitness", "", 0, "Personal Training", "Ten sessions")

	// Withdrawing does not delete: still in My Store.
	if status, _ := owner.do("POST", "/api/v1/catalog/passes/"+passID+"/unpublish", nil); status != http.StatusOK {
		t.Fatalf("unpublish: %d", status)
	}
	if _, own := owner.do("GET", "/api/v1/providers/"+providerID+"/passes", nil); len(own["items"].([]any)) != 1 {
		t.Fatalf("unpublish removed the Pass from My Store: %v", own)
	}

	// Deleting a withdrawn Pass still works, and is still terminal.
	if status, deleted := owner.do("DELETE", "/api/v1/catalog/passes/"+passID, nil); status != http.StatusOK || deleted["status"] != "ARCHIVED" {
		t.Fatalf("delete after unpublish: %d %v", status, deleted)
	}
	if _, own := owner.do("GET", "/api/v1/providers/"+providerID+"/passes", nil); len(own["items"].([]any)) != 0 {
		t.Fatalf("deleted Pass still in My Store: %v", own)
	}
	// No way back onto the shelf through either route.
	if status, _ := owner.do("POST", "/api/v1/catalog/passes/"+passID+"/unpublish", nil); status != http.StatusConflict {
		t.Fatalf("an archived Pass was unpublished: %d", status)
	}
	if status, _ := owner.do("POST", "/api/v1/catalog/passes/"+passID+"/publish", nil); status != http.StatusConflict {
		t.Fatalf("an archived Pass was republished: %d", status)
	}
}
