package httpapi

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/config"
	"nimpass/backend/internal/database"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

func httpTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to disposable PostgreSQL _test database")
	}
	u, err := url.Parse(dsn)
	if err != nil || !strings.HasSuffix(strings.TrimPrefix(u.Path, "/"), "_test") {
		t.Fatal("TEST_DATABASE_URL must end in _test")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	id, err := domain.NewID()
	if err != nil {
		t.Fatal(err)
	}
	schema := "nimpass_test_" + strings.ReplaceAll(string(id), "-", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		defer admin.Close()
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := database.Migrate(ctx, pool, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	return pool
}
func httpKey(t *testing.T) (string, string, ed25519.PrivateKey) {
	t.Helper()
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	wallet, err := nimiq.AddressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	return wallet, hex.EncodeToString(pub), key
}

func TestRealHTTPProviderPackageFlow(t *testing.T) {
	pool := httpTestPool(t)
	router := NewRouterWithConfig(pool, slog.Default(), config.Config{Environment: "test", Network: "TESTNET", PublicOrigin: "http://localhost:5173"})
	var cookie *http.Cookie
	csrf := ""
	request := func(method, path string, body any) (int, map[string]any, *httptest.ResponseRecorder) {
		t.Helper()
		var reader *strings.Reader
		if body != nil {
			data, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			reader = strings.NewReader(string(data))
		} else {
			reader = strings.NewReader("")
		}
		req := httptest.NewRequest(method, path, reader)
		if method != http.MethodGet {
			req.Header.Set("Origin", "http://localhost:5173")
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		if csrf != "" {
			req.Header.Set("X-CSRF-Token", csrf)
		}
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		var response map[string]any
		if rr.Body.Len() > 0 {
			if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
		}
		return rr.Code, response, rr
	}
	wallet, pub, key := httpKey(t)
	status, c, _ := request("POST", "/api/v1/auth/challenges", map[string]any{"wallet": wallet})
	if status != 201 {
		t.Fatalf("challenge %d %v", status, c)
	}
	message := c["message"].(string)
	sig := hex.EncodeToString(ed25519.Sign(key, []byte(message)))
	status, login, rr := request("POST", "/api/v1/auth/sessions", map[string]any{"challengeId": c["id"], "wallet": wallet, "publicKey": pub, "signature": sig})
	if status != 201 {
		t.Fatalf("login %d %v", status, login)
	}
	cookie = rr.Result().Cookies()[0]
	csrf = login["csrfToken"].(string)
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("cookie flags: %+v", cookie)
	}
	status, _, _ = request("POST", "/api/v1/providers", map[string]any{"name": "Studio"})
	if status != 201 {
		t.Fatalf("provider create %d", status)
	}
	_, provider, _ := request("GET", "/api/v1/providers", nil)
	providerID := provider["items"].([]any)[0].(map[string]any)["id"].(string)
	status, service, _ := request("POST", "/api/v1/providers/"+providerID+"/services", map[string]any{"name": "Yoga", "description": "Classes"})
	if status != 201 {
		t.Fatalf("service create %d %v", status, service)
	}
	serviceID := service["id"].(string)
	status, service, _ = request("PATCH", "/api/v1/services/"+serviceID, map[string]any{"name": "Yoga", "description": "Classes", "status": "ACTIVE"})
	if status != 200 {
		t.Fatalf("service active %d %v", status, service)
	}
	status, pack, _ := request("POST", "/api/v1/providers/"+providerID+"/services/"+serviceID+"/packages", map[string]any{"title": "Ten sessions", "description": "Yoga", "sessions": 10, "priceLuna": 12340000})
	if status != 201 {
		t.Fatalf("package create %d %v", status, pack)
	}
	packageID := pack["id"].(string)
	status, _, _ = request("POST", "/api/v1/purchases", map[string]any{"packageId": packageID, "priceLuna": 1})
	if status != 400 {
		t.Fatalf("client price accepted %d", status)
	}
	status, _, _ = request("POST", "/api/v1/packages/"+packageID+"/publish", nil)
	if status != 409 {
		t.Fatalf("unverified publish status=%d", status)
	}
	status, public, _ := request("GET", "/api/v1/public/packages", nil)
	if status != 200 || len(public["items"].([]any)) != 0 {
		t.Fatalf("draft public %d %v", status, public)
	}
	payoutWallet, payoutPub, payoutKey := httpKey(t)
	status, challenge, _ := request("POST", "/api/v1/providers/"+providerID+"/payout-challenges", map[string]any{"wallet": payoutWallet})
	if status != 201 {
		t.Fatalf("payout challenge %d %v", status, challenge)
	}
	payoutMessage := challenge["message"].(string)
	status, verified, _ := request("POST", "/api/v1/providers/"+providerID+"/payout-verifications", map[string]any{"challengeId": challenge["id"], "wallet": payoutWallet, "publicKey": payoutPub, "signature": hex.EncodeToString(ed25519.Sign(payoutKey, []byte(payoutMessage))), "ownerPublicKey": pub, "ownerSignature": hex.EncodeToString(ed25519.Sign(key, []byte(payoutMessage)))})
	if status != 200 || verified["payoutWallet"] != payoutWallet {
		t.Fatalf("payout verify %d %v", status, verified)
	}
	status, pack, _ = request("POST", "/api/v1/packages/"+packageID+"/publish", nil)
	if status != 200 {
		t.Fatalf("publish %d %v", status, pack)
	}
	status, public, _ = request("GET", "/api/v1/public/packages", nil)
	if status != 200 || len(public["items"].([]any)) != 1 {
		t.Fatalf("public %d %v", status, public)
	}
	status, intent, _ := request("POST", "/api/v1/purchases", map[string]any{"packageId": packageID})
	if status != 201 {
		t.Fatalf("purchase intent %d %v", status, intent)
	}
	requestData := intent["paymentRequest"].(map[string]any)
	if requestData["recipient"] != payoutWallet || requestData["valueLuna"] != float64(12340000) || !strings.HasPrefix(requestData["data"].(string), "NP1:") {
		t.Fatalf("backend-authored payment request: %v", requestData)
	}
	purchaseID := intent["purchaseIntentId"].(string)
	status, _, _ = request("POST", "/api/v1/purchases/"+purchaseID+"/transactions", map[string]any{"txHash": strings.Repeat("a", 64), "recipient": wallet, "valueLuna": 1, "data": "tampered"})
	if status != 400 {
		t.Fatalf("client payment fields accepted %d", status)
	}
	status, recovered, _ := request("GET", "/api/v1/purchases/"+purchaseID, nil)
	if status != 200 || recovered["purchaseIntentId"] != purchaseID {
		t.Fatalf("purchase recovery %d %v", status, recovered)
	}
	status, submitted, _ := request("POST", "/api/v1/purchases/"+purchaseID+"/transactions", map[string]any{"txHash": strings.Repeat("a", 64)})
	if status != 202 || submitted["status"] == "completed" {
		t.Fatalf("unverified tx completed %d %v", status, submitted)
	}
	status, uncertain, _ := request("POST", "/api/v1/purchases/"+purchaseID+"/reconcile", nil)
	if status != 200 || uncertain["status"] != "uncertain_retryable" {
		t.Fatalf("RPC outage handling %d %v", status, uncertain)
	}
	status, _, _ = request("POST", "/api/v1/purchases/"+purchaseID+"/cancel", nil)
	if status != 409 {
		t.Fatalf("uncertain payment cancelled %d", status)
	}
	status, purchases, _ := request("GET", "/api/v1/purchases", nil)
	if status != 200 || len(purchases["items"].([]any)) != 1 {
		t.Fatalf("purchase list %d %v", status, purchases)
	}
	status, _, _ = request("DELETE", "/api/v1/auth/session", nil)
	if status != 204 {
		t.Fatalf("logout %d", status)
	}
	status, _, _ = request("GET", "/api/v1/providers", nil)
	if status != 401 {
		t.Fatalf("revoked session %d", status)
	}
}
