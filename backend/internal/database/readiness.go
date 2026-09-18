package database

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CheckMigrations is read-only: startup/readiness must never silently migrate.
func CheckMigrations(ctx context.Context, pool *pgxpool.Pool, directory string) error {
	files, err := filepath.Glob(filepath.Join(directory, "*.up.sql"))
	if err != nil || len(files) == 0 {
		return errors.New("migration files unavailable")
	}
	rows, err := pool.Query(ctx, `SELECT version,checksum FROM schema_migrations`)
	if err != nil {
		return errors.New("migration state unavailable")
	}
	applied := map[int64]string{}
	for rows.Next() {
		var version int64
		var checksum string
		if err := rows.Scan(&version, &checksum); err != nil {
			rows.Close()
			return err
		}
		applied[version] = checksum
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(applied) != len(files) {
		return errors.New("database migrations differ from release")
	}
	for _, file := range files {
		prefix, _, _ := strings.Cut(filepath.Base(file), "_")
		version, err := strconv.ParseInt(prefix, 10, 64)
		if err != nil {
			return errors.New("invalid migration version")
		}
		data, err := os.ReadFile(file)
		if err != nil {
			return errors.New("migration file unavailable")
		}
		sum := sha256.Sum256(data)
		if applied[version] != hex.EncodeToString(sum[:]) {
			return errors.New("migration checksum mismatch")
		}
		// Consume each version exactly once. A duplicate file must not mask a
		// missing version just because the total number of files is unchanged.
		delete(applied, version)
	}
	return nil
}

// BindDeployment serializes first boot across replicas and refuses existing data
// from a different network/environment. Operators use separate databases.
func BindDeployment(ctx context.Context, pool *pgxpool.Pool, network, environment string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return errors.New("deployment context unavailable")
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(486091988)`); err != nil {
		return err
	}
	var mismatch bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM purchases WHERE network<>$1) OR EXISTS(SELECT 1 FROM auth_challenges WHERE network<>$1 OR environment<>$2) OR EXISTS(SELECT 1 FROM redemption_challenges WHERE network<>$1 OR environment<>$2)`, network, environment).Scan(&mismatch); err != nil {
		return errors.New("cannot inspect deployment context")
	}
	if mismatch {
		return errors.New("database contains a different network or environment")
	}
	if _, err := tx.Exec(ctx, `INSERT INTO deployment_context(singleton,network,environment) VALUES(true,$1,$2) ON CONFLICT(singleton) DO NOTHING`, network, environment); err != nil {
		return errors.New("cannot bind deployment context")
	}
	var actualNetwork, actualEnvironment string
	if err := tx.QueryRow(ctx, `SELECT network,environment FROM deployment_context WHERE singleton`).Scan(&actualNetwork, &actualEnvironment); err != nil {
		return err
	}
	if actualNetwork != network || actualEnvironment != environment {
		return errors.New("database deployment context mismatch")
	}
	return tx.Commit(ctx)
}
