package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/config"
	"nimpass/backend/internal/database"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

func NewRouter(pool *pgxpool.Pool, logger *slog.Logger) http.Handler {
	return NewRouterWithConfig(pool, logger, config.Config{Environment: "test", Network: "TESTNET", PublicOrigin: "http://localhost:5173"})
}

func NewRouterWithConfig(pool *pgxpool.Pool, logger *slog.Logger, cfg config.Config) http.Handler {
	r := chi.NewRouter()
	r.Use(sanitizeRequestID)
	r.Use(middleware.RequestID)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if requestID := middleware.GetReqID(req.Context()); requestID != "" {
				w.Header().Set(middleware.RequestIDHeader, requestID)
			}
			next.ServeHTTP(w, req)
		})
	})
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			started := time.Now()
			wrapped := middleware.NewWrapResponseWriter(w, req.ProtoMajor)
			next.ServeHTTP(wrapped, req)
			logger.Info("request", "request_id", middleware.GetReqID(req.Context()), "method", req.Method, "path", req.URL.Path, "status", wrapped.Status(), "duration_ms", time.Since(started).Milliseconds())
		})
	})
	h := &handler{auth: application.Auth{Store: database.AuthRepository{Pool: pool}, Verifier: nimiq.Ed25519Verifier{}, Network: cfg.Network, Environment: cfg.Environment, Now: time.Now}, catalog: application.Catalog{Store: database.CatalogRepository{Pool: pool}, Now: time.Now}, payments: application.Payments{Store: database.PaymentRepository{Pool: pool}, Chain: nimiq.NewRPCClient(cfg.RPCURL), Network: domain.NimiqNetwork(cfg.Network), Now: time.Now}, redemptions: application.Redemptions{Store: database.PaymentRepository{Pool: pool}, Passes: database.PaymentRepository{Pool: pool}, Verifier: nimiq.Ed25519Verifier{}, Network: domain.NimiqNetwork(cfg.Network), Environment: cfg.Environment, Now: time.Now}, cfg: cfg, limits: newLimiter()}
	r.Use(h.originAndCORS)
	r.Use(recoverer(logger))
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
			w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
			if cfg.Environment == "production" {
				w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, req)
		})
	})
	r.Get("/health/live", func(w http.ResponseWriter, _ *http.Request) {
		writeHealth(w, http.StatusOK, "ok")
	})
	r.Get("/health/ready", func(w http.ResponseWriter, req *http.Request) {
		if pool == nil {
			apiFailure(w, req, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Database unavailable")
			return
		}
		ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			logger.Warn("readiness check failed", "error", err)
			apiFailure(w, req, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Database unavailable")
			return
		}
		writeHealth(w, http.StatusOK, "ready")
	})
	r.Route("/api/v1", func(api chi.Router) {
		api.Post("/auth/challenges", h.createLoginChallenge)
		api.Post("/auth/sessions", h.completeLogin)
		api.Get("/public/packages", h.listPublicPackages)
		api.Get("/public/packages/{packageID}", h.getPublicPackage)
		api.Get("/public/providers/{providerID}", h.getPublicProvider)
		api.Group(func(private chi.Router) {
			private.Use(h.requireSession)
			private.Get("/auth/session", h.currentSession)
			private.Delete("/auth/session", h.logout)
			private.Get("/providers", h.listProviders)
			private.Post("/providers", h.createProvider)
			private.Get("/providers/{providerID}", h.getProvider)
			private.Patch("/providers/{providerID}", h.updateProvider)
			private.Post("/providers/{providerID}/payout-challenges", h.createPayoutChallenge)
			private.Post("/providers/{providerID}/payout-verifications", h.verifyPayout)
			private.Get("/providers/{providerID}/services", h.listServices)
			private.Post("/providers/{providerID}/services", h.createService)
			private.Get("/services/{serviceID}", h.getService)
			private.Patch("/services/{serviceID}", h.updateService)
			private.Get("/providers/{providerID}/packages", h.listPackages)
			private.Post("/providers/{providerID}/services/{serviceID}/packages", h.createPackage)
			private.Get("/packages/{packageID}", h.getPackage)
			private.Patch("/packages/{packageID}", h.updatePackage)
			private.Post("/packages/{packageID}/publish", h.publishPackage)
			private.Post("/purchases", h.createPurchase)
			private.Get("/purchases", h.listPurchases)
			private.Get("/purchases/{purchaseID}", h.getPurchase)
			private.Post("/purchases/{purchaseID}/transactions", h.submitTransaction)
			private.Post("/purchases/{purchaseID}/reconcile", h.reconcilePurchase)
			private.Post("/purchases/{purchaseID}/cancel", h.cancelPurchase)
			private.Get("/passes/{passID}", h.getPass)
			private.Post("/passes/{passID}/redemption-challenges", h.createRedemptionChallenge)
			private.Get("/passes/{passID}/redemption-challenges/current", h.currentRedemptionChallenge)
			private.Get("/passes/{passID}/redemptions", h.listPassRedemptions)
			private.Get("/redemption-challenges/{challengeID}", h.getRedemptionChallenge)
			private.Post("/redemption-challenges/{challengeID}/authorization", h.authorizeRedemption)
			private.Post("/providers/{providerID}/redemptions/lookup", h.lookupRedemption)
			private.Post("/providers/{providerID}/redemptions/confirm", h.confirmRedemption)
			private.Get("/providers/{providerID}/redemptions", h.listProviderRedemptions)
		})
	})
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		apiFailure(w, req, http.StatusNotFound, "NOT_FOUND", "Route not found")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) {
		apiFailure(w, req, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
	})
	return r
}

func writeHealth(w http.ResponseWriter, status int, value string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": value})
}
