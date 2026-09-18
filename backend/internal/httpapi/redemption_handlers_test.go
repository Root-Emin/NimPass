package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"log/slog"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/config"
	"nimpass/backend/internal/domain"
)

func TestRedemptionRoutesRequireAuthenticatedSession(t *testing.T) {
	router := NewRouterWithConfig(nil, slog.Default(), config.Config{Environment: "test", Network: "TESTNET", PublicOrigin: "http://localhost:5173"})
	routes := []struct {
		name   string
		method string
		path   string
	}{
		{name: "create challenge", method: http.MethodPost, path: "/api/v1/passes/00000000-0000-4000-8000-000000000001/redemption-challenges"},
		{name: "current challenge", method: http.MethodGet, path: "/api/v1/passes/00000000-0000-4000-8000-000000000001/redemption-challenges/current"},
		{name: "challenge detail", method: http.MethodGet, path: "/api/v1/redemption-challenges/00000000-0000-4000-8000-000000000001"},
		{name: "authorization", method: http.MethodPost, path: "/api/v1/redemption-challenges/00000000-0000-4000-8000-000000000001/authorization"},
		{name: "customer history", method: http.MethodGet, path: "/api/v1/passes/00000000-0000-4000-8000-000000000001/redemptions"},
		{name: "provider history", method: http.MethodGet, path: "/api/v1/providers/00000000-0000-4000-8000-000000000001/redemptions"},
	}
	for _, route := range routes {
		t.Run(route.name, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			if route.method != http.MethodGet {
				req.Header.Set("Origin", "http://localhost:5173")
				req.Header.Set("Content-Type", "application/json")
			}
			req.Body = http.NoBody
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			if rr.Code != http.StatusUnauthorized {
				t.Fatalf("canonical route status=%d body=%s", rr.Code, rr.Body.String())
			}
		})
	}
}

// The provider-side redemption routes are gone, and staying gone is the point:
// a session is spent by the person who owns the pass, so there is no endpoint
// through which a second party can consume one.
func TestProviderRedemptionWriteRoutesAreNotRouted(t *testing.T) {
	router := NewRouterWithConfig(nil, slog.Default(), config.Config{Environment: "test", Network: "TESTNET", PublicOrigin: "http://localhost:5173"})
	for _, path := range []string{
		"/api/v1/providers/00000000-0000-4000-8000-000000000001/redemptions/lookup",
		"/api/v1/providers/00000000-0000-4000-8000-000000000001/redemptions/confirm",
	} {
		req := httptest.NewRequest(http.MethodPost, path, http.NoBody)
		req.Header.Set("Origin", "http://localhost:5173")
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("%s is still routed: status=%d body=%s", path, rr.Code, rr.Body.String())
		}
	}
}

type redemptionHTTPStore struct {
	view     application.RedemptionView
	consumes int
}

func (s *redemptionHTTPStore) CurrentChallenge(context.Context, domain.ID, domain.ID, domain.WalletAddress, time.Time) (application.RedemptionView, error) {
	return application.RedemptionView{}, application.ErrNotFound
}
func (s *redemptionHTTPStore) GetChallenge(context.Context, domain.ID, domain.ID, domain.WalletAddress) (application.RedemptionView, error) {
	return s.view, nil
}
func (s *redemptionHTTPStore) InsertChallenge(context.Context, domain.RedemptionChallenge, domain.ID, domain.WalletAddress, time.Time) (application.RedemptionView, error) {
	return application.RedemptionView{}, application.ErrNotFound
}
func (s *redemptionHTTPStore) AuthorizeAndConsume(context.Context, domain.ID, domain.ID, domain.WalletAddress, string, string, [32]byte, [32]byte, time.Time) (application.RedemptionView, error) {
	s.consumes++
	consumed := s.view
	consumed.Challenge.Status = domain.RedemptionConsumed
	consumed.Pass.UsedSessions = 3
	consumed.Pass.RemainingSessions = 2
	consumed.HasRedemption = true
	return consumed, nil
}
func (s *redemptionHTTPStore) ListPassHistory(context.Context, domain.ID, domain.ID, domain.WalletAddress) ([]application.RedemptionHistoryItem, error) {
	return nil, nil
}
func (s *redemptionHTTPStore) ListProviderHistory(context.Context, domain.ID, domain.ID) ([]application.RedemptionHistoryItem, error) {
	return nil, nil
}
func (s *redemptionHTTPStore) RecordEvent(context.Context, domain.ID, string, string, time.Time) error {
	return nil
}

// Authorizing is now the whole redemption: one call, and the session is spent.
// The response carries the consumed redemption and the new counts, and it does
// not carry a reference for anybody to present, because none is issued.
func TestRedemptionAuthorizationConsumesTheSession(t *testing.T) {
	now := time.Now().UTC()
	providerID := domain.ID("00000000-0000-4000-8000-000000000001")
	passID := domain.ID("00000000-0000-4000-8000-000000000002")
	challengeID := domain.ID("00000000-0000-4000-8000-000000000003")
	redemptionID := domain.ID("00000000-0000-4000-8000-000000000004")
	view := application.RedemptionView{
		Challenge: domain.RedemptionChallenge{
			ID: challengeID, PassID: passID, ProviderID: providerID, Status: domain.RedemptionCreated,
			Network: domain.NimiqTestnet, Environment: "test",
			CreatedAt: now.Add(-time.Minute), ExpiresAt: now.Add(4 * time.Minute),
			ExpectedUsedSessions: 2, ExpectedRemainingSessions: 3,
		},
		Pass: domain.PurchasedPass{
			ID: passID, Snapshot: domain.PurchaseSnapshot{ProviderID: providerID, ServiceName: "Yoga", PassTitle: "Ten sessions"},
			UsedSessions: 2, RemainingSessions: 3, OriginalSessions: 5, Status: domain.PurchasedPassActive,
		},
	}
	view.Redemption = domain.Redemption{ID: redemptionID, PassID: passID, ProviderID: providerID, SessionOrdinal: 3, ConsumedAt: now}

	store := &redemptionHTTPStore{view: view}
	h := &handler{
		redemptions: application.Redemptions{
			Store:       store,
			Verifier:    acceptingVerifier{},
			Network:     domain.NimiqTestnet,
			Environment: "test",
			Now:         func() time.Time { return now },
		},
		limits: newLimiter(),
	}
	router := chi.NewRouter()
	router.Post("/api/v1/redemption-challenges/{challengeID}/authorization", h.authorizeRedemption)
	session := application.Session{Identity: application.Identity{ID: domain.ID("00000000-0000-4000-8000-000000000005"), Wallet: "NQTEST"}}

	body := `{"publicKey":"` + strings.Repeat("ab", 32) + `","signature":"` + strings.Repeat("cd", 64) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/redemption-challenges/"+string(challengeID)+"/authorization", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), sessionKey{}, session))
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	var response map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("authorization status=%d body=%v", rr.Code, response)
	}
	if store.consumes != 1 {
		t.Fatalf("authorization consumed %d times, want exactly 1", store.consumes)
	}
	if response["status"] != string(domain.RedemptionConsumed) {
		t.Fatalf("challenge status=%v, want CONSUMED", response["status"])
	}
	redemption, ok := response["redemption"].(map[string]any)
	if !ok || redemption["id"] != string(redemptionID) {
		t.Fatalf("response carries no redemption: %v", response)
	}
	pass, ok := response["pass"].(map[string]any)
	if !ok || pass["remainingSessions"] != float64(2) || pass["usedSessions"] != float64(3) {
		t.Fatalf("response pass counts=%v", response["pass"])
	}
	// Nothing to hand to a provider, so nothing may be emitted.
	if _, present := response["redemptionReference"]; present {
		t.Fatalf("response still carries a redemption reference: %v", response)
	}
	if _, present := response["qrExpiresAt"]; present {
		t.Fatalf("response still carries a QR expiry: %v", response)
	}
}

type acceptingVerifier struct{}

func (acceptingVerifier) Verify(string, string, string, string) error { return nil }
func (acceptingVerifier) VerifyAs(string, string, string, string, string) error {
	return nil
}
