package httpapi

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/config"
	"nimpass/backend/internal/database"
	"nimpass/backend/internal/nimiq"
	"strings"
	"testing"
	"time"
)

func TestMission05HTTPProductAndPrivacyContract(t *testing.T) {
	pool := httpTestPool(t)
	var logs bytes.Buffer
	router := NewRouterWithConfig(pool, slog.New(slog.NewTextHandler(&logs, nil)), config.Config{Environment: "test", Network: "TESTNET", PublicOrigin: "https://app.example", CookieSecure: true, MigrationsDir: "../../migrations"})
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
	request := func(method, path, body string, authenticated, withCSRF bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "https://app.example")
		if authenticated {
			r.AddCookie(&http.Cookie{Name: "__Host-nimpass_session", Value: token})
		}
		if withCSRF {
			r.Header.Set("X-CSRF-Token", csrf)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	decode := func(w *httptest.ResponseRecorder) map[string]any {
		t.Helper()
		var body map[string]any
		if json.Unmarshal(w.Body.Bytes(), &body) != nil {
			t.Fatal(w.Body.String())
		}
		return body
	}
	if w := request("GET", "/api/v1/passes", "", false, false); w.Code != 401 {
		t.Fatal("anonymous list", w.Code)
	}
	if w := request("GET", "/api/v1/passes", "", true, false); w.Code != 200 || len(decode(w)["items"].([]any)) != 0 || decode(w)["nextCursor"] != nil {
		t.Fatal("empty passes", w.Code, w.Body.String())
	}
	for _, q := range []string{"limit=0", "limit=101", "cursor=bad", "status=INVALID", "limit=1&limit=2"} {
		if w := request("GET", "/api/v1/passes?"+q, "", true, false); w.Code != 400 {
			t.Fatal("invalid query", q, w.Code)
		}
	}
	if w := request("POST", "/api/v1/providers", `{"name":"Teacher"}`, true, false); w.Code != 403 {
		t.Fatal("CSRF bypass", w.Code)
	}
	w := request("POST", "/api/v1/providers", `{"name":"Teacher","slug":"MY-TEACHER","headline":"Music","bio":"Piano lessons","avatarUrl":"https://images.example/a.png","location":"Istanbul"}`, true, true)
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	body := decode(w)
	id := body["id"].(string)
	if body["slug"] != "my-teacher" {
		t.Fatal("slug normalization", body)
	}
	w = request("POST", "/api/v1/providers", `{"name":"Duplicate","slug":"my-teacher"}`, true, true)
	if w.Code != 409 {
		t.Fatal("duplicate slug", w.Code)
	}
	if w := request("PATCH", "/api/v1/providers/"+id, `{"name":"Changed","payoutWallet":"no"}`, true, true); w.Code != 400 {
		t.Fatal("mass assignment", w.Code)
	}
	// Created with the owner's wallet as the payout destination (ADR-025), so
	// the directory filter is tested against the state it guards: a provider
	// with no payout wallet is not public.
	if body["payoutWallet"] != wallet {
		t.Fatal("owner payout adoption", body)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE providers SET payout_wallet=NULL,payout_verified_at=NULL WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if w := request("GET", "/api/v1/public/providers/by-slug/my-teacher", "", false, false); w.Code != 404 {
		t.Fatal("unverified exposed")
	}
	if _, err := pool.Exec(context.Background(), `UPDATE providers SET payout_wallet=$2,payout_verified_at=now() WHERE id=$1`, id, wallet); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/v1/public/providers/by-slug/my-teacher", "/api/v1/public/providers/" + id} {
		w := request("GET", path, "", false, false)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		b := decode(w)
		if len(b) != 9 || b["headline"] != "Music" || b["slug"] != "my-teacher" || b["wallet"] != wallet {
			t.Fatal("public DTO drift", b)
		}
		for _, field := range []string{"payoutWallet", "payoutVerifiedAt", "ownerIdentityId", "session", "audit"} {
			if _, ok := b[field]; ok {
				t.Fatal("private field leaked", field)
			}
		}
	}
	w = request("POST", "/api/v1/providers/"+id+"/services", `{"name":"Piano","category":"music"}`, true, true)
	if w.Code != 201 || decode(w)["category"] != "music" {
		t.Fatal("category", w.Code, w.Body.String())
	}
	if w := request("GET", "/api/v1/public/categories", "", false, false); w.Code != 200 || len(decode(w)["items"].([]any)) != 9 {
		t.Fatal("categories", w.Code)
	}
	if w := request("GET", "/api/v1/public/passes?category=imaginary", "", false, false); w.Code != 400 {
		t.Fatal("unknown category accepted")
	}
	if w := request("GET", "/health/ready", "", false, false); w.Code != 200 {
		t.Fatal("ready", w.Code)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE schema_migrations SET checksum=repeat('0',64) WHERE version=8`); err != nil {
		t.Fatal(err)
	}
	if w := request("GET", "/health/ready", "", false, false); w.Code != 503 {
		t.Fatal("readiness ignored migration drift")
	}
	request("GET", "/unknown/NR1:private-reference", "", false, false)
	for _, value := range []string{token, csrf, "private-reference", pub} {
		if strings.Contains(logs.String(), value) {
			t.Fatal("request log leaked input")
		}
	}
}

func TestMission05StrictJSONMediaType(t *testing.T) {
	for _, media := range []string{"application/jsonp", "application/json-invalid"} {
		r := httptest.NewRequest("POST", "/", strings.NewReader(`{"name":"ok"}`))
		r.Header.Set("Content-Type", media)
		w := httptest.NewRecorder()
		var body nameRequest
		if decodeJSON(w, r, &body) || w.Code != 415 {
			t.Fatal("invalid media type accepted", media)
		}
	}
}
