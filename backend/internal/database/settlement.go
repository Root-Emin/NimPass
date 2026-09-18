package database

import (
	"context"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

// DueSettlements lists the provisional receipts whose finality is worth
// checking again.
//
// The work list lives entirely in the database, which is what makes fast
// settlement survive a restart: a receipt written as INCLUDED is due here the
// moment the process comes back, with no in-memory tracking to lose. Safe on
// several replicas too — two workers may both pick up a receipt, and both
// writes below then serialise on the purchase row and find the state already
// moved.
//
// Backoff follows the rule the rest of the payment system follows
// (ADR-013, ADR-019): **attempts count failures, never quiet.** A macro block
// that has not been produced yet is the ordinary state of a receipt one second
// old, and `NoteSettlementCheck` leaves `settlement_attempts` at zero, so such
// a receipt is re-examined at the sweep's own tempo. Only an answer the node
// could not give — a timeout, a 429, a resyncing node, a transaction the chain
// will not show — backs off, 30s, 60s, up to 8m.
func (r PaymentRepository) DueSettlements(ctx context.Context, now time.Time, limit int) ([]application.DueSettlement, error) {
	rows, err := r.Pool.Query(ctx, `SELECT v.transaction_hash,v.purchase_id,p.customer_context_id,p.expected_wallet,v.sender_wallet,v.recipient_wallet,v.value_luna,v.network,v.inclusion_block,v.included_at,v.expected_finality_block,v.settlement_attempts,p.payment_reference
  FROM verified_payments v JOIN purchases p ON p.id=v.purchase_id
 WHERE v.settlement_status='INCLUDED'
   AND (v.settlement_checked_at IS NULL OR v.settlement_checked_at < $1::timestamptz - CASE WHEN v.settlement_attempts = 0 THEN interval '2 seconds' ELSE interval '30 seconds' * power(2,LEAST(v.settlement_attempts,4)) END)
 ORDER BY v.settlement_checked_at NULLS FIRST,v.transaction_hash LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]application.DueSettlement, 0, limit)
	for rows.Next() {
		var item application.DueSettlement
		var wallet *string
		var inclusionBlock, expectedFinality int64
		receipt := &item.Receipt
		if err := rows.Scan(&receipt.Hash, &item.PurchaseID, &item.Customer.ID, &wallet, &receipt.Sender, &receipt.Recipient,
			&receipt.AmountLuna, &receipt.Network, &inclusionBlock, &receipt.IncludedAt, &expectedFinality,
			&item.Attempts, &receipt.Reference); err != nil {
			return nil, err
		}
		if wallet != nil {
			item.Customer.Wallet = *wallet
		}
		receipt.Included = true
		receipt.InclusionBlock = uint32(inclusionBlock)
		item.Network = receipt.Network
		item.ExpectedFinalityBlock = uint32(expectedFinality)
		out = append(out, item)
	}
	return out, rows.Err()
}

// NoteSettlementCheck records a look that answered "not yet".
//
// The macro block has not been produced, which is not a failure of anything.
// It moves the clock without touching the attempt counter, so a receipt
// waiting out a normal batch stays on the fast tempo instead of being backed
// off for being new.
func (r PaymentRepository) NoteSettlementCheck(ctx context.Context, hash string, now time.Time) error {
	_, err := r.Pool.Exec(ctx, `UPDATE verified_payments SET settlement_checked_at=$2,settlement_attempts=0 WHERE transaction_hash=$1 AND settlement_status='INCLUDED'`, hash, now)
	return err
}

// NoteSettlementFailure records a look that could not be completed.
//
// The distinction this preserves is the one the whole payment path rests on
// (docs/05 §97): an endpoint that could not answer has told us nothing about
// the payment. So this only backs the receipt off — it never changes its
// settlement state, never touches the purchase, and never takes a Pass away.
// The customer's money is, as far as anything here knows, exactly where they
// sent it.
func (r PaymentRepository) NoteSettlementFailure(ctx context.Context, hash string, now time.Time) error {
	_, err := r.Pool.Exec(ctx, `UPDATE verified_payments SET settlement_checked_at=$2,settlement_attempts=LEAST(settlement_attempts+1,4) WHERE transaction_hash=$1 AND settlement_status='INCLUDED'`, hash, now)
	return err
}

// FinalizeSettlement promotes a provisional receipt to finalised.
//
// Idempotent under concurrency by locking first and re-reading inside the
// lock: two workers that both observed the macro block serialise here, and the
// second finds a row that no longer says INCLUDED and commits without writing.
// That is also why the promotion is validated against the *re-read* receipt
// rather than the one the caller was holding — the caller's copy is from
// before the lock.
func (r PaymentRepository) FinalizeSettlement(ctx context.Context, item application.DueSettlement, evidence domain.VerifiedPayment, now time.Time) error {
	return r.settle(ctx, item, func(tx pgx.Tx, stored domain.VerifiedPayment) error {
		final, err := domain.PromoteSettlement(stored, evidence)
		if err != nil {
			// Refused, not forced. Evidence that does not establish finality
			// over the accepted inclusion leaves the receipt provisional and
			// lets the next sweep look again.
			return application.ErrConflict
		}
		if _, err := tx.Exec(ctx, `UPDATE verified_payments SET settlement_status='FINALIZED',finality_block=$2,finalized_at=$3,settlement_checked_at=$4,settlement_attempts=0 WHERE transaction_hash=$1 AND settlement_status='INCLUDED'`, stored.Hash, final.FinalityBlock, final.FinalizedAt, now); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,occurred_at) VALUES($1,'PAYMENT_FINALIZED',$2)`, item.PurchaseID, now)
		return err
	})
}

// ReanchorSettlement moves a provisional receipt onto a new canonical
// inclusion of the same transaction.
//
// Case B of the reorg model. The purchase, its confirmation and its Pass are
// all untouched — nothing economic changed, the payment simply arrived in a
// different block — so this rewrites the inclusion evidence and the macro
// height being waited for, and resets the backoff because the receipt is
// freshly current. The old inclusion block is not preserved as a column; it is
// preserved as the PAYMENT_REANCHORED event, which is where the history of a
// receipt belongs.
func (r PaymentRepository) ReanchorSettlement(ctx context.Context, item application.DueSettlement, evidence domain.VerifiedPayment, now time.Time) error {
	return r.settle(ctx, item, func(tx pgx.Tx, stored domain.VerifiedPayment) error {
		fresh, err := domain.ReanchorSettlement(stored, evidence)
		if err != nil {
			return application.ErrConflict
		}
		if _, err := tx.Exec(ctx, `UPDATE verified_payments SET inclusion_block=$2,included_at=$3,expected_finality_block=$4,settlement_checked_at=$5,settlement_attempts=0 WHERE transaction_hash=$1 AND settlement_status='INCLUDED'`, stored.Hash, fresh.InclusionBlock, fresh.IncludedAt, fresh.FinalityBlock, now); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,category,occurred_at) VALUES($1,'PAYMENT_REANCHORED',$2,$3)`, item.PurchaseID, blockCategory(stored.InclusionBlock, fresh.InclusionBlock), now)
		return err
	})
}

// ReverseSettlement records that a provisionally settled payment never became
// canonical, and withdraws what was issued against it.
//
// Case C, and the only operation in the system that takes a Pass back, so it
// is written to leave a complete account of why:
//
//   - the receipt is kept, moved to CONTESTED with the reason and the moment —
//     the inclusion block it was accepted in stays on the row, because it is
//     the evidence of what we saw and acted on;
//   - the purchase goes to COMPENSATION_REQUIRED, the state the product
//     already has for "receipt and entitlement disagree, a human must close
//     this";
//   - a compensation case opens against that exact receipt, in the existing
//     ledger rather than a second one;
//   - the Pass is cancelled and its open sessions with it, so nothing can be
//     spent against a payment that did not happen. Completed sessions are left
//     alone: they happened, and a provider who delivered one is a fact the
//     recovery case needs, not a row to erase. The session counters are left
//     alone for the same reason (ADR-024).
//
// A Pass that is no longer ACTIVE is deliberately not touched. If every session
// was already delivered (COMPLETED) or the pass ran out of time (EXPIRED),
// there is nothing left to withdraw, and rewriting that history to CANCELLED
// would erase the record of service a provider actually gave — which is the
// evidence the compensation case is settled from. The case still opens; a
// human closes it knowing what was delivered (ADR-024).
//
// Idempotent on the same lock-then-re-read basis as the promotion above.
func (r PaymentRepository) ReverseSettlement(ctx context.Context, item application.DueSettlement, reason string, now time.Time) error {
	return r.settle(ctx, item, func(tx pgx.Tx, stored domain.VerifiedPayment) error {
		if err := domain.ValidateContest(stored, now); err != nil {
			return application.ErrConflict
		}
		var purchase domain.Purchase
		if err := tx.QueryRow(ctx, `SELECT status,transaction_hash,confirmed_at FROM purchases WHERE id=$1`, item.PurchaseID).Scan(&purchase.Status, &purchase.TransactionHash, &purchase.ConfirmedAt); err != nil {
			return notFound(err)
		}
		// The domain decides whether this purchase may lose its settlement at
		// all. A purchase that is not confirmed has no Pass to withdraw, and a
		// receipt whose purchase already sits in compensation is somebody
		// else's case.
		if err := purchase.ReverseSettlement(now); err != nil {
			return application.ErrConflict
		}
		if purchase.TransactionHash != stored.Hash {
			return application.ErrConflict
		}
		if _, err := tx.Exec(ctx, `UPDATE verified_payments SET settlement_status='CONTESTED',contested_at=$2,contest_reason=$3,settlement_checked_at=$2,settlement_attempts=0 WHERE transaction_hash=$1 AND settlement_status='INCLUDED'`, stored.Hash, now, reason); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE purchases SET status='COMPENSATION_REQUIRED' WHERE id=$1 AND status='CONFIRMED'`, item.PurchaseID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE payment_candidates SET status='SETTLEMENT_REVERSED',last_checked_at=$2 WHERE purchase_id=$1`, item.PurchaseID, now); err != nil {
			return err
		}
		// The sessions nobody used are cancelled, so the pass's own session
		// list reads honestly: these were sold, they were never delivered, and
		// they never will be. Completed rows are untouched.
		if _, err := tx.Exec(ctx, `UPDATE pass_sessions SET status='CANCELLED',updated_at=$2 WHERE purchased_pass_id IN (SELECT id FROM purchased_passes WHERE purchase_id=$1) AND status IN ('UNSCHEDULED','SCHEDULED')`, item.PurchaseID, now); err != nil {
			return err
		}
		// The status is the withdrawal. The counters are not touched, and that
		// is the whole of the change ADR-024 makes here.
		//
		// This used to also write `remaining_sessions=0, used_sessions=
		// original_sessions`, which was forced by `passes_balance_consistent`
		// (used + remaining = original): zeroing one side obliges you to
		// inflate the other. The result was a Pass whose owner had attended
		// nothing claiming all ten sessions were used — the exact opposite of
		// what the comment above promises, and a direct break of the
		// invariant migration 000015 states, that every COMPLETED row
		// corresponds to one increment of `used_sessions`. The recovery case
		// is then read off a counter that says the customer consumed what they
		// never received.
		//
		// Nothing is made spendable by leaving them alone. Redemption is
		// refused at three independent layers on the pass's *status*, not on
		// its counters: `application.Redemptions` and `database` both reject a
		// pass that is not ACTIVE, `domain.PurchasedPass.ConsumeSession`
		// requires ACTIVE, and `spendPassSession`'s own WHERE clause carries
		// `AND status='ACTIVE'`. The counters were belt-and-braces over a
		// guard that never depended on them.
		//
		// The table's CHECKs are satisfied untouched: `used + remaining =
		// original` still holds because neither side moved, and
		// `passes_active_balance` only constrains an ACTIVE pass.
		if _, err := tx.Exec(ctx, `UPDATE purchased_passes SET status='CANCELLED' WHERE purchase_id=$1 AND status='ACTIVE'`, item.PurchaseID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO compensation_cases(purchase_id,transaction_hash,reason,created_at) VALUES($1,$2,$3,$4) ON CONFLICT (purchase_id) DO NOTHING`, item.PurchaseID, stored.Hash, reason, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,category,occurred_at) VALUES($1,'PAYMENT_SETTLEMENT_REVERSED',$2,$3),($1,'PASS_WITHDRAWN',NULL,$3),($1,'COMPENSATION_REQUIRED',NULL,$3)`, item.PurchaseID, reason, now)
		return err
	})
}

// settle is the shared shape of every settlement write: lock the purchase,
// re-read the receipt inside the lock, hand the stored value to the caller.
//
// The locking order matters and is the same one `Confirm` uses — the purchase
// row first, then its receipt. A settlement write and a confirmation racing on
// the same purchase therefore queue rather than deadlock.
//
// A receipt that is no longer INCLUDED is not an error. It means another worker
// (or a restart's first sweep) already reached a conclusion about it, and the
// correct response is to commit having written nothing.
func (r PaymentRepository) settle(ctx context.Context, item application.DueSettlement, apply func(pgx.Tx, domain.VerifiedPayment) error) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var locked string
	if err := tx.QueryRow(ctx, `SELECT status FROM purchases WHERE id=$1 FOR UPDATE`, item.PurchaseID).Scan(&locked); err != nil {
		return notFound(err)
	}
	stored, status, err := readReceipt(ctx, tx, item.Receipt.Hash)
	if err != nil {
		return err
	}
	if status != domain.SettlementIncluded {
		return tx.Commit(ctx)
	}
	// The receipt must still be the one this work item was built from.
	// Everything economic about a transaction is committed to by its hash, so
	// a disagreement here can only come from the inclusion having been
	// re-anchored under us — in which case this decision was made against
	// stale evidence and must be re-made, not applied.
	if stored.PurchaseID != item.PurchaseID {
		return application.ErrConflict
	}
	if err := apply(tx, stored.VerifiedPayment); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type storedReceipt struct {
	domain.VerifiedPayment
	PurchaseID domain.ID
}

// readReceipt loads one receipt and its stored settlement state.
//
// The state is returned separately from the payment because it is not
// derivable from it: CONTESTED evidence looks exactly like INCLUDED evidence,
// the difference being a decision that was recorded rather than a fact about
// the transaction.
func readReceipt(ctx context.Context, tx pgx.Tx, hash string) (storedReceipt, domain.SettlementStatus, error) {
	var out storedReceipt
	var status domain.SettlementStatus
	var inclusionBlock, expectedFinality int64
	var finalityBlock *int64
	var finalizedAt *time.Time
	err := tx.QueryRow(ctx, `SELECT v.transaction_hash,v.purchase_id,v.sender_wallet,v.recipient_wallet,v.value_luna,v.network,v.inclusion_block,v.included_at,v.settlement_status,v.expected_finality_block,v.finality_block,v.finalized_at,p.payment_reference FROM verified_payments v JOIN purchases p ON p.id=v.purchase_id WHERE v.transaction_hash=$1 FOR UPDATE OF v`, hash).
		Scan(&out.Hash, &out.PurchaseID, &out.Sender, &out.Recipient, &out.AmountLuna, &out.Network,
			&inclusionBlock, &out.IncludedAt, &status, &expectedFinality, &finalityBlock, &finalizedAt, &out.Reference)
	if err != nil {
		return out, "", notFound(err)
	}
	out.Included = true
	out.InclusionBlock = uint32(inclusionBlock)
	out.FinalityBlock = uint32(expectedFinality)
	if status == domain.SettlementFinalized && finalityBlock != nil && finalizedAt != nil {
		out.Finalized = true
		out.FinalityBlock = uint32(*finalityBlock)
		out.FinalizedAt = *finalizedAt
	}
	return out, status, nil
}

// blockCategory labels a re-anchoring with where the payment moved from and to.
func blockCategory(from, to uint32) string {
	return strconv.FormatUint(uint64(from), 10) + "->" + strconv.FormatUint(uint64(to), 10)
}
