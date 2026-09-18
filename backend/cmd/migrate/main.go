package main

import (
	"context"
	"log/slog"
	"os"

	"nimpass/backend/internal/config"
	"nimpass/backend/internal/database"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(); err != nil {
		logger.Error("migration failed; verify config, connectivity and migration checksums")
		os.Exit(1)
	}
	logger.Info("migrations applied")
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	return database.Migrate(ctx, pool, cfg.MigrationsDir)
}
