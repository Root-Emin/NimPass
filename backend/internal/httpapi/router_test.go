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

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
