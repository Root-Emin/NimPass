package database

import (
	"context"
	"crypto/sha256"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

// PostgreSQL is the authority across replicas and process restarts. No raw IP,
// wallet, session token or redemption reference is stored in the bucket key.
type RateLimiter struct{ Pool *pgxpool.Pool }

func (l RateLimiter) Allow(ctx context.Context, key string, max int, window time.Duration) bool {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	digest := sha256.Sum256([]byte(key))
	var count int
	err := l.Pool.QueryRow(ctx, `INSERT INTO rate_limit_buckets(key_digest,attempts,resets_at) VALUES($1,1,clock_timestamp()+$2::bigint*interval '1 millisecond') ON CONFLICT(key_digest) DO UPDATE SET attempts=CASE WHEN rate_limit_buckets.resets_at<=clock_timestamp() THEN 1 ELSE LEAST(rate_limit_buckets.attempts+1,$3+1) END,resets_at=CASE WHEN rate_limit_buckets.resets_at<=clock_timestamp() THEN clock_timestamp()+$2::bigint*interval '1 millisecond' ELSE rate_limit_buckets.resets_at END RETURNING attempts`, digest[:], window.Milliseconds(), max).Scan(&count)
	return err == nil && count <= max
}

func (l RateLimiter) Cleanup(ctx context.Context) error {
	// Bounded batches avoid a long delete transaction under an IP flood.
	// Recheck expiry on the target row after obtaining its lock: the candidate
	// subquery may have observed the old expired row while Allow renews it.
	_, err := l.Pool.Exec(ctx, `DELETE FROM rate_limit_buckets WHERE resets_at<now() AND key_digest IN (SELECT key_digest FROM rate_limit_buckets WHERE resets_at<now() ORDER BY resets_at LIMIT 10000)`)
	return err
}
