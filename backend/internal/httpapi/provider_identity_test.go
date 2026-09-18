package httpapi

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/config"
)

/*
Who created a pass is a stored relation, not a rendering decision.

Discover is public, so the creator on a pass card has to be the same person
whether the visitor is signed in as the creator, signed in as somebody else, or
not signed in at all — and has to survive a restart, because it is a row and not
session state. The failure this guards against is the opposite: a creator name
derived from whoever is currently looking, which reads correctly to the person
who made the pass and is wrong for everyone else.

The identity a pass is attached to is taken from the session alone. The provider
in the URL is a claim, and a claim about somebody else's provider is refused
rather than honoured (docs/09-SECURITY.md §33).
*/

// A client of the real router: a cookie jar, a CSRF token and a wallet key.
type identityClient struct {
	t      *testing.T
	router http.Handler
	cookie *http.Cookie
	csrf   string
	wallet string
	pub    string
	key    ed25519.PrivateKey
}

func identityRouter(pool *pgxpool.Pool) http.Handler {
	return NewRouterWithConfig(pool, slog.Default(), config.Config{Environment: "test", Network: "TESTNET", PublicOrigin: "http://localhost:5173"})
}

// A visitor with no session, which is how Discover is usually read.
func anonymous(t *testing.T, router http.Handler) *identityClient {
	t.Helper()
	return &identityClient{t: t, router: router}
}

func (c *identityClient) do(method, path string, body any) (int, map[string]any) {
	c.t.Helper()
	payload := ""
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			c.t.Fatal(err)
		}
		payload = string(encoded)
	}
	req := httptest.NewRequest(method, path, strings.NewReader(payload))
	if method != http.MethodGet {
		req.Header.Set("Origin", "http://localhost:5173")
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.cookie != nil {
		req.AddCookie(c.cookie)
	}
	if c.csrf != "" {
		req.Header.Set("X-CSRF-Token", c.csrf)
	}
	rr := httptest.NewRecorder()
	c.router.ServeHTTP(rr, req)
	var response map[string]any
	if rr.Body.Len() > 0 {
		if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
			c.t.Fatal(err)
		}
	}
	return rr.Code, response
}

// A wallet that has proved it holds the key, which is the only way in.
func signedIn(t *testing.T, router http.Handler) *identityClient {
	t.Helper()
	c := anonymous(t, router)
	c.wallet, c.pub, c.key = httpKey(t)
	status, challenge := c.do("POST", "/api/v1/auth/challenges", map[string]any{"wallet": c.wallet})
	if status != 201 {
		t.Fatalf("challenge %d %v", status, challenge)
	}
	message := challenge["message"].(string)
	req := httptest.NewRequest("POST", "/api/v1/auth/sessions", strings.NewReader(mustJSON(t, map[string]any{
		"challengeId": challenge["id"], "wallet": c.wallet, "publicKey": c.pub,
		"signature": hex.EncodeToString(ed25519.Sign(c.key, []byte(message))),
	})))
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	if rr.Code != 201 {
		t.Fatalf("login %d %s", rr.Code, rr.Body.String())
	}
	var login map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &login); err != nil {
		t.Fatal(err)
	}
	c.cookie = rr.Result().Cookies()[0]
	c.csrf = login["csrfToken"].(string)
	return c
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

/*
Everything this identity needs to have a published pass on Discover: a provider
under the name they chose, an active service, a verified payout wallet and the
pass itself.
*/
func (c *identityClient) publish(name, avatar string, face int, service, title string) (providerID, serviceID, passID string) {
	c.t.Helper()
	status, provider := c.do("POST", "/api/v1/providers", map[string]any{"name": name})
	if status != 201 {
		c.t.Fatalf("provider create %d %v", status, provider)
	}
	providerID = provider["id"].(string)

	status, provider = c.do("PATCH", "/api/v1/providers/"+providerID, map[string]any{"name": name, "avatarUrl": avatar, "avatarVariant": face})
	if status != 200 || provider["avatarUrl"] != avatar || provider["avatarVariant"] != float64(face) {
		c.t.Fatalf("avatar %d %v", status, provider)
	}

	status, created := c.do("POST", "/api/v1/providers/"+providerID+"/services", map[string]any{"name": service, "description": "Sessions"})
	if status != 201 {
		c.t.Fatalf("service create %d %v", status, created)
	}
	serviceID = created["id"].(string)
	status, created = c.do("PATCH", "/api/v1/services/"+serviceID, map[string]any{"name": service, "description": "Sessions", "status": "ACTIVE"})
	if status != 200 {
		c.t.Fatalf("service active %d %v", status, created)
	}

	status, pass := c.do("POST", "/api/v1/providers/"+providerID+"/services/"+serviceID+"/passes",
		map[string]any{"title": title, "description": "Sessions", "sessions": 10, "priceLuna": 100_000_000})
	if status != 201 {
		c.t.Fatalf("pass create %d %v", status, pass)
	}
	passID = pass["id"].(string)

	// Test 1 — the creator is the authenticated identity's provider, recorded
	// on the pass at the moment it is created.
	if pass["providerId"] != providerID {
		c.t.Fatalf("pass attached to %v, not to its creator %s", pass["providerId"], providerID)
	}

	c.verifyPayout(providerID)
	if status, published := c.do("POST", "/api/v1/catalog/passes/"+passID+"/publish", nil); status != 200 {
		c.t.Fatalf("publish %d %v", status, published)
	}
	return providerID, serviceID, passID
}

func (c *identityClient) verifyPayout(providerID string) {
	c.t.Helper()
	payoutWallet, payoutPub, payoutKey := httpKey(c.t)
	status, challenge := c.do("POST", "/api/v1/providers/"+providerID+"/payout-challenges", map[string]any{"wallet": payoutWallet})
	if status != 201 {
		c.t.Fatalf("payout challenge %d %v", status, challenge)
	}
	message := challenge["message"].(string)
	status, verified := c.do("POST", "/api/v1/providers/"+providerID+"/payout-verifications", map[string]any{
		"challengeId":    challenge["id"],
		"wallet":         payoutWallet,
		"publicKey":      payoutPub,
		"signature":      hex.EncodeToString(ed25519.Sign(payoutKey, []byte(message))),
		"ownerPublicKey": c.pub,
		"ownerSignature": hex.EncodeToString(ed25519.Sign(c.key, []byte(message))),
	})
	if status != 200 {
		c.t.Fatalf("payout verify %d %v", status, verified)
	}
}

// The provider a public listing reports for one pass.
func (c *identityClient) creatorOf(passID string) map[string]any {
	c.t.Helper()
	status, listed := c.do("GET", "/api/v1/public/passes", nil)
	if status != 200 {
		c.t.Fatalf("public listing %d %v", status, listed)
	}
	for _, entry := range listed["items"].([]any) {
		item := entry.(map[string]any)
		if item["pass"].(map[string]any)["id"] == passID {
			return item["provider"].(map[string]any)
		}
	}
	c.t.Fatalf("pass %s missing from the public listing", passID)
	return nil
}

func TestPublicPassNamesItsCreatorWhoeverIsLookingAndWhoeverIsNot(t *testing.T) {
	pool := httpTestPool(t)
	router := identityRouter(pool)

	const (
		name   = "Emin Kutlu"
		avatar = "https://example.test/emin.png"
		// The face they picked from Nimiq's set, rather than their wallet's own.
		face = 7
	)
	creator := signedIn(t, router)
	providerID, serviceID, passID := creator.publish(name, avatar, face, "Software", "Learn C++")

	expected := func(who string, provider map[string]any) {
		t.Helper()
		if provider["id"] != providerID || provider["name"] != name || provider["avatarUrl"] != avatar {
			t.Fatalf("%s sees %v, not the pass's creator", who, provider)
		}
		// The chosen face is part of the creator's public identity, so it does
		// not vary with who is looking either.
		if provider["avatarVariant"] != float64(face) {
			t.Fatalf("%s sees face %v, not the one the creator chose (%d)", who, provider["avatarVariant"], face)
		}
		if provider["wallet"] != creator.wallet {
			t.Fatalf("%s sees identicon wallet %v, not the creator's %s", who, provider["wallet"], creator.wallet)
		}
	}

	// Test 2 — a logged-out visitor, which is how Discover is usually read.
	expected("a logged-out visitor", anonymous(t, router).creatorOf(passID))

	// Test 3 — somebody else, signed in. Their own session must not reach the
	// creator line of a pass they did not make.
	other := signedIn(t, router)
	otherProvider := other.creatorOf(passID)
	expected("another signed-in customer", otherProvider)
	other.publish("Alex Mehr", "https://example.test/alex.png", 0, "Personal Training", "5 Personal Training Sessions")
	expected("another provider", other.creatorOf(passID))

	// Test 4 — the creator looking at their own pass. Their real name, not a
	// second-person placeholder for the one visitor who already knows.
	expected("the creator", creator.creatorOf(passID))

	// Test 5 — public means public profile only. Nothing about the payout
	// destination, the owning identity or the session reaches Discover
	// (docs/DECISIONS.md ADR-010).
	fields := make([]string, 0, len(otherProvider))
	for field := range otherProvider {
		fields = append(fields, field)
	}
	sort.Strings(fields)
	allowed := "avatarUrl,avatarVariant,bio,headline,id,location,name,slug,wallet"
	if strings.Join(fields, ",") != allowed {
		t.Fatalf("public provider exposes %s, allowed %s", strings.Join(fields, ","), allowed)
	}

	// Test 6 — persistence. A new server over the same database, read with no
	// session at all, reports the same creator: the relation is a row.
	restarted := anonymous(t, identityRouter(pool))
	expected("a restarted backend", restarted.creatorOf(passID))

	// A face outside the gallery is refused rather than stored: the number is
	// what a client asks the library to draw, so it has to be drawable.
	if status, refused := creator.do("PATCH", "/api/v1/providers/"+providerID,
		map[string]any{"name": name, "avatarVariant": 9000}); status != 400 {
		t.Fatalf("out-of-range face accepted: %d %v", status, refused)
	}
	if creator.creatorOf(passID)["avatarVariant"] != float64(face) {
		t.Fatal("a refused face changed the stored one")
	}

	// A pass cannot be filed under somebody else's name by asking for it. The
	// provider in the path is a claim; ownership is checked against the session.
	status, refused := other.do("POST", "/api/v1/providers/"+providerID+"/services/"+serviceID+"/passes",
		map[string]any{"title": "Not mine", "description": "Sessions", "sessions": 5, "priceLuna": 50_000_000})
	if status != 404 {
		t.Fatalf("pass created under another identity's provider: %d %v", status, refused)
	}
}
