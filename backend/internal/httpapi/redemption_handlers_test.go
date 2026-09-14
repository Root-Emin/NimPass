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
		{name: "provider lookup", method: http.MethodPost, path: "/api/v1/providers/00000000-0000-4000-8000-000000000001/redemptions/lookup"},
		{name: "provider confirm", method: http.MethodPost, path: "/api/v1/providers/00000000-0000-4000-8000-000000000001/redemptions/confirm"},
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

type redemptionHTTPStore struct {
	view         application.RedemptionView
	lookupCalls  int
	confirmCalls int
}

func (s *redemptionHTTPStore) CurrentChallenge(context.Context, domain.ID, domain.ID, domain.WalletAddress, time.Time) (application.RedemptionView, error) {
	return application.RedemptionView{}, application.ErrNotFound
}
func (s *redemptionHTTPStore) GetChallenge(context.Context, domain.ID, domain.ID, domain.WalletAddress) (application.RedemptionView, error) {
	return application.RedemptionView{}, application.ErrNotFound
}
func (s *redemptionHTTPStore) LookupRedemption(context.Context, domain.ID, domain.ID, string) (application.RedemptionView, error) {
	s.lookupCalls++
	return s.view, nil
}
func (s *redemptionHTTPStore) InsertChallenge(context.Context, domain.RedemptionChallenge, domain.ID, domain.WalletAddress, time.Time) (application.RedemptionView, error) {
	return application.RedemptionView{}, application.ErrNotFound
}
func (s *redemptionHTTPStore) AuthorizeChallenge(context.Context, domain.ID, domain.ID, domain.WalletAddress, string, string, string, [32]byte, [32]byte, [32]byte, time.Time) (application.RedemptionView, error) {
	return application.RedemptionView{}, application.ErrNotFound
}
func (s *redemptionHTTPStore) RotateToken(context.Context, domain.ID, domain.ID, domain.WalletAddress, [32]byte, string, time.Time) (application.RedemptionView, error) {
	return application.RedemptionView{}, application.ErrNotFound
}
func (s *redemptionHTTPStore) ConfirmRedemption(context.Context, domain.ID, domain.ID, string, time.Time) (application.RedemptionView, error) {
	s.confirmCalls++
	return s.view, nil
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

func TestRedemptionProviderLookupAndConfirmHTTPContract(t *testing.T) {
	now := time.Now().UTC()
	providerID := domain.ID("00000000-0000-4000-8000-000000000001")
	passID := domain.ID("00000000-0000-4000-8000-000000000002")
	challengeID := domain.ID("00000000-0000-4000-8000-000000000003")
	redemptionID := domain.ID("00000000-0000-4000-8000-000000000004")
	expires := now.Add(5 * time.Minute)
	view := application.RedemptionView{
		Challenge: domain.RedemptionChallenge{
			ID: challengeID, PassID: passID, ProviderID: providerID, Status: domain.RedemptionAuthorized,
			CreatedAt: now.Add(-time.Minute), ExpiresAt: expires, ExpectedUsedSessions: 2, ExpectedRemainingSessions: 3,
		},
		Pass: domain.Pass{
			ID: passID, Snapshot: domain.PurchaseSnapshot{ProviderID: providerID, ServiceName: "Yoga", PackageTitle: "Ten sessions"},
			UsedSessions: 2, RemainingSessions: 3, OriginalSessions: 5, Status: domain.PassActive,
		},
	}
	view.QRExpiresAt = &expires
	view.Redemption = domain.Redemption{ID: redemptionID, PassID: passID, ProviderID: providerID, SessionOrdinal: 3, ConsumedAt: now}
	store := &redemptionHTTPStore{view: view}
	h := &handler{redemptions: application.Redemptions{Store: store, Now: func() time.Time { return now }}, limits: newLimiter()}
	router := chi.NewRouter()
	router.Post("/api/v1/providers/{providerID}/redemptions/lookup", h.lookupRedemption)
	router.Post("/api/v1/providers/{providerID}/redemptions/confirm", h.confirmRedemption)
	session := application.Session{Identity: application.Identity{ID: domain.ID("00000000-0000-4000-8000-000000000005"), Wallet: "NQTEST"}}
	reference := "NR1:" + strings.Repeat("a", 64)

	request := func(path string) (int, map[string]any) {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"redemptionReference":"`+reference+`"}`))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(context.WithValue(req.Context(), sessionKey{}, session))
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		var body map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return rr.Code, body
	}

	status, lookup := request("/api/v1/providers/" + string(providerID) + "/redemptions/lookup")
	if status != http.StatusOK || lookup["challengeId"] != string(challengeID) || lookup["serviceName"] != "Yoga" || lookup["nextSessionOrdinal"] != float64(3) {
		t.Fatalf("lookup response status=%d body=%v", status, lookup)
	}
	if _, leaked := lookup["ownerWallet"]; leaked || store.lookupCalls != 1 || store.confirmCalls != 0 {
		t.Fatalf("lookup leaked or consumed state: body=%v lookupCalls=%d confirmCalls=%d", lookup, store.lookupCalls, store.confirmCalls)
	}
	status, confirmation := request("/api/v1/providers/" + string(providerID) + "/redemptions/confirm")
	if status != http.StatusOK || confirmation["redemptionId"] != string(redemptionID) || confirmation["remainingSessions"] != float64(3) {
		t.Fatalf("confirm response status=%d body=%v", status, confirmation)
	}
	if store.confirmCalls != 1 {
		t.Fatalf("confirm call count=%d", store.confirmCalls)
	}
}
