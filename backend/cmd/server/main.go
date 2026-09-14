package main

import (
	"context"
	"errors"
	"log/slog"
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
	rpc := nimiq.NewRPCClient(cfg.RPCURL)
	checkCtx, cancelCheck := context.WithTimeout(ctx, 5*time.Second)
	err = rpc.CheckNetwork(checkCtx, cfg.Network)
	cancelCheck()
	if errors.Is(err, nimiq.ErrRPCUnavailable) {
		logger.Warn("Nimiq RPC unavailable at startup; payment reconciliation will retry")
	} else if err != nil {
		return err
	}
	payments := application.Payments{Store: database.PaymentRepository{Pool: pool}, Chain: rpc, Network: domain.NimiqNetwork(cfg.Network), Now: time.Now}
	workerCtx, cancelWorker := context.WithCancel(ctx)
	workerDone := startReconciler(workerCtx, 10*time.Second, payments.ReconcileDue, logger)

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
	go func() { serverErr <- server.ListenAndServe() }()
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
	<-workerDone
	return errors.Join(serveErr, shutdownErr)
}

func startReconciler(ctx context.Context, interval time.Duration, reconcile func(context.Context) error, logger *slog.Logger) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := reconcile(ctx); err != nil && ctx.Err() == nil {
					logger.Warn("payment reconciliation delayed", "error", err)
				}
			}
		}
	}()
	return done
}
