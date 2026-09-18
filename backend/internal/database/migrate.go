package database

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Migrate applies forward-only SQL migrations inside one transaction, protected
// by a PostgreSQL advisory lock. Deployments should run it before the server.
func Migrate(ctx context.Context, pool *pgxpool.Pool, directory string) error {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	var files []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".up.sql") {
			files = append(files, entry.Name())
		}
	}
	sort.Strings(files)
	if len(files) == 0 {
		return fmt.Errorf("no forward migrations in %s", directory)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin migration: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(486091987)"); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}
	if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version bigint PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create migration history: %w", err)
	}
	var highest int64
	if err := tx.QueryRow(ctx, `SELECT coalesce(max(version),0) FROM schema_migrations`).Scan(&highest); err != nil {
		return err
	}
	seen := make(map[int64]bool, len(files))
	for _, name := range files {
		prefix, _, ok := strings.Cut(name, "_")
		if !ok {
			return fmt.Errorf("invalid migration filename %q", name)
		}
		version, err := strconv.ParseInt(prefix, 10, 64)
		if err != nil {
			return fmt.Errorf("invalid migration version %q: %w", name, err)
		}
		if seen[version] {
			return fmt.Errorf("duplicate migration version %d", version)
		}
		seen[version] = true
		data, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		sum := sha256.Sum256(data)
		checksum := hex.EncodeToString(sum[:])
		var appliedChecksum string
		err = tx.QueryRow(ctx, "SELECT checksum FROM schema_migrations WHERE version=$1", version).Scan(&appliedChecksum)
		if err == nil {
			if appliedChecksum != checksum {
				return fmt.Errorf("applied migration %s checksum changed", name)
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if version <= highest {
			return fmt.Errorf("migration %s is older than applied history", name)
		}
		if _, err := tx.Exec(ctx, string(data)); err != nil {
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations(version, checksum) VALUES($1, $2)", version, checksum); err != nil {
			return fmt.Errorf("record migration %s: %w", name, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit migrations: %w", err)
	}
	return nil
}
