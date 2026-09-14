package httpapi

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthAndNormalizedErrors(t *testing.T) {
	router := NewRouter(nil, slog.Default())
	cases := []struct {
		path   string
		status int
		body   string
	}{
		{"/health/live", http.StatusOK, `"status":"ok"`},
		{"/health/ready", http.StatusServiceUnavailable, `"code":"DATABASE_UNAVAILABLE"`},
		{"/missing", http.StatusNotFound, `"code":"NOT_FOUND"`},
	}
	for _, tc := range cases {
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if rr.Code != tc.status {
			t.Fatalf("%s status=%d", tc.path, rr.Code)
		}
		if !contains(rr.Body.String(), tc.body) {
			t.Fatalf("%s body=%s", tc.path, rr.Body.String())
		}
	}
}

func TestSecurityHeadersAndRequestID(t *testing.T) {
	router := NewRouter(nil, slog.Default())
	req := httptest.NewRequest(http.MethodGet, "/health/live", nil)
	req.Header.Set("X-Request-Id", "attacker\r\nX-Leak: true")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("health status=%d", rr.Code)
	}
	if value := rr.Header().Get("X-Request-Id"); value == "" || value == "attacker\r\nX-Leak: true" {
		t.Fatalf("unsafe request id was accepted: %q", value)
	}
	for header, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy":        "no-referrer",
		"X-Frame-Options":        "DENY",
		"Permissions-Policy":     "camera=(), microphone=(), geolocation=()",
	} {
		if got := rr.Header().Get(header); got != want {
			t.Fatalf("%s=%q want %q", header, got, want)
		}
	}
	if got := rr.Header().Get("Content-Security-Policy"); got == "" {
		t.Fatal("missing Content-Security-Policy")
	}
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
