package database

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCoreMigrationConstraints(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to a disposable PostgreSQL database ending in _test")
	}
	u, err := url.Parse(dsn)
	if err != nil || !strings.HasSuffix(strings.TrimPrefix(u.Path, "/"), "_test") {
		t.Fatal("TEST_DATABASE_URL must name a disposable database ending in _test")
	}
	ctx := context.Background()
	admin, err := Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "nimpass_test_" + strings.ReplaceAll(testUUID(t), "-", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		defer admin.Close()
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("drop generated test schema: %v", err)
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
	defer pool.Close()
	if err := Migrate(ctx, pool, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	var migrationWG sync.WaitGroup
	migrationErrors := make(chan error, 8)
	for range 8 {
		migrationWG.Add(1)
		go func() {
			defer migrationWG.Done()
			migrationErrors <- Migrate(ctx, pool, "../../migrations")
		}()
	}
	migrationWG.Wait()
	close(migrationErrors)
	for migrationErr := range migrationErrors {
		if migrationErr != nil {
			t.Fatalf("concurrent migration: %v", migrationErr)
		}
	}
	if err := Migrate(ctx, pool, "../../migrations"); err != nil {
		t.Fatalf("migration not idempotent: %v", err)
	}
	var migrationCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&migrationCount); err != nil || migrationCount != 6 {
		t.Fatalf("migration history count=%d err=%v", migrationCount, err)
	}
	var dueIndex bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='payment_candidates_due_idx')`).Scan(&dueIndex); err != nil || !dueIndex {
		t.Fatalf("reconciliation due index missing: %v", err)
	}

	now := time.Now().UTC()
	identityID, providerID, serviceID, packageID := testUUID(t), testUUID(t), testUUID(t), testUUID(t)
	purchaseID, passID := testUUID(t), testUUID(t)
	wallet := "NQ" + strings.Repeat("A", 34)
	payout := "NQ" + strings.Repeat("B", 34)
	assertExec(t, pool, `INSERT INTO identities(id,wallet_address,created_at) VALUES($1,$2,$3)`, identityID, wallet, now)
	assertExec(t, pool, `INSERT INTO providers(id,owner_identity_id,name,payout_wallet,payout_verified_at,created_at,updated_at) VALUES($1,$2,'Provider',$3,$4,$4,$4)`, providerID, identityID, payout, now)
	assertExec(t, pool, `INSERT INTO services(id,provider_id,name,status,created_at,updated_at) VALUES($1,$2,'Service','ACTIVE',$3,$3)`, serviceID, providerID, now)
	assertExec(t, pool, `INSERT INTO packages(id,provider_id,service_id,title,session_count,price_luna,status,created_at,updated_at) VALUES($1,$2,$3,'Package',10,25000000,'ACTIVE',$4,$4)`, packageID, providerID, serviceID, now)
	hash := strings.Repeat("a", 64)
	ref := "NP:" + strings.Repeat("b", 32)
	assertExec(t, pool, `INSERT INTO purchases(id,customer_context_id,package_id,provider_id,service_id,package_title_snapshot,service_name_snapshot,provider_name_snapshot,purchased_sessions,expected_price_luna,recipient_wallet,network,payment_reference,status,transaction_hash,verified_sender_wallet,created_at,expires_at,confirmed_at) VALUES($1,$2,$3,$4,$5,'Package','Service','Provider',10,25000000,$6,'TESTNET',$7,'CONFIRMED',$8,$9,$10,$11,$12)`, purchaseID, testUUID(t), packageID, providerID, serviceID, payout, ref, hash, wallet, now, now.Add(30*time.Minute), now.Add(time.Minute))
	assertExec(t, pool, `INSERT INTO passes(id,purchase_id,package_id,provider_id,service_id,owner_wallet,package_title_snapshot,service_name_snapshot,provider_name_snapshot,price_luna_snapshot,original_sessions,used_sessions,remaining_sessions,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'Package','Service','Provider',25000000,10,0,10,'ACTIVE',$7)`, passID, purchaseID, packageID, providerID, serviceID, wallet, now)

	assertReject(t, pool, `UPDATE passes SET remaining_sessions=-1 WHERE id=$1`, passID)
	assertReject(t, pool, `UPDATE passes SET used_sessions=1 WHERE id=$1`, passID)
	assertReject(t, pool, `UPDATE passes SET remaining_sessions=0,status='COMPLETED',completed_at=now() WHERE id=$1`, passID)
	assertReject(t, pool, `INSERT INTO packages(id,provider_id,service_id,title,session_count,price_luna,status,created_at,updated_at) VALUES($1,$2,$3,'Invalid',0,1,'ACTIVE',$4,$4)`, testUUID(t), providerID, serviceID, now)
	assertReject(t, pool, `INSERT INTO passes(id,purchase_id,package_id,provider_id,service_id,owner_wallet,package_title_snapshot,service_name_snapshot,provider_name_snapshot,price_luna_snapshot,original_sessions,used_sessions,remaining_sessions,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'Package','Service','Provider',25000000,10,0,10,'ACTIVE',$7)`, testUUID(t), purchaseID, packageID, providerID, serviceID, wallet, now)
	assertReject(t, pool, `INSERT INTO passes(id,purchase_id,package_id,provider_id,service_id,owner_wallet,package_title_snapshot,service_name_snapshot,provider_name_snapshot,price_luna_snapshot,original_sessions,used_sessions,remaining_sessions,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'Package','Service','Provider',25000000,10,0,10,'ACTIVE',$7)`, testUUID(t), purchaseID, packageID, providerID, serviceID, payout, now)
	assertReject(t, pool, `INSERT INTO purchases(id,customer_context_id,package_id,provider_id,service_id,package_title_snapshot,service_name_snapshot,provider_name_snapshot,purchased_sessions,expected_price_luna,recipient_wallet,network,payment_reference,status,transaction_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,'Package','Service','Provider',10,25000000,$6,'TESTNET',$7,'TRANSACTION_SUBMITTED',$8,$9,$10)`, testUUID(t), testUUID(t), packageID, providerID, serviceID, payout, "NP:"+strings.Repeat("c", 32), hash, now, now.Add(30*time.Minute))

	challengeID := testUUID(t)
	assertExec(t, pool, `INSERT INTO redemption_challenges(id,pass_id,provider_id,owner_wallet,nonce,status,created_at,expires_at) VALUES($1,$2,$3,$4,$5,'CREATED',$6,$7)`, challengeID, passID, providerID, wallet, testUUID(t), now, now.Add(time.Minute))
	otherProviderID := testUUID(t)
	assertExec(t, pool, `INSERT INTO providers(id,owner_identity_id,name,created_at,updated_at) VALUES($1,$2,'Other Provider',$3,$3)`, otherProviderID, identityID, now)
	assertReject(t, pool, `INSERT INTO redemption_challenges(id,pass_id,provider_id,owner_wallet,nonce,status,created_at,expires_at) VALUES($1,$2,$3,$4,$5,'CREATED',$6,$7)`, testUUID(t), passID, otherProviderID, wallet, testUUID(t), now, now.Add(time.Minute))
	assertReject(t, pool, `INSERT INTO redemption_challenges(id,pass_id,provider_id,owner_wallet,nonce,status,created_at,expires_at) VALUES($1,$2,$3,$4,$5,'CREATED',$6,$7)`, testUUID(t), passID, providerID, wallet, testUUID(t), now, now.Add(time.Minute))
	assertReject(t, pool, `INSERT INTO redemptions(id,challenge_id,pass_id,provider_id,owner_wallet,session_ordinal,sessions_consumed,consumed_at) VALUES($1,$2,$3,$4,$5,1,2,$6)`, testUUID(t), challengeID, passID, providerID, wallet, now)
	assertExec(t, pool, `INSERT INTO redemptions(id,challenge_id,pass_id,provider_id,owner_wallet,session_ordinal,sessions_consumed,consumed_at) VALUES($1,$2,$3,$4,$5,1,1,$6)`, testUUID(t), challengeID, passID, providerID, wallet, now)
	assertReject(t, pool, `INSERT INTO redemptions(id,challenge_id,pass_id,provider_id,owner_wallet,session_ordinal,sessions_consumed,consumed_at) VALUES($1,$2,$3,$4,$5,2,1,$6)`, testUUID(t), challengeID, passID, providerID, wallet, now)

	compID := testUUID(t)
	compHash := strings.Repeat("d", 64)
	compRef := "NP1:" + strings.Repeat("e", 32)
	assertExec(t, pool, `INSERT INTO purchases(id,customer_context_id,package_id,provider_id,service_id,package_title_snapshot,service_name_snapshot,provider_name_snapshot,purchased_sessions,expected_price_luna,recipient_wallet,network,payment_reference,status,transaction_hash,verified_sender_wallet,created_at,expires_at,confirmed_at) VALUES($1,$2,$3,$4,$5,'Package','Service','Provider',10,25000000,$6,'TESTNET',$7,'COMPENSATION_REQUIRED',$8,$9,$10,$11,$12)`, compID, testUUID(t), packageID, providerID, serviceID, payout, compRef, compHash, wallet, now, now.Add(30*time.Minute), now.Add(time.Minute))
	assertReject(t, pool, `INSERT INTO compensation_cases(purchase_id,transaction_hash,reason,created_at) VALUES($1,$2,'PACKAGE_EXPIRED_BEFORE_ACTIVATION',$3)`, compID, compHash, now)
	assertExec(t, pool, `INSERT INTO verified_payments(transaction_hash,purchase_id,sender_wallet,recipient_wallet,value_luna,network,inclusion_block,included_at,finality_block,finalized_at) VALUES($1,$2,$3,$4,25000000,'TESTNET',100,$5,120,$6)`, compHash, compID, wallet, payout, now, now.Add(time.Minute))
	assertExec(t, pool, `INSERT INTO compensation_cases(purchase_id,transaction_hash,reason,created_at) VALUES($1,$2,'PACKAGE_EXPIRED_BEFORE_ACTIVATION',$3)`, compID, compHash, now)
	assertReject(t, pool, `INSERT INTO compensation_cases(purchase_id,transaction_hash,reason,created_at) VALUES($1,$2,'PACKAGE_EXPIRED_BEFORE_ACTIVATION',$3)`, compID, hash, now)
	assertReject(t, pool, `UPDATE compensation_cases SET status='RESOLVED',resolved_at=$2,resolution_kind='MANUAL_REFUND' WHERE purchase_id=$1`, compID, now.Add(time.Hour))
	assertExec(t, pool, `UPDATE compensation_cases SET status='RESOLVED',resolved_at=$2,resolution_kind='REISSUE',resolution_reference='manual-ticket-1' WHERE purchase_id=$1`, compID, now.Add(time.Hour))
}

func testUUID(t *testing.T) string {
	t.Helper()
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		t.Fatal(err)
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	value := hex.EncodeToString(raw[:])
	return value[:8] + "-" + value[8:12] + "-" + value[12:16] + "-" + value[16:20] + "-" + value[20:]
}

func assertExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func assertReject(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err == nil {
		t.Fatalf("expected database constraint rejection: %s", sql)
	}
}
