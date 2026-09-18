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
	"nimpass/backend/internal/media"
	"nimpass/backend/internal/nimiq"
)

func NewRouter(pool *pgxpool.Pool, logger *slog.Logger) http.Handler {
	// Mirrors `config.Parse`'s own default, so a test router settles the way a
	// deployed one does. A router built without a policy would fall back to
	// `finality` and quietly test behaviour nobody runs.
	return NewRouterWithConfig(pool, logger, config.Config{Environment: "test", Network: "TESTNET", PublicOrigin: "http://localhost:5173", ConfirmationPolicy: domain.ConfirmOnInclusion})
}

// newPayments builds the payment service with both chain roles filled by the
// one configured RPC client: Inspect for a nominated hash, and address
// discovery for a payment that was never reported (ADR-006 gate G2).
func newPayments(pool *pgxpool.Pool, cfg config.Config, rpc *nimiq.RPCClient, logger *slog.Logger) application.Payments {
	return application.Payments{Store: database.PaymentRepository{Pool: pool}, Chain: rpc, Discovery: rpc, Head: rpc, Network: domain.NimiqNetwork(cfg.Network), Confirmation: cfg.ConfirmationPolicy, Now: time.Now, Log: logger}
}

func NewRouterWithConfig(pool *pgxpool.Pool, logger *slog.Logger, cfg config.Config) http.Handler {
	return NewRouterWithChain(pool, logger, cfg, nil)
}

// NewRouterWithChain builds the router around an RPC client the caller already
// owns.
//
// The server passes the same `*nimiq.RPCClient` it gave the reconciler, and
// that sharing is a correctness property rather than a tidiness one. The
// client is where the gateway's published budget is tracked — twenty requests
// per fixed ten-second window on rpc.nimiqwatch.com, counted per IP, not per
// client object (ADR-022). Two clients in one process each believe they have
// the whole window, so together they spend twice it and the *process* gets
// 429s that neither of them predicted; the proven-network and chain-head
// caches are duplicated for the same reason. Nil builds a client from the
// configured URL, which is what the database-free unit-test routers do.
func NewRouterWithChain(pool *pgxpool.Pool, logger *slog.Logger, cfg config.Config, rpc *nimiq.RPCClient) http.Handler {
	if rpc == nil {
		rpc = nimiq.NewRPCClient(cfg.RPCURL)
	}
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
			logger.Info("request", "request_id", middleware.GetReqID(req.Context()), "method", req.Method, "route", chi.RouteContext(req.Context()).RoutePattern(), "status", wrapped.Status(), "duration_ms", time.Since(started).Milliseconds())
		})
	})
	preprocess, err := nimiq.PreprocessorFor(cfg.SigningScheme)
	if err != nil {
		// Config validation rejects an unknown scheme long before this; falling
		// back to the documented default keeps the router total rather than
		// panicking on a value that cannot reach it.
		preprocess = nimiq.RawMessage
	}
	verifier := nimiq.Ed25519Verifier{Preprocess: preprocess}
	h := &handler{auth: application.Auth{Store: database.AuthRepository{Pool: pool}, Verifier: verifier, Network: cfg.Network, Environment: cfg.Environment, Now: time.Now}, catalog: application.Catalog{Store: database.CatalogRepository{Pool: pool}, Now: time.Now}, payments: newPayments(pool, cfg, rpc, logger), redemptions: application.Redemptions{Store: database.PaymentRepository{Pool: pool}, Passes: database.PaymentRepository{Pool: pool}, Verifier: verifier, Network: domain.NimiqNetwork(cfg.Network), Environment: cfg.Environment, Now: time.Now}, passSessions: application.PassSessions{Store: database.PaymentRepository{Pool: pool}, Now: time.Now}, cfg: cfg, limits: newLimiter()}
	mediaDir := cfg.MediaDir
	if mediaDir == "" {
		mediaDir = "var/media"
	}
	mediaSvc := application.Media{Store: database.MediaRepository{Pool: pool}, Files: media.Disk{Dir: mediaDir}, Now: time.Now}
	h.media = mediaSvc
	h.catalog.Covers = mediaSvc
	if pool != nil {
		h.sharedLimits = database.RateLimiter{Pool: pool}
	}
	if cfg.Environment != "production" {
		// Development only. A rejected proof is written down so the wallet's
		// actual preprocessing can be named offline instead of guessed; the
		// proof is rejected either way. See proof_diagnostic.go.
		h.auth.OnProofMismatch = proofMismatchRecorder(logger, time.Now)
	}
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
		var readyErr error
		if cfg.MigrationsDir != "" {
			readyErr = database.CheckMigrations(ctx, pool, cfg.MigrationsDir)
		} else {
			readyErr = pool.Ping(ctx)
		}
		if readyErr != nil {
			logger.Warn("readiness check failed")
			apiFailure(w, req, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Database unavailable")
			return
		}
		// Which chain this deployment is actually settling against, asked of
		// the chain rather than of the configuration.
		//
		// Configuration already refuses `production` with anything but
		// MAINNET, but that only proves what the operator *wrote*. Pointing a
		// Mainnet deployment at a Testnet endpoint is a single-character
		// mistake in an environment variable, and it would otherwise surface
		// as payments that never settle rather than as a misconfiguration.
		//
		// A mismatch fails readiness closed: this instance must not take
		// traffic, because every purchase it verified would be verified
		// against the wrong ledger. Anything else — unreachable, throttled, a
		// node still syncing — is uncertainty and leaves the instance ready,
		// which is the existing contract: public browsing continues and
		// payment reconciliation retries (docs/05 §97).
		probeCtx, cancelProbe := context.WithTimeout(req.Context(), 3*time.Second)
		probe := rpc.Probe(probeCtx, cfg.Network)
		cancelProbe()
		if probe.Status == nimiq.NetworkMismatch {
			logger.Error("nimiq RPC network mismatch",
				"configured_network", cfg.Network,
				"expected_chain", probe.Expected,
				"observed_chain", probe.Observed,
				"source", probe.Source,
				"environment", cfg.Environment)
			apiFailure(w, req, http.StatusServiceUnavailable, "NIMIQ_NETWORK_MISMATCH", "Nimiq RPC is serving a different network")
			return
		}
		if probe.Status != nimiq.NetworkVerified {
			logger.Warn("nimiq RPC network unverified",
				"configured_network", cfg.Network,
				"expected_chain", probe.Expected,
				"environment", cfg.Environment)
		}
		respond(w, http.StatusOK, map[string]any{
			"status":      "ready",
			"environment": cfg.Environment,
			"network":     cfg.Network,
			// No endpoint URL, host or credential: readiness is read by more
			// people than the configuration is (docs/09-SECURITY.md §88).
			"nimiq": map[string]any{
				"status":        probe.Status,
				"expectedChain": probe.Expected,
				"observedChain": probe.Observed,
				"source":        probe.Source,
			},
		})
	})
	r.Route("/api/v1", func(api chi.Router) {
		api.Get("/public/config", func(w http.ResponseWriter, _ *http.Request) {
			respond(w, 200, map[string]any{"network": cfg.Network, "environment": cfg.Environment})
		})
		api.Post("/auth/challenges", h.createLoginChallenge)
		api.Post("/auth/sessions", h.completeLogin)
		api.Get("/public/categories", h.listCategories)
		api.Get("/public/providers/by-slug/{slug}", h.getPublicProviderBySlug)
		api.Get("/public/passes", h.listPublicPasses)
		api.Get("/public/passes/{passID}", h.getPublicPass)
		api.Get("/public/providers", h.listPublicProviders)
		api.Get("/public/providers/{providerID}", h.getPublicProvider)
		api.Get("/media/{mediaID}", h.getMedia)
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
			private.Get("/providers/{providerID}/passes", h.listProviderPasses)
			private.Post("/providers/{providerID}/services/{serviceID}/passes", h.createPass)
			private.Get("/catalog/passes/{passID}", h.getProviderPass)
			private.Patch("/catalog/passes/{passID}", h.updatePass)
			private.Post("/catalog/passes/{passID}/publish", h.publishPass)
			private.Post("/catalog/passes/{passID}/unpublish", h.unpublishPass)
			private.Delete("/catalog/passes/{passID}", h.archivePass)
			private.Post("/media", h.uploadMedia)
			private.Post("/purchases", h.createPurchase)
			private.Get("/purchases", h.listPurchases)
			private.Get("/purchases/{purchaseID}", h.getPurchase)
			private.Post("/purchases/{purchaseID}/wallet-attempts", h.beginWalletAttempt)
			private.Post("/purchases/{purchaseID}/wallet-attempts/{attemptID}/release", h.releaseWalletAttempt)
			private.Post("/purchases/{purchaseID}/transactions", h.submitTransaction)
			private.Post("/purchases/{purchaseID}/reconcile", h.reconcilePurchase)
			private.Post("/purchases/{purchaseID}/cancel", h.cancelPurchase)
			private.Get("/passes", h.listPasses)
			private.Get("/passes/{passID}", h.getPass)
			// The session surface. `/passes/{passID}/sessions` is readable by
			// both parties to the pass; the two writes are addressed by
			// session id, because a session is the thing being changed and
			// routing through the pass would invite "which one?" ambiguity.
			private.Get("/passes/{passID}/sessions", h.listPassSessions)
			private.Patch("/pass-sessions/{sessionID}/schedule", h.scheduleSession)
			private.Post("/pass-sessions/{sessionID}/complete", h.completeSession)
			private.Get("/providers/{providerID}/purchased-passes", h.listProviderPurchasedPasses)
			private.Post("/passes/{passID}/redemption-challenges", h.createRedemptionChallenge)
			private.Get("/passes/{passID}/redemption-challenges/current", h.currentRedemptionChallenge)
			private.Get("/passes/{passID}/redemptions", h.listPassRedemptions)
			private.Get("/redemption-challenges/{challengeID}", h.getRedemptionChallenge)
			private.Post("/redemption-challenges/{challengeID}/authorization", h.authorizeRedemption)
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
