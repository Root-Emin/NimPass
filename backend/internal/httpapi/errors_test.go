package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5/middleware"
)

func TestPanicRecoveryKeepsProcessAliveAndSanitizesResponse(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	calls := 0
	handler := middleware.RequestID(recoverer(logger)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls == 1 {
			panic("private internal detail")
		}
		w.WriteHeader(http.StatusNoContent)
	})))
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/panic", nil))
	if first.Code != http.StatusInternalServerError || !strings.Contains(first.Body.String(), `"code":"INTERNAL_ERROR"`) || !strings.Contains(first.Body.String(), `"requestId":"`) || strings.Contains(first.Body.String(), "private internal detail") {
		t.Fatalf("panic response leaked detail or lacked correlation: %d %s", first.Code, first.Body.String())
	}
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/healthy", nil))
	if second.Code != http.StatusNoContent || calls != 2 {
		t.Fatalf("server did not continue after panic: status=%d calls=%d", second.Code, calls)
	}
	if strings.Contains(logs.String(), "private internal detail") {
		t.Fatal("panic detail leaked to request log")
	}
}
