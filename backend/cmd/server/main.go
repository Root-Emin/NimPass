package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/config"
	"nimpass/backend/internal/database"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/httpapi"
	"nimpass/backend/internal/nimiq"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := database.CheckMigrations(ctx, pool, cfg.MigrationsDir); err != nil {
		return err
	}
	if err := database.BindDeployment(ctx, pool, cfg.Network, cfg.Environment); err != nil {
		return err
	}
	rpc := nimiq.NewRPCClient(cfg.RPCURL)
	checkCtx, cancelCheck := context.WithTimeout(ctx, 5*time.Second)
	err = rpc.CheckNetwork(checkCtx, cfg.Network)
	cancelCheck()
	if errors.Is(err, nimiq.ErrRPCUnavailable) {
		logger.Warn("Nimiq RPC unavailable at startup; payment reconciliation will retry")
	} else if err != nil {
		return err
	}
	// One reconciler, two ways a purchase reaches it: a hash a client reported,
	// and a payment the server found for itself. Discovery is what makes the QR
	// checkout settle at all, since nobody on that path can report a hash.
	payments := application.Payments{Store: database.PaymentRepository{Pool: pool}, Chain: rpc, Discovery: rpc, Head: rpc, Network: domain.NimiqNetwork(cfg.Network), Confirmation: cfg.ConfirmationPolicy, Now: time.Now, Log: logger}
	logger.Info("payment settlement policy", "policy", string(cfg.ConfirmationPolicy))
	listener, err := net.Listen("tcp", cfg.HTTPAddress)
	if err != nil {
		return err
	}
	workerCtx, cancelWorker := context.WithCancel(ctx)
	workerDone := startReconciler(workerCtx, func(ctx context.Context) error {
		cleanupErr := (database.RateLimiter{Pool: pool}).Cleanup(ctx)
		// PromoteDue is in the same sweep rather than a second goroutine, and
		// that is what makes fast settlement restart-safe for free: its work
		// list is a query over stored provisional receipts, so the first pass
		// after a restart picks up every payment whose macro block arrived
		// while the process was down.
		return errors.Join(payments.ReconcileDue(ctx), payments.DiscoverDue(ctx), payments.PromoteDue(ctx), cleanupErr)
	}, payments.HasLiveWork, logger)

	server := &http.Server{
		Addr:              cfg.HTTPAddress,
		Handler:           httpapi.NewRouterWithConfig(pool, logger, cfg),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}
	serverErr := make(chan error, 1)
	go func() { serverErr <- server.Serve(listener) }()
	logger.Info("nimpass backend listening", "address", cfg.HTTPAddress, "environment", cfg.Environment)

	var serveErr error
	select {
	case <-ctx.Done():
	case err := <-serverErr:
		if !errors.Is(err, http.ErrServerClosed) {
			serveErr = err
		}
	}
	cancelWorker()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	shutdownErr := server.Shutdown(shutdownCtx)
	if shutdownErr != nil {
		_ = server.Close()
	}
	<-workerDone
	return errors.Join(serveErr, shutdownErr)
}

// How often the reconciler runs while a customer may be watching a screen.
//
// This is the number that decides how long a desktop QR purchase looks
// unpaid after the phone has paid. Albatross produces a block roughly every
// second, so two seconds is close to as fast as the chain can tell us
// anything, and it is only spent while a live intent exists.
//
// A head-block WebSocket subscription was the alternative — the local node
// does serve one (`/ws` answers 101) and `subscribeForHeadBlock` exists. It
// was not taken: it would add a persistent connection, a reconnect policy and
// a second code path to keep correct, to save roughly one second against a
// two-second poll that also works against a plain HTTP gateway with no
// WebSocket at all. Polling this narrow is not a compromise here; it is the
// same latency with fewer moving parts.
const activeReconcileInterval = 2 * time.Second

// And how often it runs when nothing is pending. Reconciliation still has
// housekeeping to do, but nobody is waiting on it.
const idleReconcileInterval = 30 * time.Second

// startReconciler runs the settlement sweep at a tempo set by whether anyone
// is waiting.
//
// The interval is chosen after each pass rather than fixed, so the cost of
// looking often is paid only while there is something to look for. A timer is
// used rather than a ticker because the delay changes between runs.
func startReconciler(ctx context.Context, reconcile func(context.Context) error, busy func(context.Context) bool, logger *slog.Logger) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		// The first pass runs immediately. A server that has just restarted
		// may have missed a payment while it was down, and making a customer
		// wait out a full interval for that is the same defect this cadence
		// exists to fix.
		timer := time.NewTimer(0)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := reconcile(ctx); err != nil && ctx.Err() == nil {
					logger.Warn("payment reconciliation delayed")
				}
				if ctx.Err() != nil {
					return
				}
				next := idleReconcileInterval
				if busy(ctx) {
					next = activeReconcileInterval
				}
				timer.Reset(next)
			}
		}
	}()
	return done
}
