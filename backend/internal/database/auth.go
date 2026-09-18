package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

type AuthRepository struct{ Pool *pgxpool.Pool }

func (r AuthRepository) InsertChallenge(ctx context.Context, c application.Challenge) error {
	var provider any
	if c.ProviderID != "" {
		provider = string(c.ProviderID)
	}
	_, err := r.Pool.Exec(ctx, `INSERT INTO auth_challenges(id,purpose,wallet_address,provider_id,nonce,network,environment,issued_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, c.ID, c.Purpose, c.Wallet, provider, c.Nonce, c.Network, c.Environment, c.IssuedAt, c.ExpiresAt)
	return err
}

func (r AuthRepository) GetChallenge(ctx context.Context, id domain.ID) (application.Challenge, error) {
	var c application.Challenge
	var provider *string
	err := r.Pool.QueryRow(ctx, `SELECT id,purpose,wallet_address,provider_id,nonce,network,environment,issued_at,expires_at,consumed_at,failed_attempts FROM auth_challenges WHERE id=$1`, id).Scan(&c.ID, &c.Purpose, &c.Wallet, &provider, &c.Nonce, &c.Network, &c.Environment, &c.IssuedAt, &c.ExpiresAt, &c.ConsumedAt, &c.FailedAttempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, application.ErrNotFound
	}
	if provider != nil {
		c.ProviderID = domain.ID(*provider)
	}
	return c, err
}

func (r AuthRepository) RecordChallengeFailure(ctx context.Context, id domain.ID) error {
	_, err := r.Pool.Exec(ctx, `WITH failed AS (UPDATE auth_challenges SET failed_attempts=LEAST(failed_attempts+1,5) WHERE id=$1 AND consumed_at IS NULL RETURNING id) INSERT INTO auth_events(challenge_id,kind) SELECT id,'PROOF_FAILED' FROM failed`, id)
	return err
}

func (r AuthRepository) CompleteLogin(ctx context.Context, challengeID domain.ID, wallet string, tokenDigest, csrfDigest [32]byte, sessionID domain.ID, now, expires time.Time) (application.Session, error) {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return application.Session{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var actual string
	err = tx.QueryRow(ctx, `UPDATE auth_challenges SET consumed_at=$3 WHERE id=$1 AND purpose='AUTH_LOGIN' AND wallet_address=$2 AND consumed_at IS NULL AND expires_at>$3 AND failed_attempts<5 RETURNING wallet_address`, challengeID, wallet, now).Scan(&actual)
	if errors.Is(err, pgx.ErrNoRows) {
		return application.Session{}, application.ErrConsumed
	}
	if err != nil {
		return application.Session{}, err
	}
	identityID, err := domain.NewID()
	if err != nil {
		return application.Session{}, err
	}
	var identity application.Identity
	err = tx.QueryRow(ctx, `INSERT INTO identities(id,wallet_address,created_at) VALUES($1,$2,$3) ON CONFLICT(wallet_address) DO UPDATE SET wallet_address=EXCLUDED.wallet_address RETURNING id,wallet_address,created_at`, identityID, wallet, now).Scan(&identity.ID, &identity.Wallet, &identity.CreatedAt)
	if err != nil {
		return application.Session{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO auth_sessions(id,identity_id,token_digest,csrf_digest,created_at,expires_at,last_used_at) VALUES($1,$2,$3,$4,$5,$6,$5)`, sessionID, identity.ID, tokenDigest[:], csrfDigest[:], now, expires)
	if err != nil {
		return application.Session{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO auth_events(challenge_id,kind,occurred_at) VALUES($1,'LOGIN_SUCCEEDED',$2)`, challengeID, now); err != nil {
		return application.Session{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return application.Session{}, err
	}
	return application.Session{ID: sessionID, Identity: identity, CreatedAt: now, ExpiresAt: expires, LastUsedAt: now, CSRFDigest: csrfDigest}, nil
}

func (r AuthRepository) CompletePayout(ctx context.Context, challengeID, providerID, actorID domain.ID, wallet string, now time.Time) error {
	tx, err := r.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var oldWallet *string
	err = tx.QueryRow(ctx, `SELECT payout_wallet FROM providers WHERE id=$1 AND owner_identity_id=$2 FOR UPDATE`, providerID, actorID).Scan(&oldWallet)
	if errors.Is(err, pgx.ErrNoRows) {
		return application.ErrNotFound
	}
	if err != nil {
		return err
	}
	var actual string
	err = tx.QueryRow(ctx, `UPDATE auth_challenges SET consumed_at=$4 WHERE id=$1 AND purpose='VERIFY_PROVIDER_WALLET' AND provider_id=$2 AND wallet_address=$3 AND consumed_at IS NULL AND expires_at>$4 AND failed_attempts<5 RETURNING wallet_address`, challengeID, providerID, wallet, now).Scan(&actual)
	if errors.Is(err, pgx.ErrNoRows) {
		return application.ErrConsumed
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE providers SET payout_wallet=$2,payout_verified_at=$3,updated_at=$3 WHERE id=$1`, providerID, wallet, now)
	if err != nil {
		return err
	}
	auditID, err := domain.NewID()
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO provider_payout_audit(id,provider_id,actor_identity_id,challenge_id,previous_wallet,new_wallet,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, auditID, providerID, actorID, challengeID, oldWallet, wallet, now)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r AuthRepository) FindSession(ctx context.Context, digest [32]byte, now time.Time) (application.Session, error) {
	var s application.Session
	var csrf []byte
	err := r.Pool.QueryRow(ctx, `UPDATE auth_sessions AS s SET last_used_at=$2 FROM identities AS i WHERE s.token_digest=$1 AND s.identity_id=i.id AND s.expires_at>$2 AND s.revoked_at IS NULL RETURNING s.id,s.created_at,s.expires_at,s.last_used_at,s.revoked_at,s.csrf_digest,i.id,i.wallet_address,i.created_at`, digest[:], now).Scan(&s.ID, &s.CreatedAt, &s.ExpiresAt, &s.LastUsedAt, &s.RevokedAt, &csrf, &s.Identity.ID, &s.Identity.Wallet, &s.Identity.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, application.ErrForbidden
	}
	if err != nil {
		return s, err
	}
	copy(s.CSRFDigest[:], csrf)
	return s, nil
}

func (r AuthRepository) RevokeSession(ctx context.Context, id domain.ID, now time.Time) error {
	_, err := r.Pool.Exec(ctx, `UPDATE auth_sessions SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL`, id, now)
	return err
}
