package main

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"nimpass/backend/internal/database"
	"nimpass/backend/internal/domain"
)

/*
The name a seeded wallet sells under is a public creator name.

Every pass this account publishes carries it on Discover, to every visitor,
signed in or not. So the seed may not invent one, and — the failure this test
exists for — may not write one back over a name the person has since chosen on
Profile: a reseed that restores "Your Studio" renames a real provider in front
of their customers, and the relation behind it is persisted well enough that it
survives logout and looks entirely deliberate.
*/

func seedTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to disposable PostgreSQL _test database")
	}
	parsed, err := url.Parse(dsn)
	if err != nil || !strings.HasSuffix(strings.TrimPrefix(parsed.Path, "/"), "_test") {
		t.Fatal("TEST_DATABASE_URL must end in _test")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	id, err := domain.NewID()
	if err != nil {
		t.Fatal(err)
	}
	schema := "nimpass_seed_" + strings.ReplaceAll(string(id), "-", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		defer admin.Close()
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := database.Migrate(ctx, pool, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	return pool
}

func TestSeededWorkspaceNeverInventsOrOverwritesACreatorName(t *testing.T) {
	pool := seedTestPool(t)
	ctx := context.Background()
	now := time.Now().UTC()

	// One seed run, in the shape `run` uses it: read the workspace as it
	// stands, then write it back.
	seed := func(t *testing.T, requested string) (string, ownWorkspace) {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()
		own, err := currentWorkspace(ctx, tx)
		if err != nil {
			t.Fatal(err)
		}
		if requested != "" {
			own.name, own.renamed = requested, true
		}
		if err := removeSeed(ctx, tx); err != nil {
			t.Fatal(err)
		}
		// The customer identity, re-established after the clear exactly as
		// `insertSeed` does it, because the workspace is owned by it.
		if _, err := tx.Exec(ctx,
			`INSERT INTO identities(id,wallet_address,created_at) VALUES($1,$2,$3)
			 ON CONFLICT(wallet_address) DO UPDATE SET wallet_address=EXCLUDED.wallet_address`,
			id(1), devWallet("07DEVCUSTOMER"), now); err != nil {
			t.Fatal(err)
		}
		name, err := insertWorkspace(ctx, tx, id(1), own, now)
		if err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		return name, own
	}

	stored := func(t *testing.T) (name, slug string) {
		t.Helper()
		err := pool.QueryRow(ctx, `SELECT name,slug FROM providers WHERE id=$1`, id(ownWorkspaceProviderID)).Scan(&name, &slug)
		if err != nil && !strings.Contains(err.Error(), "no rows") {
			t.Fatal(err)
		}
		return name, slug
	}

	// Nothing asked for, nothing stored: no workspace, rather than a
	// placeholder standing in for a person.
	if name, _ := seed(t, ""); name != "" {
		t.Fatalf("seed invented the creator name %q", name)
	}
	if name, _ := stored(t); name != "" {
		t.Fatalf("a provider row was written with the name %q", name)
	}

	// Named once, by the operator.
	if name, _ := seed(t, "Emin Kutlu"); name != "Emin Kutlu" {
		t.Fatalf("workspace named %q", name)
	}
	name, slug := stored(t)
	if name != "Emin Kutlu" || slug != "emin-kutlu" {
		t.Fatalf("stored %q/%q", name, slug)
	}

	// Renamed on Profile, the way a provider actually renames themselves.
	if _, err := pool.Exec(ctx, `UPDATE providers SET name='Emin K.' WHERE id=$1`, id(ownWorkspaceProviderID)); err != nil {
		t.Fatal(err)
	}

	// A reseed keeps it. This is the regression: the name and the public link
	// a customer has already seen both survive.
	seed(t, "")
	if name, slug = stored(t); name != "Emin K." || slug != "emin-kutlu" {
		t.Fatalf("a reseed rewrote the creator to %q/%q", name, slug)
	}

	// And the operator can still rename it deliberately.
	seed(t, "Emin Kutlu")
	if name, slug = stored(t); name != "Emin Kutlu" || slug != "emin-kutlu" {
		t.Fatalf("-display-name did not rename: %q/%q", name, slug)
	}
}
