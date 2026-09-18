package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/config"
	"nimpass/backend/internal/domain"
)

type testAuthStore struct {
	session     application.Session
	revoked     bool
	findError   error
	revokeError error
}

func (*testAuthStore) InsertChallenge(context.Context, application.Challenge) error { return nil }
func (*testAuthStore) GetChallenge(context.Context, domain.ID) (application.Challenge, error) {
	return application.Challenge{}, application.ErrNotFound
}
func (*testAuthStore) RecordChallengeFailure(context.Context, domain.ID) error { return nil }
func (*testAuthStore) CompleteLogin(context.Context, domain.ID, string, [32]byte, [32]byte, domain.ID, time.Time, time.Time) (application.Session, error) {
	return application.Session{}, application.ErrNotFound
}
func (*testAuthStore) CompletePayout(context.Context, domain.ID, domain.ID, domain.ID, string, time.Time) error {
	return application.ErrNotFound
}
func (s *testAuthStore) FindSession(_ context.Context, _ [32]byte, now time.Time) (application.Session, error) {
	if s.findError != nil {
		return application.Session{}, s.findError
	}
	if s.revoked || !now.Before(s.session.ExpiresAt) {
		return application.Session{}, application.ErrForbidden
	}
	return s.session, nil
}
func (s *testAuthStore) RevokeSession(context.Context, domain.ID, time.Time) error {
	if s.revokeError != nil {
		return s.revokeError
	}
	s.revoked = true
	return nil
}

func TestCookieAndCSRFAndOrigin(t *testing.T) {
	token := strings.Repeat("a", 64)
	csrf := application.CSRFToken(token)
	store := &testAuthStore{session: application.Session{ID: "11111111-1111-4111-8111-111111111111", ExpiresAt: time.Now().Add(time.Hour), CSRFDigest: sha256.Sum256([]byte(csrf))}}
	h := &handler{auth: application.Auth{Store: store, Now: time.Now}, cfg: config.Config{PublicOrigin: "https://app.example", CookieSecure: true}, limits: newLimiter()}
	inner := h.originAndCORS(h.requireSession(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })))
	run := func(method, origin, csrfValue string) int {
		t.Helper()
		req := httptest.NewRequest(method, "https://api.example/api/v1/providers", nil)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if csrfValue != "" {
			req.Header.Set("X-CSRF-Token", csrfValue)
		}
		req.AddCookie(&http.Cookie{Name: "__Host-nimpass_session", Value: token})
		rr := httptest.NewRecorder()
		inner.ServeHTTP(rr, req)
		return rr.Code
	}
	if got := run("POST", "https://evil.example", csrf); got != 403 {
		t.Fatalf("foreign origin status=%d", got)
	}
	if got := run("POST", "https://app.example", ""); got != 403 {
		t.Fatalf("missing CSRF status=%d", got)
	}
	if got := run("POST", "https://app.example", strings.Repeat("0", 64)); got != 403 {
		t.Fatalf("wrong CSRF status=%d", got)
	}
	if got := run("POST", "https://app.example", csrf); got != 204 {
		t.Fatalf("valid CSRF status=%d", got)
	}
	if got := run("GET", "", ""); got != 204 {
		t.Fatalf("safe GET status=%d", got)
	}
	store.revoked = true
	if got := run("GET", "", ""); got != 401 {
		t.Fatalf("revoked status=%d", got)
	}
	store.revoked = false
	store.session.ExpiresAt = time.Now().Add(-time.Second)
	if got := run("GET", "", ""); got != 401 {
		t.Fatalf("expired status=%d", got)
	}
	rr := httptest.NewRecorder()
	h.setSessionCookie(rr, token, int(application.SessionTTL.Seconds()))
	cookies := rr.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "__Host-nimpass_session" || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].Path != "/" || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("production cookie flags: %+v", cookies)
	}
	h.cfg.CookieSecure = false
	rr = httptest.NewRecorder()
	h.setSessionCookie(rr, token, 1)
	if got := rr.Result().Cookies()[0]; got.Secure || got.Name != "nimpass_session" {
		t.Fatalf("development cookie flags: %+v", got)
	}
}

func TestRateLimiter(t *testing.T) {
	l := newLimiter()
	for attempt := range 3 {
		allowed := l.Allow("ip", 2, time.Minute)
		if allowed != (attempt < 2) {
			t.Fatalf("attempt %d: allowed=%v", attempt, allowed)
		}
	}
}

func TestChallengeFlooding(t *testing.T) {
	h := &handler{auth: application.Auth{Store: &testAuthStore{}, Network: "TESTNET", Environment: "test", Now: time.Now}, cfg: config.Config{PublicOrigin: "http://localhost:5173"}, limits: newLimiter()}
	wallet := "NQ07" + strings.Repeat("0", 32)
	for attempt := range 11 {
		body, _ := json.Marshal(map[string]string{"wallet": wallet})
		req := httptest.NewRequest(http.MethodPost, "http://api.local/api/v1/auth/challenges", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = "192.0.2.10:12345"
		rr := httptest.NewRecorder()
		h.createLoginChallenge(rr, req)
		want := http.StatusCreated
		if attempt == 10 {
			want = http.StatusTooManyRequests
		}
		if rr.Code != want {
			t.Fatalf("attempt %d status=%d body=%s", attempt, rr.Code, rr.Body.String())
		}
	}
}

func TestClientIPTrustBoundary(t *testing.T) {
	h := &handler{cfg: config.Config{TrustedProxyCIDRs: []string{"10.0.0.0/8"}}}
	request := func(remote, forwarded string) *http.Request {
		req := httptest.NewRequest(http.MethodGet, "http://api.local/", nil)
		req.RemoteAddr = remote
		req.Header.Set("X-Forwarded-For", forwarded)
		return req
	}
	if got := h.clientIP(request("192.0.2.10:12345", "198.51.100.10")); got != "192.0.2.10" {
		t.Fatalf("untrusted peer accepted spoofed XFF: %s", got)
	}
	if got := h.clientIP(request("10.0.0.5:12345", "198.51.100.10, 10.0.0.6")); got != "198.51.100.10" {
		t.Fatalf("trusted proxy client=%s", got)
	}
	if got := h.clientIP(request("10.0.0.5:12345", "198.51.100.10, 203.0.113.9, 10.0.0.6")); got != "203.0.113.9" {
		t.Fatalf("multiple proxy client=%s", got)
	}
	if got := h.clientIP(request("10.0.0.5:12345", "malformed, 10.0.0.6")); got != "10.0.0.5" {
		t.Fatalf("malformed XFF accepted: %s", got)
	}
}

func TestHubSpacedWalletIsAValidProofField(t *testing.T) {
	h := &handler{auth: application.Auth{Store: &testAuthStore{}, Network: "TESTNET", Environment: "test", Now: time.Now}, cfg: config.Config{PublicOrigin: "http://localhost:5173"}, limits: newLimiter()}
	// Official Hub user-friendly spelling: 36 NQ characters + 8 spaces = 44.
	// The previous 40-character bound rejected every real Hub login.
	wallet := "NQ07 0000 0000 0000 0000 0000 0000 0000 0081"
	if len(wallet) <= 40 {
		t.Fatalf("fixture is not the Hub spaced form: len=%d", len(wallet))
	}
	body, err := json.Marshal(map[string]string{
		"challengeId":   "11111111-1111-4111-8111-111111111111",
		"wallet":        wallet,
		"publicKey":     strings.Repeat("ab", 32),
		"signature":     strings.Repeat("cd", 64),
		"signingScheme": "hub",
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://localhost:5173/api/v1/auth/sessions", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.completeLogin(rr, req)
	if strings.Contains(rr.Body.String(), "Invalid proof fields") {
		t.Fatalf("Hub spaced address rejected at the length gate: %s", rr.Body.String())
	}
}

func TestProofStillRejectsOversizedWallet(t *testing.T) {
	h := &handler{auth: application.Auth{Store: &testAuthStore{}, Network: "TESTNET", Environment: "test", Now: time.Now}, cfg: config.Config{PublicOrigin: "http://localhost:5173"}, limits: newLimiter()}
	body, err := json.Marshal(map[string]string{
		"challengeId": "11111111-1111-4111-8111-111111111111",
		"wallet":      strings.Repeat("N", 37),
		"publicKey":   strings.Repeat("ab", 32),
		"signature":   strings.Repeat("cd", 64),
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://localhost:5173/api/v1/auth/sessions", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.completeLogin(rr, req)
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "Invalid proof fields") {
		t.Fatalf("oversized wallet accepted: %d %s", rr.Code, rr.Body.String())
	}
}

func TestJSONBodyLimit(t *testing.T) {
	h := &handler{auth: application.Auth{Store: &testAuthStore{}, Network: "TESTNET", Environment: "test", Now: time.Now}, cfg: config.Config{PublicOrigin: "http://localhost:5173"}, limits: newLimiter()}
	body := `{"wallet":"` + strings.Repeat("a", 40<<10) + `"}`
	req := httptest.NewRequest(http.MethodPost, "http://api.local/api/v1/auth/challenges", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.createLoginChallenge(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("oversized JSON status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestCredentialedCORSPreflightIsExactOriginOnly(t *testing.T) {
	h := &handler{cfg: config.Config{PublicOrigin: "https://app.example"}}
	preflight := h.originAndCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { t.Fatal("preflight reached handler") }))
	run := func(origin string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodOptions, "https://api.example/api/v1/passes", nil)
		req.Header.Set("Origin", origin)
		req.Header.Set("Access-Control-Request-Method", http.MethodPost)
		rr := httptest.NewRecorder()
		preflight.ServeHTTP(rr, req)
		return rr
	}
	allowed := run("https://app.example")
	if allowed.Code != http.StatusNoContent || allowed.Header().Get("Access-Control-Allow-Origin") != "https://app.example" || allowed.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("allowed preflight: status=%d headers=%v", allowed.Code, allowed.Header())
	}
	denied := run("https://evil.example")
	if denied.Code != http.StatusForbidden || denied.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("denied preflight: status=%d headers=%v", denied.Code, denied.Header())
	}
}

func TestSessionDatabaseFailureDoesNotRequireAnotherLogin(t *testing.T) {
	store := &testAuthStore{session: application.Session{ExpiresAt: time.Now().Add(time.Hour)}, findError: errors.New("private database connection details")}
	h := &handler{auth: application.Auth{Store: store, Now: time.Now}}
	reached := false
	endpoint := h.requireSession(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { reached = true; w.WriteHeader(http.StatusNoContent) }))
	request := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/session", nil)
		req.AddCookie(&http.Cookie{Name: "nimpass_session", Value: strings.Repeat("a", 64)})
		rr := httptest.NewRecorder()
		endpoint.ServeHTTP(rr, req)
		return rr
	}
	rr := request()
	if rr.Code != http.StatusInternalServerError || reached || !strings.Contains(rr.Body.String(), "INTERNAL_ERROR") || strings.Contains(rr.Body.String(), "private") || rr.Header().Get("Set-Cookie") != "" {
		t.Fatalf("outage invalidated session or leaked details: %d %s", rr.Code, rr.Body.String())
	}
	store.findError = nil
	if rr := request(); rr.Code != http.StatusNoContent || !reached {
		t.Fatal("same session did not recover", rr.Code)
	}
	store.revoked = true
	if rr := request(); rr.Code != http.StatusUnauthorized {
		t.Fatal("revoked session accepted", rr.Code)
	}
}

func TestLogoutRevokesServerSessionAndDoesNotHideFailure(t *testing.T) {
	token := strings.Repeat("b", 64)
	csrf := application.CSRFToken(token)
	store := &testAuthStore{session: application.Session{ID: "11111111-1111-4111-8111-111111111111", ExpiresAt: time.Now().Add(time.Hour), CSRFDigest: sha256.Sum256([]byte(csrf))}}
	h := &handler{auth: application.Auth{Store: store, Now: time.Now}, cfg: config.Config{PublicOrigin: "https://app.example", CookieSecure: true}, limits: newLimiter()}
	logout := h.originAndCORS(h.requireSession(http.HandlerFunc(h.logout)))
	call := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest("DELETE", "https://app.example/api/v1/auth/session", nil)
		r.AddCookie(&http.Cookie{Name: "__Host-nimpass_session", Value: token})
		r.Header.Set("Origin", "https://app.example")
		r.Header.Set("X-CSRF-Token", csrf)
		w := httptest.NewRecorder()
		logout.ServeHTTP(w, r)
		return w
	}
	store.revokeError = errors.New("database unavailable")
	failed := call()
	if failed.Code != 500 || store.revoked || len(failed.Result().Cookies()) != 0 {
		t.Fatal("logout failure hidden", failed.Code)
	}
	store.revokeError = nil
	success := call()
	if success.Code != 204 || !store.revoked || len(success.Result().Cookies()) != 1 || success.Result().Cookies()[0].MaxAge != -1 {
		t.Fatal("session not revoked", success.Code)
	}
	if call().Code != 401 {
		t.Fatal("revoked server session remains usable")
	}
}
