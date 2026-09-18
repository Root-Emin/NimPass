package httpapi

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/config"
	"nimpass/backend/internal/database"
	"nimpass/backend/internal/nimiq"
)

/*
The catalogue has a burst guard, and reads are not behind it.

Auth, payment, redemption, media and pass sessions all had one; the catalogue
did not, so one authenticated wallet could create providers, services and
passes as fast as it could post — each new provider reaching the public
directory and each ACTIVE Pass reaching Discover with no verification step in
between (ADR-025).
*/
func TestCatalogWritesAreRateLimitedAndReadsAreNot(t *testing.T) {
	pool := httpTestPool(t)
	router := NewRouterWithConfig(pool, slog.New(slog.NewTextHandler(io.Discard, nil)), config.Config{Environment: "test", Network: "TESTNET", PublicOrigin: "https://app.example", CookieSecure: true, MigrationsDir: "../../migrations"})
	wallet, pub, key := httpKey(t)
	auth := application.Auth{Store: database.AuthRepository{Pool: pool}, Verifier: nimiq.Ed25519Verifier{}, Network: "TESTNET", Environment: "test", Now: time.Now}
	c, err := auth.NewChallenge(context.Background(), application.AuthLogin, wallet, "")
	if err != nil {
		t.Fatal(err)
	}
	_, token, csrf, err := auth.Login(context.Background(), application.Proof{ChallengeID: c.ID, Wallet: wallet, PublicKey: pub, Signature: hex.EncodeToString(ed25519.Sign(key, []byte(c.Message())))})
	if err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "https://app.example")
		r.AddCookie(&http.Cookie{Name: "__Host-nimpass_session", Value: token})
		if method != http.MethodGet {
			r.Header.Set("X-CSRF-Token", csrf)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}

	// Writes are allowed until the per-identity budget runs out, then refused
	// with the API's own rate-limit answer rather than a generic error.
	var limited *httptest.ResponseRecorder
	for i := 0; i < 80; i++ {
		w := call("POST", "/api/v1/providers", fmt.Sprintf(`{"name":"Studio %d"}`, i))
		if w.Code == http.StatusTooManyRequests {
			limited = w
			break
		}
		if w.Code != 201 {
			t.Fatalf("provider %d: %d %s", i, w.Code, w.Body.String())
		}
	}
	if limited == nil {
		t.Fatal("the catalogue accepted 80 provider creations without a limit")
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(limited.Body.Bytes(), &body) != nil || body.Error.Code != "RATE_LIMITED" {
		t.Fatalf("refusal is not the documented one: %s", limited.Body.String())
	}

	// The guard is on the writes. A provider who hit it can still read their
	// own catalogue, and so can everybody browsing the public one — limiting
	// those would turn a burst guard into an outage.
	if w := call("GET", "/api/v1/providers", ""); w.Code != 200 {
		t.Fatalf("own catalogue read was limited: %d %s", w.Code, w.Body.String())
	}
	if w := call("GET", "/api/v1/public/passes", ""); w.Code != 200 {
		t.Fatalf("public catalogue read was limited: %d %s", w.Code, w.Body.String())
	}

	// Every catalogue write is behind the same bucket, not just the one that
	// filled it: the surface is the sum of them.
	for _, c := range []struct{ method, path, body string }{
		{"POST", "/api/v1/providers", `{"name":"Another"}`},
		{"PATCH", "/api/v1/providers/00000000-0000-4000-8000-000000000001", `{"name":"Renamed"}`},
		{"POST", "/api/v1/providers/00000000-0000-4000-8000-000000000001/services", `{"name":"Yoga"}`},
		{"PATCH", "/api/v1/services/00000000-0000-4000-8000-000000000001", `{"name":"Yoga","description":"","status":"ACTIVE"}`},
		{"POST", "/api/v1/providers/00000000-0000-4000-8000-000000000001/services/00000000-0000-4000-8000-000000000001/passes", `{"title":"Ten","sessions":10,"priceLuna":1}`},
		{"PATCH", "/api/v1/catalog/passes/00000000-0000-4000-8000-000000000001", `{"title":"Ten","sessions":10,"priceLuna":1}`},
		{"POST", "/api/v1/catalog/passes/00000000-0000-4000-8000-000000000001/publish", ``},
		{"POST", "/api/v1/catalog/passes/00000000-0000-4000-8000-000000000001/unpublish", ``},
		{"DELETE", "/api/v1/catalog/passes/00000000-0000-4000-8000-000000000001", ``},
	} {
		if w := call(c.method, c.path, c.body); w.Code != http.StatusTooManyRequests {
			t.Fatalf("%s %s escaped the catalogue limit: %d", c.method, c.path, w.Code)
		}
	}
}
