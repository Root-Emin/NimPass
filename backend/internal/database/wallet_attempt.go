package database

import (
	"context"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

// BeginWalletAttempt grants one dispatch, not proof of payment. Repeating even
// the same attempt ID is rejected: replay must not open a second wallet sheet.
func (r PaymentRepository) BeginWalletAttempt(ctx context.Context, id, customer, attempt domain.ID, now time.Time) (PurchaseRecord, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return PurchaseRecord{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	p, err := scanPurchase(tx.QueryRow(ctx, `SELECT `+purchaseFields+purchaseJoins+` WHERE p.id=$1 AND p.customer_context_id=$2 FOR UPDATE OF p`, id, customer))
	if err != nil {
		return p, err
	}
	if p.WalletAttemptPending || p.CandidateHash != "" || p.Purchase.Status != domain.PurchasePaymentPending {
		return p, application.ErrConflict
	}
	if !now.Before(p.Purchase.ExpiresAt) {
		return p, application.ErrExpired
	}
	_, err = tx.Exec(ctx, `UPDATE purchases SET wallet_attempt_id=$2,wallet_attempt_at=$3 WHERE id=$1`, id, attempt, now)
	if err != nil {
		return p, err
	}
	// Return the instruction read under the lock only to the dispatch winner.
	return p, tx.Commit(ctx)
}

// Only the initiating attempt can report a definite wallet rejection. This is
// not a payment cancellation and never removes candidate/verified evidence.
func (r PaymentRepository) ReleaseWalletAttempt(ctx context.Context, id, customer, attempt domain.ID) error {
	tag, err := r.Pool.Exec(ctx, `UPDATE purchases p SET wallet_attempt_id=NULL,wallet_attempt_at=NULL
        WHERE p.id=$1 AND p.customer_context_id=$2 AND p.wallet_attempt_id=$3
        AND p.status='PAYMENT_PENDING' AND NOT EXISTS (SELECT 1 FROM payment_candidates c WHERE c.purchase_id=p.id)`, id, customer, attempt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return application.ErrConflict
	}
	return nil
}
