package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

type PaymentRepository struct{ Pool *pgxpool.Pool }

type PurchaseRecord = application.PurchaseRecord

func (r PaymentRepository) Due(ctx context.Context, now time.Time, limit int) ([]application.DuePurchase, error) {
	rows, err := r.Pool.Query(ctx, `SELECT p.id,p.customer_context_id,p.expected_wallet FROM purchases p JOIN payment_candidates c ON c.purchase_id=p.id WHERE p.status IN ('TRANSACTION_SUBMITTED','VERIFYING','AWAITING_FINALITY') AND c.status <> 'MISMATCH' AND (c.last_checked_at IS NULL OR c.last_checked_at < $1::timestamptz - interval '30 seconds') ORDER BY c.last_checked_at NULLS FIRST LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]application.DuePurchase, 0)
	for rows.Next() {
		var item application.DuePurchase
		if err := rows.Scan(&item.ID, &item.Customer.ID, &item.Customer.Wallet); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

const purchaseFields = `p.id,p.customer_context_id,p.expected_wallet,p.package_id,p.provider_id,p.service_id,p.package_title_snapshot,p.service_name_snapshot,p.provider_name_snapshot,p.purchased_sessions,p.expected_price_luna,p.recipient_wallet,p.network,p.expiration_at_snapshot,p.payment_reference,p.status,p.transaction_hash,p.verified_sender_wallet,p.created_at,p.expires_at,p.confirmed_at,c.transaction_hash,c.submitted_at,c.broadcast_observed_at,c.status,c.failure_category,pa.id,cc.status,cc.reason,cc.created_at`
const purchaseJoins = ` FROM purchases p LEFT JOIN payment_candidates c ON c.purchase_id=p.id LEFT JOIN passes pa ON pa.purchase_id=p.id LEFT JOIN compensation_cases cc ON cc.purchase_id=p.id `

func scanPurchase(r row) (PurchaseRecord, error) {
	var out PurchaseRecord
	p := &out.Purchase
	var wallet, txHash, sender, candidate, candidateStatus, failure, compensationStatus, compensationReason *string
	var expires, submitted, observed, compensationAt *time.Time
	var passID *string
	err := r.Scan(&p.ID, &p.CustomerContextID, &wallet, &p.Snapshot.PackageID, &p.Snapshot.ProviderID, &p.Snapshot.ServiceID, &p.Snapshot.PackageTitle, &p.Snapshot.ServiceName, &p.Snapshot.ProviderName, &p.Snapshot.Sessions, &p.Snapshot.PriceLuna, &p.Snapshot.Recipient, &p.Snapshot.Network, &expires, &p.PaymentReference, &p.Status, &txHash, &sender, &p.CreatedAt, &p.ExpiresAt, &p.ConfirmedAt, &candidate, &submitted, &observed, &candidateStatus, &failure, &passID, &compensationStatus, &compensationReason, &compensationAt)
	if err != nil {
		return out, notFound(err)
	}
	if wallet != nil {
		p.ExpectedWallet = domain.WalletAddress(*wallet)
	}
	if txHash != nil {
		p.TransactionHash = *txHash
	}
	if sender != nil {
		p.VerifiedSender = domain.WalletAddress(*sender)
	}
	p.Snapshot.Expiration = domain.NewExpirationPolicy(expires)
	if candidate != nil {
		out.CandidateHash = *candidate
	}
	if candidateStatus != nil {
		out.CandidateStatus = *candidateStatus
	}
	if failure != nil {
		out.FailureCategory = *failure
	}
	if passID != nil {
		out.PassID = domain.ID(*passID)
	}
	if compensationStatus != nil {
		out.CompensationStatus = *compensationStatus
	}
	if compensationReason != nil {
		out.CompensationReason = *compensationReason
	}
	out.CompensationAt = compensationAt
	out.SubmittedAt = submitted
	out.BroadcastObservedAt = observed
	return out, nil
}

func (r PaymentRepository) Get(ctx context.Context, id, customer domain.ID) (PurchaseRecord, error) {
	return scanPurchase(r.Pool.QueryRow(ctx, `SELECT `+purchaseFields+purchaseJoins+` WHERE p.id=$1 AND p.customer_context_id=$2`, id, customer))
}

func (r PaymentRepository) List(ctx context.Context, customer domain.ID) ([]PurchaseRecord, error) {
	rows, err := r.Pool.Query(ctx, `SELECT `+purchaseFields+purchaseJoins+` WHERE p.customer_context_id=$1 ORDER BY p.created_at DESC LIMIT 100`, customer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]PurchaseRecord, 0)
	for rows.Next() {
		p, err := scanPurchase(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Create serializes the wallet+package context, preserving intentional repeat
// purchases after a prior intent is confirmed/cancelled/expired.
func (r PaymentRepository) Create(ctx context.Context, customer domain.ID, wallet domain.WalletAddress, packageID domain.ID, network domain.NimiqNetwork, key string, now time.Time) (PurchaseRecord, bool, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return PurchaseRecord{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, string(customer)+":"+string(packageID))
	if err != nil {
		return PurchaseRecord{}, false, err
	}
	if key != "" {
		old, err := scanPurchase(tx.QueryRow(ctx, `SELECT `+purchaseFields+purchaseJoins+` WHERE p.customer_context_id=$1 AND p.idempotency_key=$2`, customer, key))
		if err == nil {
			if old.Purchase.Snapshot.PackageID != packageID {
				return PurchaseRecord{}, false, application.ErrConflict
			}
			return old, true, tx.Commit(ctx)
		}
		if !errors.Is(err, application.ErrNotFound) {
			return PurchaseRecord{}, false, err
		}
	}
	old, err := scanPurchase(tx.QueryRow(ctx, `SELECT `+purchaseFields+purchaseJoins+` WHERE p.customer_context_id=$1 AND p.package_id=$2 AND p.status IN ('CREATED','PAYMENT_PENDING') AND p.expires_at>$3 ORDER BY p.created_at DESC LIMIT 1`, customer, packageID, now))
	if err == nil {
		return old, true, tx.Commit(ctx)
	}
	if !errors.Is(err, application.ErrNotFound) {
		return PurchaseRecord{}, false, err
	}
	var pkg domain.Package
	var service domain.Service
	var provider domain.Provider
	var expires *time.Time
	var payout *string
	err = tx.QueryRow(ctx, `SELECT pk.id,pk.provider_id,pk.service_id,pk.title,pk.session_count,pk.price_luna,pk.expiration_at,pk.status,s.name,s.status,pr.name,pr.payout_wallet,pr.payout_verified_at FROM packages pk JOIN services s ON s.id=pk.service_id AND s.provider_id=pk.provider_id JOIN providers pr ON pr.id=pk.provider_id WHERE pk.id=$1 FOR SHARE OF pk,s,pr`, packageID).Scan(&pkg.ID, &pkg.ProviderID, &pkg.ServiceID, &pkg.Title, &pkg.Sessions, &pkg.PriceLuna, &expires, &pkg.Status, &service.Name, &service.Status, &provider.Name, &payout, &provider.PayoutVerifiedAt)
	if err != nil {
		return PurchaseRecord{}, false, notFound(err)
	}
	if payout != nil {
		provider.PayoutWallet = domain.WalletAddress(*payout)
	}
	provider.ID = pkg.ProviderID
	service.ID = pkg.ServiceID
	service.ProviderID = pkg.ProviderID
	pkg.Expiration = domain.NewExpirationPolicy(expires)
	if service.Status != domain.ServiceActive {
		return PurchaseRecord{}, false, application.ErrConflict
	}
	id, err := domain.NewID()
	if err != nil {
		return PurchaseRecord{}, false, err
	}
	reference, err := domain.NewPaymentReference()
	if err != nil {
		return PurchaseRecord{}, false, err
	}
	p, err := domain.NewPurchase(id, customer, wallet, pkg, service, provider, network, reference, now)
	if err != nil {
		if errors.Is(err, domain.ErrPurchaseCutoff) {
			return PurchaseRecord{}, false, application.ErrPurchaseCutoff
		}
		return PurchaseRecord{}, false, application.ErrConflict
	}
	if err = p.AwaitPayment(now); err != nil {
		return PurchaseRecord{}, false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO purchases(id,customer_context_id,expected_wallet,package_id,provider_id,service_id,package_title_snapshot,service_name_snapshot,provider_name_snapshot,purchased_sessions,expected_price_luna,recipient_wallet,network,expiration_at_snapshot,payment_reference,idempotency_key,status,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`, p.ID, p.CustomerContextID, p.ExpectedWallet, p.Snapshot.PackageID, p.Snapshot.ProviderID, p.Snapshot.ServiceID, p.Snapshot.PackageTitle, p.Snapshot.ServiceName, p.Snapshot.ProviderName, p.Snapshot.Sessions, p.Snapshot.PriceLuna, p.Snapshot.Recipient, p.Snapshot.Network, p.Snapshot.Expiration.ExpiresAt, p.PaymentReference, nullable(key), p.Status, p.CreatedAt, p.ExpiresAt)
	if err != nil {
		return PurchaseRecord{}, false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,occurred_at) VALUES($1,'INTENT_CREATED',$2)`, p.ID, now)
	if err != nil {
		return PurchaseRecord{}, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return PurchaseRecord{}, false, err
	}
	return PurchaseRecord{Purchase: p}, false, nil
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (r PaymentRepository) Submit(ctx context.Context, id, customer domain.ID, hash string, now time.Time) (PurchaseRecord, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return PurchaseRecord{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	p, err := scanPurchase(tx.QueryRow(ctx, `SELECT `+purchaseFields+purchaseJoins+` WHERE p.id=$1 AND p.customer_context_id=$2 FOR UPDATE OF p`, id, customer))
	if err != nil {
		return p, err
	}
	if p.Purchase.Status == domain.PurchaseConfirmed || p.Purchase.Status == domain.PurchaseCompensationRequired {
		if p.Purchase.TransactionHash == hash {
			return p, tx.Commit(ctx)
		}
		return p, application.ErrConflict
	}
	if p.CandidateHash != "" {
		if p.CandidateHash == hash {
			return p, tx.Commit(ctx)
		}
		return p, application.ErrConflict
	}
	if p.Purchase.Status != domain.PurchasePaymentPending || !now.Before(p.Purchase.ExpiresAt) {
		return p, application.ErrExpired
	}
	_, err = tx.Exec(ctx, `INSERT INTO payment_candidates(purchase_id,transaction_hash,submitted_at) VALUES($1,$2,$3)`, id, hash, now)
	if err != nil {
		return p, err
	}
	_, err = tx.Exec(ctx, `UPDATE purchases SET status='TRANSACTION_SUBMITTED',submitted_at=$2 WHERE id=$1`, id, now)
	if err != nil {
		return p, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,occurred_at) VALUES($1,'TRANSACTION_SUBMITTED',$2)`, id, now)
	if err != nil {
		return p, err
	}
	if err = tx.Commit(ctx); err != nil {
		return p, err
	}
	p.CandidateHash = hash
	p.SubmittedAt = &now
	p.CandidateStatus = "SUBMITTED"
	p.Purchase.Status = domain.PurchaseTransactionSubmitted
	return p, nil
}

func (r PaymentRepository) Mark(ctx context.Context, id, customer domain.ID, expectedHash, status, category string, evidence *domain.VerifiedPayment, now time.Time) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var current string
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `SELECT p.status,p.expires_at FROM purchases p JOIN payment_candidates c ON c.purchase_id=p.id WHERE p.id=$1 AND p.customer_context_id=$2 AND c.transaction_hash=$3 FOR UPDATE OF p,c`, id, customer, expectedHash).Scan(&current, &expiresAt)
	if err != nil {
		return notFound(err)
	}
	if current == "CONFIRMED" || current == "COMPENSATION_REQUIRED" {
		return tx.Commit(ctx)
	}
	var block any
	var included any
	if evidence != nil && evidence.Included {
		block = evidence.InclusionBlock
		included = evidence.IncludedAt
	}
	var observed any
	if status == "SUBMITTED" && evidence != nil && !evidence.Included && now.Before(expiresAt) {
		observed = now
	}
	_, err = tx.Exec(ctx, `UPDATE payment_candidates SET status=$2,failure_category=$3,last_checked_at=$4,inclusion_block=COALESCE($5,inclusion_block),included_at=COALESCE($6,included_at),broadcast_observed_at=COALESCE(broadcast_observed_at,$7) WHERE purchase_id=$1`, id, status, nullable(category), now, block, included, observed)
	if err != nil {
		return err
	}
	state := "VERIFYING"
	if status == "AWAITING_FINALITY" {
		state = "AWAITING_FINALITY"
	}
	if status == "MISMATCH" {
		state = "FAILED"
	}
	_, err = tx.Exec(ctx, `UPDATE purchases SET status=$2 WHERE id=$1`, id, state)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,category,occurred_at) VALUES($1,$2,$3,$4)`, id, "VERIFICATION_"+status, nullable(category), now)
	if err != nil {
		return err
	}
	if evidence != nil {
		kind := "TRANSACTION_FOUND"
		if evidence.Included {
			kind = "TRANSACTION_INCLUDED"
		}
		if _, err = tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,occurred_at) VALUES($1,$2,$3)`, id, kind, now); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// Confirm makes the verified hash claim, purchase transition and pass creation
// one atomic operation. The candidate hash has no global uniqueness constraint.
func (r PaymentRepository) Confirm(ctx context.Context, id, customer domain.ID, payment domain.VerifiedPayment, finalizedAt time.Time, now time.Time) (PurchaseRecord, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return PurchaseRecord{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	p, err := scanPurchase(tx.QueryRow(ctx, `SELECT `+purchaseFields+purchaseJoins+` WHERE p.id=$1 AND p.customer_context_id=$2 FOR UPDATE OF p`, id, customer))
	if err != nil {
		return p, err
	}
	if p.Purchase.Status == domain.PurchaseConfirmed || p.Purchase.Status == domain.PurchaseCompensationRequired {
		if p.Purchase.TransactionHash != payment.Hash {
			return p, application.ErrConflict
		}
		if p.Purchase.Status == domain.PurchaseCompensationRequired {
			if err = tx.QueryRow(ctx, `SELECT status,reason,created_at FROM compensation_cases WHERE purchase_id=$1 AND transaction_hash=$2`, id, payment.Hash).Scan(&p.CompensationStatus, &p.CompensationReason, &p.CompensationAt); err != nil {
				return p, err
			}
			return p, tx.Commit(ctx)
		}
		// Under READ COMMITTED a LEFT JOIN can retain a pre-wait view of the
		// newly inserted pass even after FOR UPDATE waited for its purchase.
		// A fresh statement after the row lock observes the committed pass.
		if err = tx.QueryRow(ctx, `SELECT id FROM passes WHERE purchase_id=$1`, id).Scan(&p.PassID); err != nil {
			return p, err
		}
		return p, tx.Commit(ctx)
	}
	if p.CandidateHash != payment.Hash || p.SubmittedAt == nil || !p.SubmittedAt.Before(p.Purchase.ExpiresAt) {
		return p, application.ErrConflict
	}
	if payment.IncludedAt.After(p.Purchase.ExpiresAt) && (p.BroadcastObservedAt == nil || !p.BroadcastObservedAt.Before(p.Purchase.ExpiresAt)) {
		return p, application.ErrConflict
	}
	compensation := p.Purchase.Snapshot.Expiration.ExpiresAt != nil && !now.Before(*p.Purchase.Snapshot.Expiration.ExpiresAt)
	if compensation {
		err = p.Purchase.ReconcileCompensationRequired(payment, now)
	} else {
		err = p.Purchase.ReconcileVerified(payment, now)
	}
	if err != nil {
		return p, application.ErrConflict
	}
	_, err = tx.Exec(ctx, `INSERT INTO verified_payments(transaction_hash,purchase_id,sender_wallet,recipient_wallet,value_luna,network,inclusion_block,included_at,finality_block,finalized_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, payment.Hash, id, payment.Sender, payment.Recipient, payment.AmountLuna, payment.Network, payment.InclusionBlock, payment.IncludedAt, payment.FinalityBlock, finalizedAt)
	if err != nil {
		return p, application.ErrConflict
	}
	if compensation {
		const reason = "PACKAGE_EXPIRED_BEFORE_ACTIVATION"
		if _, err = tx.Exec(ctx, `UPDATE purchases SET status='COMPENSATION_REQUIRED',transaction_hash=$2,verified_sender_wallet=$3,confirmed_at=$4 WHERE id=$1`, id, payment.Hash, payment.Sender, p.Purchase.ConfirmedAt); err != nil {
			return p, err
		}
		if _, err = tx.Exec(ctx, `UPDATE payment_candidates SET status='COMPENSATION_REQUIRED',last_checked_at=$2 WHERE purchase_id=$1`, id, now); err != nil {
			return p, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO compensation_cases(purchase_id,transaction_hash,reason,created_at) VALUES($1,$2,$3,$4)`, id, payment.Hash, reason, now); err != nil {
			return p, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,occurred_at) VALUES($1,'TRANSACTION_INCLUDED',$2),($1,'PAYMENT_FINALIZED',$2),($1,'COMPENSATION_REQUIRED',$2)`, id, now); err != nil {
			return p, err
		}
		if err = tx.Commit(ctx); err != nil {
			return p, err
		}
		p.CandidateStatus = "COMPENSATION_REQUIRED"
		p.CompensationStatus = "OPEN"
		p.CompensationReason = reason
		p.CompensationAt = &now
		return p, nil
	}
	passID, err := domain.NewID()
	if err != nil {
		return p, err
	}
	pass, err := domain.NewPass(passID, p.Purchase)
	if err != nil {
		return p, application.ErrConflict
	}
	_, err = tx.Exec(ctx, `UPDATE purchases SET status='CONFIRMED',transaction_hash=$2,verified_sender_wallet=$3,confirmed_at=$4 WHERE id=$1`, id, payment.Hash, payment.Sender, p.Purchase.ConfirmedAt)
	if err != nil {
		return p, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO passes(id,purchase_id,package_id,provider_id,service_id,owner_wallet,package_title_snapshot,service_name_snapshot,provider_name_snapshot,price_luna_snapshot,original_sessions,used_sessions,remaining_sessions,status,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$11,$12,$13,$14)`, pass.ID, pass.PurchaseID, pass.Snapshot.PackageID, pass.Snapshot.ProviderID, pass.Snapshot.ServiceID, pass.OwnerWallet, pass.Snapshot.PackageTitle, pass.Snapshot.ServiceName, pass.Snapshot.ProviderName, pass.Snapshot.PriceLuna, pass.OriginalSessions, pass.Status, pass.CreatedAt, pass.ExpiresAt)
	if err != nil {
		return p, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,occurred_at) VALUES($1,'TRANSACTION_INCLUDED',$2),($1,'PAYMENT_FINALIZED',$2),($1,'PURCHASE_CONFIRMED',$2),($1,'PASS_PROVISIONED',$2)`, id, now)
	if err != nil {
		return p, err
	}
	if err = tx.Commit(ctx); err != nil {
		return p, err
	}
	p.PassID = pass.ID
	p.Purchase.Status = domain.PurchaseConfirmed
	p.Purchase.TransactionHash = payment.Hash
	return p, nil
}

func (r PaymentRepository) Cancel(ctx context.Context, id, customer domain.ID, now time.Time) (PurchaseRecord, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return PurchaseRecord{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	p, err := scanPurchase(tx.QueryRow(ctx, `SELECT `+purchaseFields+purchaseJoins+` WHERE p.id=$1 AND p.customer_context_id=$2 FOR UPDATE OF p`, id, customer))
	if err != nil {
		return p, err
	}
	if p.CandidateHash != "" || p.Purchase.Status != domain.PurchasePaymentPending {
		return p, application.ErrConflict
	}
	_, err = tx.Exec(ctx, `UPDATE purchases SET status='CANCELLED' WHERE id=$1`, id)
	if err != nil {
		return p, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,occurred_at) VALUES($1,'CANCELLED',$2)`, id, now)
	if err != nil {
		return p, err
	}
	if err = tx.Commit(ctx); err != nil {
		return p, err
	}
	p.Purchase.Status = domain.PurchaseCancelled
	return p, nil
}

func (r PaymentRepository) GetPass(ctx context.Context, id, customer domain.ID) (domain.Pass, error) {
	var p domain.Pass
	err := r.Pool.QueryRow(ctx, `SELECT pa.id,pa.purchase_id,pa.owner_wallet,pa.package_id,pa.provider_id,pa.service_id,pa.package_title_snapshot,pa.service_name_snapshot,pa.provider_name_snapshot,pa.price_luna_snapshot,pa.original_sessions,pa.used_sessions,pa.remaining_sessions,pa.status,pa.created_at,pa.expires_at,pa.completed_at FROM passes pa JOIN purchases pu ON pu.id=pa.purchase_id WHERE pa.id=$1 AND pu.customer_context_id=$2 AND pa.owner_wallet=pu.expected_wallet`, id, customer).Scan(&p.ID, &p.PurchaseID, &p.OwnerWallet, &p.Snapshot.PackageID, &p.Snapshot.ProviderID, &p.Snapshot.ServiceID, &p.Snapshot.PackageTitle, &p.Snapshot.ServiceName, &p.Snapshot.ProviderName, &p.Snapshot.PriceLuna, &p.OriginalSessions, &p.UsedSessions, &p.RemainingSessions, &p.Status, &p.CreatedAt, &p.ExpiresAt, &p.CompletedAt)
	return p, notFound(err)
}
