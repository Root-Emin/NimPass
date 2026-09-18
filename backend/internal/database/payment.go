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

// Due lists the purchases whose candidate transaction is worth looking at
// again, and how soon "again" is.
//
// The re-check floor is the same rule discovery already follows (ADR-013):
// **backoff counts failures, not quiet.**
//
//	retry_count = 0   a healthy candidate — submitted, included, or waiting on
//	                  the macro block. Re-read at the reconciler's own active
//	                  tempo, because every one of those states is a state the
//	                  customer is watching a spinner through.
//	retry_count > 0   consecutive UNCERTAIN / NOT_FOUND answers, which only
//	                  `Mark` sets and only for an RPC that could not tell us
//	                  anything. That backs off 30s, 60s, … 8m as before.
//
// It used to be the first line's 30 seconds for everything. `Mark` resets
// retry_count to 0 for SUBMITTED and AWAITING_FINALITY, so a perfectly healthy
// payment still sat out a fixed 30-second floor between every step of its own
// verification — and a purchase passes through two or three of those steps
// (submitted → included → finalised) before a Pass exists. A transaction that
// was final on chain in seconds therefore took a minute or more to surface,
// while the reconciler ticking every two seconds looked at it and declined to
// act. That fixed floor, not finality, was the wait.
//
// Nothing about verification changed: the same Inspect → validateEvidence →
// finality → Confirm path runs, and asking the node sooner cannot make an
// unfinalised transaction final. The cost is bounded by the intent's own
// lifetime and by the reconciler's `busy()` tempo, which is already 2s
// whenever any intent is live.
func (r PaymentRepository) Due(ctx context.Context, now time.Time, limit int) ([]application.DuePurchase, error) {
	rows, err := r.Pool.Query(ctx, `SELECT p.id,p.customer_context_id,p.expected_wallet FROM purchases p JOIN payment_candidates c ON c.purchase_id=p.id WHERE p.status IN ('TRANSACTION_SUBMITTED','VERIFYING','AWAITING_FINALITY') AND c.status <> 'MISMATCH' AND (c.last_checked_at IS NULL OR c.last_checked_at < $1::timestamptz - CASE WHEN c.retry_count = 0 THEN interval '2 seconds' ELSE interval '30 seconds' * power(2,LEAST(c.retry_count,4)) END) ORDER BY c.last_checked_at NULLS FIRST,c.purchase_id LIMIT $2`, now, limit)
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

// DueDiscoveryAddresses lists the payout addresses that have live intents
// waiting on them, newest-unscanned first, each with its cursor.
//
// The counterpart to Due(): that one revisits purchases which already have a
// candidate hash, this one finds the purchases that will never get one from a
// client, because the payment happens in Nimiq Pay on a different device from
// the browser that is waiting (ADR-010, ADR-013).
//
// Grouped by address rather than listed per purchase, because the expensive
// operation is the address query and every intent on one address is waiting
// on the same answer. Fifty pending intents for one provider cost one scan.
//
// The rate limit is per address and counts **failures only**. An address that
// answered fine and simply had no new payment is swept again on the next tick:
// a customer who has not paid yet is the normal case, and treating it as a
// reason to look less often is what made a real payment take minutes to show
// up.
func (r PaymentRepository) DueDiscoveryAddresses(ctx context.Context, now time.Time, limit int) ([]application.DiscoveryAddress, error) {
	rows, err := r.Pool.Query(ctx, `
        WITH live AS (
            SELECT p.recipient_wallet, p.network, p.id, p.customer_context_id, p.expected_wallet
              FROM purchases p
              LEFT JOIN payment_candidates c ON c.purchase_id = p.id
             WHERE c.purchase_id IS NULL
               AND p.status = 'PAYMENT_PENDING'
               AND $1::timestamptz < p.expires_at + $3::interval
        ),
        addresses AS (
            SELECT l.recipient_wallet, l.network, cur.last_seen_hash, cur.last_scanned_at, COALESCE(cur.failures, 0) AS failures
              FROM (SELECT DISTINCT recipient_wallet, network FROM live) l
              LEFT JOIN payment_discovery_cursors cur
                     ON cur.recipient_wallet = l.recipient_wallet AND cur.network = l.network
             WHERE cur.last_scanned_at IS NULL
                OR COALESCE(cur.failures, 0) = 0
                OR cur.last_scanned_at < $1::timestamptz - (interval '10 seconds' * power(2, LEAST(cur.failures, 5)))
             ORDER BY cur.last_scanned_at NULLS FIRST, l.recipient_wallet
             LIMIT $2
        )
        SELECT a.recipient_wallet, a.network, a.last_seen_hash, l.id, l.customer_context_id, l.expected_wallet
          FROM addresses a
          JOIN live l ON l.recipient_wallet = a.recipient_wallet AND l.network = a.network
         ORDER BY a.recipient_wallet, l.id`, now, limit, domain.PurchaseSettlementGrace)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]application.DiscoveryAddress, 0)
	for rows.Next() {
		var recipient, network string
		var cursor, wallet *string
		var intent application.PendingIntent
		if err := rows.Scan(&recipient, &network, &cursor, &intent.PurchaseID, &intent.Customer.ID, &wallet); err != nil {
			return nil, err
		}
		if wallet != nil {
			intent.Customer.Wallet = *wallet
		}
		last := len(out) - 1
		if last < 0 || string(out[last].Recipient) != recipient || string(out[last].Network) != network {
			target := application.DiscoveryAddress{Recipient: domain.WalletAddress(recipient), Network: domain.NimiqNetwork(network)}
			if cursor != nil {
				target.Cursor = *cursor
			}
			out = append(out, target)
			last = len(out) - 1
		}
		out[last].Purchases = append(out[last].Purchases, intent)
	}
	return out, rows.Err()
}

// NoteDiscoveryScan records a successful look and advances the cursor.
//
// `head` is the newest hash the address actually returned; an empty one — an
// address with no transactions at all — leaves the cursor untouched rather
// than clearing it.
func (r PaymentRepository) NoteDiscoveryScan(ctx context.Context, recipient domain.WalletAddress, network domain.NimiqNetwork, head string, now time.Time) error {
	_, err := r.Pool.Exec(ctx, `
        INSERT INTO payment_discovery_cursors(recipient_wallet,network,last_seen_hash,last_scanned_at,failures,updated_at)
        VALUES($1,$2,nullif($3,''),$4,0,$4)
        ON CONFLICT (recipient_wallet,network) DO UPDATE
           SET last_seen_hash = COALESCE(nullif($3,''), payment_discovery_cursors.last_seen_hash),
               last_scanned_at = $4,
               failures = 0,
               updated_at = $4`, recipient, network, head, now)
	return err
}

// NoteDiscoveryFailure backs one address off after an unreachable or throttled
// endpoint. The cursor is left where it was: we did not look, so we know
// nothing new.
func (r PaymentRepository) NoteDiscoveryFailure(ctx context.Context, recipient domain.WalletAddress, network domain.NimiqNetwork, now time.Time) error {
	_, err := r.Pool.Exec(ctx, `
        INSERT INTO payment_discovery_cursors(recipient_wallet,network,last_scanned_at,failures,updated_at)
        VALUES($1,$2,$3,1,$3)
        ON CONFLICT (recipient_wallet,network) DO UPDATE
           SET last_scanned_at = $3,
               failures = LEAST(payment_discovery_cursors.failures + 1, 5),
               updated_at = $3`, recipient, network, now)
	return err
}

// HasLiveIntents answers the reconciler's "should I hurry?" question.
//
// True while any purchase is still waiting on a payment or on the chain, which
// is exactly when a customer may be watching a screen.
func (r PaymentRepository) HasLiveIntents(ctx context.Context, now time.Time) (bool, error) {
	var live bool
	// A provisional receipt counts as live work even though no customer is
	// watching it. Under the inclusion policy the macro block it is waiting for
	// is usually seconds away, and the window between "Pass issued" and
	// "payment irreversible" is the one interval in the system worth keeping
	// short for its own sake — it is how long a reorg could go unnoticed.
	// Dropping to the idle tempo there would add half a minute to it to save
	// one query.
	err := r.Pool.QueryRow(ctx, `
        SELECT EXISTS (
            SELECT 1 FROM purchases
             WHERE status IN ('PAYMENT_PENDING','TRANSACTION_SUBMITTED','VERIFYING','AWAITING_FINALITY')
               AND $1::timestamptz < expires_at + $2::interval
        ) OR EXISTS (
            SELECT 1 FROM verified_payments WHERE settlement_status='INCLUDED'
        )`, now, domain.PurchaseSettlementGrace).Scan(&live)
	return live, err
}

// Discover adopts a server-found transaction hash as this purchase's candidate.
//
// It writes exactly what Submit writes, through the same row lock and the same
// conflict rules, with two differences that matter:
//
//   - `origin='DISCOVERY'`, so the audit trail never claims a client reported a
//     hash the server found for itself, and so the partial unique index can
//     stop two concurrent sweeps adopting one transaction for two purchases.
//   - the hash is checked against every other purchase's candidate and against
//     verified_payments before it is taken, so a transaction already spoken for
//     cannot be pulled into a second purchase even before settlement.
//
// `submitted_at` is the discovery moment, truthfully: the verifier requires a
// submission time inside the intent's lifetime, and inventing an earlier one
// would be forging the evidence it checks.
func (r PaymentRepository) Discover(ctx context.Context, id, customer domain.ID, hash string, now time.Time) (PurchaseRecord, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return PurchaseRecord{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	p, err := scanPurchase(tx.QueryRow(ctx, `SELECT `+purchaseFields+purchaseJoins+` WHERE p.id=$1 AND p.customer_context_id=$2 FOR UPDATE OF p`, id, customer))
	if err != nil {
		return p, err
	}
	if p.CandidateHash != "" {
		if p.CandidateHash == hash {
			return p, tx.Commit(ctx)
		}
		return p, application.ErrConflict
	}
	if p.Purchase.Status != domain.PurchasePaymentPending || !now.Before(p.Purchase.ExpiresAt.Add(domain.PurchaseSettlementGrace)) {
		return p, application.ErrConflict
	}
	var claimed int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM (SELECT purchase_id FROM payment_candidates WHERE transaction_hash=$1 AND purchase_id<>$2 UNION ALL SELECT purchase_id FROM verified_payments WHERE transaction_hash=$1 AND purchase_id<>$2) claims`, hash, id).Scan(&claimed); err != nil {
		return p, err
	}
	if claimed > 0 {
		return p, application.ErrConflict
	}
	if _, err = tx.Exec(ctx, `INSERT INTO payment_candidates(purchase_id,transaction_hash,submitted_at,origin) VALUES($1,$2,$3,'DISCOVERY')`, id, hash, now); err != nil {
		return p, application.ErrConflict
	}
	if _, err = tx.Exec(ctx, `UPDATE purchases SET status='TRANSACTION_SUBMITTED',submitted_at=$2 WHERE id=$1`, id, now); err != nil {
		return p, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,occurred_at) VALUES($1,'TRANSACTION_DISCOVERED',$2)`, id, now); err != nil {
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

const purchaseFields = `p.id,p.customer_context_id,p.expected_wallet,p.pass_id,p.provider_id,p.service_id,p.pass_title_snapshot,p.service_name_snapshot,p.provider_name_snapshot,p.purchased_sessions,p.expected_price_luna,p.recipient_wallet,p.network,p.expiration_at_snapshot,p.payment_reference,p.status,p.transaction_hash,p.verified_sender_wallet,p.created_at,p.expires_at,p.confirmed_at,c.transaction_hash,c.submitted_at,c.broadcast_observed_at,c.status,c.failure_category,pa.id,cc.status,cc.reason,cc.created_at,(p.wallet_attempt_id IS NOT NULL),v.transaction_hash,v.settlement_status,v.inclusion_block,v.included_at,v.expected_finality_block,v.finality_block,v.finalized_at,v.contested_at,v.contest_reason`

// The receipt joins the projection because "how permanent is this payment?" is
// now a different question from "did this purchase complete?", and every
// caller that reads one wants the other beside it. One-to-one by construction:
// `verified_payments.purchase_id` is UNIQUE.
const purchaseJoins = ` FROM purchases p LEFT JOIN payment_candidates c ON c.purchase_id=p.id LEFT JOIN purchased_passes pa ON pa.purchase_id=p.id LEFT JOIN compensation_cases cc ON cc.purchase_id=p.id LEFT JOIN verified_payments v ON v.purchase_id=p.id `

func scanPurchase(r row) (PurchaseRecord, error) {
	var out PurchaseRecord
	p := &out.Purchase
	var wallet, txHash, sender, candidate, candidateStatus, failure, compensationStatus, compensationReason *string
	var expires, submitted, observed, compensationAt *time.Time
	var passID *string
	var receiptHash, settlementStatus, contestReason *string
	var inclusionBlock, expectedFinalityBlock, finalityBlock *int64
	var includedAt, finalizedAt, contestedAt *time.Time
	err := r.Scan(&p.ID, &p.CustomerContextID, &wallet, &p.Snapshot.PassID, &p.Snapshot.ProviderID, &p.Snapshot.ServiceID, &p.Snapshot.PassTitle, &p.Snapshot.ServiceName, &p.Snapshot.ProviderName, &p.Snapshot.Sessions, &p.Snapshot.PriceLuna, &p.Snapshot.Recipient, &p.Snapshot.Network, &expires, &p.PaymentReference, &p.Status, &txHash, &sender, &p.CreatedAt, &p.ExpiresAt, &p.ConfirmedAt, &candidate, &submitted, &observed, &candidateStatus, &failure, &passID, &compensationStatus, &compensationReason, &compensationAt, &out.WalletAttemptPending, &receiptHash, &settlementStatus, &inclusionBlock, &includedAt, &expectedFinalityBlock, &finalityBlock, &finalizedAt, &contestedAt, &contestReason)
	if err != nil {
		return out, notFound(err)
	}
	if receiptHash != nil && settlementStatus != nil && inclusionBlock != nil && includedAt != nil && expectedFinalityBlock != nil {
		settlement := application.Settlement{
			Status:                domain.SettlementStatus(*settlementStatus),
			Hash:                  *receiptHash,
			InclusionBlock:        uint32(*inclusionBlock),
			IncludedAt:            *includedAt,
			ExpectedFinalityBlock: uint32(*expectedFinalityBlock),
			FinalizedAt:           finalizedAt,
			ContestedAt:           contestedAt,
		}
		if finalityBlock != nil {
			settlement.FinalityBlock = uint32(*finalityBlock)
		}
		if contestReason != nil {
			settlement.ContestReason = *contestReason
		}
		out.Settlement = &settlement
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

// Create serializes the wallet+pass context, preserving intentional repeat
// purchases after a prior intent is confirmed/cancelled/expired.
func (r PaymentRepository) Create(ctx context.Context, customer domain.ID, wallet domain.WalletAddress, passID domain.ID, network domain.NimiqNetwork, key string, now time.Time) (PurchaseRecord, bool, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return PurchaseRecord{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, string(customer)+":"+string(passID))
	if err != nil {
		return PurchaseRecord{}, false, err
	}
	if key != "" {
		old, err := scanPurchase(tx.QueryRow(ctx, `SELECT `+purchaseFields+purchaseJoins+` WHERE p.customer_context_id=$1 AND p.idempotency_key=$2`, customer, key))
		if err == nil {
			if old.Purchase.Snapshot.PassID != passID {
				return PurchaseRecord{}, false, application.ErrConflict
			}
			return old, true, tx.Commit(ctx)
		}
		if !errors.Is(err, application.ErrNotFound) {
			return PurchaseRecord{}, false, err
		}
	}
	old, err := scanPurchase(tx.QueryRow(ctx, `SELECT `+purchaseFields+purchaseJoins+` WHERE p.customer_context_id=$1 AND p.pass_id=$2 AND ((p.status IN ('CREATED','PAYMENT_PENDING') AND (p.expires_at>$3 OR p.wallet_attempt_id IS NOT NULL)) OR p.status IN ('TRANSACTION_SUBMITTED','VERIFYING','AWAITING_FINALITY')) ORDER BY p.created_at DESC LIMIT 1`, customer, passID, now))
	if err == nil {
		return old, true, tx.Commit(ctx)
	}
	if !errors.Is(err, application.ErrNotFound) {
		return PurchaseRecord{}, false, err
	}
	// The tail of the same question: an intent too old to be handed back, and
	// too young to be harmless.
	//
	// The branch above reuses an intent while the customer can still pay it.
	// This one catches the window after that and before the intent stops being
	// *settleable* — `Submit`, `DueDiscoveryAddresses` and `validateEvidence`
	// all keep working until `expires_at + PurchaseSettlementGrace`, so a QR
	// payment made just before the TTL ran out can still arrive here. Issuing a
	// second intent in that window is how one customer ends up paying twice for
	// one Pass.
	//
	// Asked before the Pass row is read, with the reuse branches it belongs to:
	// the contract already answers a live intent without re-testing the Pass
	// (a withdrawal does not cancel a payment somebody has already made), and
	// this is the same intent a few minutes later.
	var settling bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM purchases WHERE customer_context_id=$1 AND pass_id=$2 AND status IN ('CREATED','PAYMENT_PENDING') AND $3 >= expires_at AND $3 < expires_at + $4::interval)`, customer, passID, now, domain.PurchaseSettlementGrace).Scan(&settling); err != nil {
		return PurchaseRecord{}, false, err
	}
	if settling {
		return PurchaseRecord{}, false, application.ErrPurchaseInSettlement
	}
	var catalogPass domain.Pass
	var service domain.Service
	var provider domain.Provider
	var expires *time.Time
	var payout *string
	err = tx.QueryRow(ctx, `SELECT pk.id,pk.provider_id,pk.service_id,pk.title,pk.session_count,pk.price_luna,pk.expiration_at,pk.status,s.name,s.status,pr.name,pr.payout_wallet,pr.payout_verified_at,pr.owner_identity_id FROM passes pk JOIN services s ON s.id=pk.service_id AND s.provider_id=pk.provider_id JOIN providers pr ON pr.id=pk.provider_id WHERE pk.id=$1 FOR SHARE OF pk,s,pr`, passID).Scan(&catalogPass.ID, &catalogPass.ProviderID, &catalogPass.ServiceID, &catalogPass.Title, &catalogPass.Sessions, &catalogPass.PriceLuna, &expires, &catalogPass.Status, &service.Name, &service.Status, &provider.Name, &payout, &provider.PayoutVerifiedAt, &provider.OwnerIdentityID)
	if err != nil {
		return PurchaseRecord{}, false, notFound(err)
	}
	// A provider cannot buy their own pass. This is the authoritative check:
	// the owning account is read here, from the provider row, under the same
	// FOR SHARE lock that produced the price and the payout wallet. The
	// browser hides the Buy button for the same reason, but hiding a button
	// is not a rule — this is (docs/09-SECURITY.md §11, §37).
	//
	// Placed before the intent is written rather than at settlement, because
	// refusing after a payment would mean taking money for a pass that can
	// never issue.
	if provider.OwnerIdentityID == customer {
		return PurchaseRecord{}, false, application.ErrSelfPurchase
	}
	if payout != nil {
		provider.PayoutWallet = domain.WalletAddress(*payout)
	}
	// The same refusal asked of the wallets rather than the accounts.
	//
	// The account check above answers "is this the provider's own account?".
	// It cannot answer "would this customer be paying themselves?", because a
	// payout wallet is not required to be the owner's login wallet — the
	// VERIFY_PROVIDER_WALLET ceremony exists to point it somewhere else
	// (migration 000018). Where the payee is the buyer's own address the
	// payment is a self-transfer: nothing moves, the fee is the only cost, and
	// a Pass would issue against it.
	//
	// Read from the provider row under the same FOR SHARE lock as the price,
	// and compared against the address the session proved, never one the
	// client sent. `domain.NewPurchase` refuses the same pair independently.
	if buyer, err := domain.NewWalletAddress(string(wallet)); err == nil && provider.PayoutWallet != "" {
		if payee, err := domain.NewWalletAddress(string(provider.PayoutWallet)); err == nil && payee == buyer {
			return PurchaseRecord{}, false, application.ErrSelfPurchase
		}
	}
	provider.ID = catalogPass.ProviderID
	service.ID = catalogPass.ServiceID
	service.ProviderID = catalogPass.ProviderID
	catalogPass.Expiration = domain.NewExpirationPolicy(expires)
	// Is this Pass on sale *right now*? Read from the row under the same
	// FOR SHARE lock as the price and the payout wallet, so a withdrawal that
	// lands between a customer's page load and their tap is caught here rather
	// than honoured (docs/08-ARCHITECTURE.md §34, §136).
	//
	// `domain.NewPurchase` would refuse this too — `CanPurchase` requires ACTIVE
	// — but only as an unnamed conflict. Saying it here is what lets the
	// customer be told the pass is gone instead of being shown a payment error
	// for a payment that never started. An inactive service is the same fact
	// from the buyer's side: there is nothing to buy.
	if catalogPass.Status != domain.PassActive || service.Status != domain.ServiceActive {
		return PurchaseRecord{}, false, application.ErrPassUnavailable
	}
	// Does this customer already hold this Pass?
	//
	// Last of the refusals, and deliberately so. Everything above is a fact
	// about the pass or the accounts — withdrawn, self-bought, past its
	// cutoff — and stays the answer it always was; this one is a fact about
	// this customer's own shelf, and it would be a poor answer to give
	// somebody whose real problem is that the pass is gone.
	//
	// It can only ever refuse a *second* entitlement: an idempotent retry and
	// a payment already in flight both return their own intent further up and
	// never reach this line, so nothing about `38. Duplicate Purchase
	// Protection` changes.
	//
	// The conditions are the definition of "still holding it" rather than a
	// status test. `status='ACTIVE'` alone is not enough, because expiry is
	// applied lazily — a pass whose date has passed keeps its ACTIVE row until
	// something reads it — so the date is checked here too. A completed,
	// expired or cancelled pass leaves the customer free to buy again on
	// current terms, which is `Buy Again` and is unchanged
	// (`01-PRODUCT.md §56`, `02-USER-FLOWS.md §70`).
	//
	// The advisory lock at the top of this transaction is on customer+pass, so
	// two taps cannot both get past it.
	var owned bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM purchased_passes WHERE owner_identity_id=$1 AND pass_id=$2 AND status='ACTIVE' AND remaining_sessions>0 AND (expires_at IS NULL OR expires_at>$3))`, customer, passID, now).Scan(&owned); err != nil {
		return PurchaseRecord{}, false, err
	}
	if owned {
		return PurchaseRecord{}, false, application.ErrPassAlreadyOwned
	}
	id, err := domain.NewID()
	if err != nil {
		return PurchaseRecord{}, false, err
	}
	reference, err := domain.NewPaymentReference()
	if err != nil {
		return PurchaseRecord{}, false, err
	}
	p, err := domain.NewPurchase(id, customer, wallet, catalogPass, service, provider, network, reference, now)
	if err != nil {
		if errors.Is(err, domain.ErrPurchaseCutoff) {
			return PurchaseRecord{}, false, application.ErrPurchaseCutoff
		}
		// The invariant restating the check above. Reaching it means the two
		// addresses agreed after normalization in a way the comparison above
		// did not catch; it is still the same refusal and is answered as such
		// rather than as an unnamed conflict.
		if errors.Is(err, domain.ErrSelfPurchase) {
			return PurchaseRecord{}, false, application.ErrSelfPurchase
		}
		return PurchaseRecord{}, false, application.ErrConflict
	}
	if err = p.AwaitPayment(now); err != nil {
		return PurchaseRecord{}, false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO purchases(id,customer_context_id,expected_wallet,pass_id,provider_id,service_id,pass_title_snapshot,service_name_snapshot,provider_name_snapshot,purchased_sessions,expected_price_luna,recipient_wallet,network,expiration_at_snapshot,payment_reference,idempotency_key,status,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`, p.ID, p.CustomerContextID, p.ExpectedWallet, p.Snapshot.PassID, p.Snapshot.ProviderID, p.Snapshot.ServiceID, p.Snapshot.PassTitle, p.Snapshot.ServiceName, p.Snapshot.ProviderName, p.Snapshot.Sessions, p.Snapshot.PriceLuna, p.Snapshot.Recipient, p.Snapshot.Network, p.Snapshot.Expiration.ExpiresAt, p.PaymentReference, nullable(key), p.Status, p.CreatedAt, p.ExpiresAt)
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
	// A hash may be reported until the settlement grace runs out, not only
	// until the intent expires.
	//
	// The customer who paid by QR and came back to the tab two minutes late is
	// the case this exists for: their payment is on chain, inside the intent's
	// window, and refusing the report would leave them holding a receipt for a
	// pass the system decided never to issue. The verifier still decides
	// whether the transaction settles anything; this only decides whether we
	// are willing to go and look.
	if p.Purchase.Status != domain.PurchasePaymentPending || !now.Before(p.Purchase.ExpiresAt.Add(domain.PurchaseSettlementGrace)) {
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
	_, err = tx.Exec(ctx, `UPDATE payment_candidates SET status=$2,failure_category=$3,last_checked_at=$4,retry_count=CASE WHEN $2::varchar IN ('UNCERTAIN','NOT_FOUND') THEN LEAST(retry_count+1,4) ELSE 0 END,inclusion_block=COALESCE($5,inclusion_block),included_at=COALESCE($6,included_at),broadcast_observed_at=COALESCE(broadcast_observed_at,$7) WHERE purchase_id=$1`, id, status, nullable(category), now, block, included, observed)
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
//
// `policy` is the configured settlement rule, passed in rather than inferred.
// The domain re-checks the evidence against it here, one statement before the
// writes, so the rule is enforced at the boundary that actually creates
// economic state and not only in the reconciler that decided to call this.
// Inferring it from the evidence instead — "unfinalised, so this must be an
// inclusion deployment" — would make the second check agree with the first by
// construction, which is no check at all.
func (r PaymentRepository) Confirm(ctx context.Context, id, customer domain.ID, payment domain.VerifiedPayment, policy domain.ConfirmationPolicy, now time.Time) (PurchaseRecord, error) {
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
		if err = tx.QueryRow(ctx, `SELECT id FROM purchased_passes WHERE purchase_id=$1`, id).Scan(&p.PassID); err != nil {
			return p, err
		}
		return p, tx.Commit(ctx)
	}
	// Same widening as validateEvidence, and it has to be the same: a
	// settlement the verifier accepts must not be refused one statement later
	// by a stricter copy of the same rule.
	if p.CandidateHash != payment.Hash || p.SubmittedAt == nil || !p.SubmittedAt.Before(p.Purchase.ExpiresAt.Add(domain.PurchaseSettlementGrace)) {
		return p, application.ErrConflict
	}
	if payment.IncludedAt.After(p.Purchase.ExpiresAt) && (p.BroadcastObservedAt == nil || !p.BroadcastObservedAt.Before(p.Purchase.ExpiresAt)) {
		return p, application.ErrConflict
	}
	compensation := p.Purchase.Snapshot.Expiration.ExpiresAt != nil && !now.Before(*p.Purchase.Snapshot.Expiration.ExpiresAt)
	if compensation {
		err = p.Purchase.ReconcileCompensationRequired(payment, policy, now)
	} else {
		err = p.Purchase.ReconcileVerified(payment, policy, now)
	}
	if err != nil {
		return p, application.ErrConflict
	}
	// The receipt records what the chain has actually granted, which under the
	// inclusion policy is less than finality — so the finality columns go in
	// NULL and the row says INCLUDED. The expected macro height is stored
	// beside them because it is the question the finality worker will ask, and
	// it is knowable now: macro blocks sit at fixed multiples of the batch
	// length. It is never read as a settlement; the schema's own constraint
	// forbids a non-FINALIZED row from carrying `finality_block` at all.
	settlement := payment.Settlement()
	var finalityBlock, finalizedAt any
	if settlement == domain.SettlementFinalized {
		finalityBlock = payment.FinalityBlock
		finalizedAt = payment.FinalizedAt
	}
	_, err = tx.Exec(ctx, `INSERT INTO verified_payments(transaction_hash,purchase_id,sender_wallet,recipient_wallet,value_luna,network,inclusion_block,included_at,settlement_status,expected_finality_block,finality_block,finalized_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, payment.Hash, id, payment.Sender, payment.Recipient, payment.AmountLuna, payment.Network, payment.InclusionBlock, payment.IncludedAt, settlement, payment.FinalityBlock, finalityBlock, finalizedAt)
	if err != nil {
		// The primary key on transaction_hash is what makes one transaction
		// fund one purchase, whichever path got here first.
		return p, application.ErrConflict
	}
	// PAYMENT_FINALIZED is only written when finality actually happened. Under
	// the inclusion policy the audit trail says PAYMENT_PROVISIONAL here and
	// gains PAYMENT_FINALIZED later, from the worker that observed the macro
	// block — so the event log never claims a certainty the chain had not
	// granted at the time the Pass was issued.
	settlementEvent := "PAYMENT_PROVISIONAL"
	if settlement == domain.SettlementFinalized {
		settlementEvent = "PAYMENT_FINALIZED"
	}
	if compensation {
		const reason = "PASS_EXPIRED_BEFORE_ACTIVATION"
		if _, err = tx.Exec(ctx, `UPDATE purchases SET status='COMPENSATION_REQUIRED',transaction_hash=$2,verified_sender_wallet=$3,confirmed_at=$4 WHERE id=$1`, id, payment.Hash, payment.Sender, p.Purchase.ConfirmedAt); err != nil {
			return p, err
		}
		if _, err = tx.Exec(ctx, `UPDATE payment_candidates SET status='COMPENSATION_REQUIRED',last_checked_at=$2 WHERE purchase_id=$1`, id, now); err != nil {
			return p, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO compensation_cases(purchase_id,transaction_hash,reason,created_at) VALUES($1,$2,$3,$4)`, id, payment.Hash, reason, now); err != nil {
			return p, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,occurred_at) VALUES($1,'TRANSACTION_INCLUDED',$2),($1,$3,$2),($1,'COMPENSATION_REQUIRED',$2)`, id, now, settlementEvent); err != nil {
			return p, err
		}
		if err = tx.Commit(ctx); err != nil {
			return p, err
		}
		p.CandidateStatus = "COMPENSATION_REQUIRED"
		p.CompensationStatus = "OPEN"
		p.CompensationReason = reason
		p.CompensationAt = &now
		p.Settlement = &application.Settlement{
			Status: settlement, Hash: payment.Hash,
			InclusionBlock: payment.InclusionBlock, IncludedAt: payment.IncludedAt,
			ExpectedFinalityBlock: payment.FinalityBlock,
		}
		if settlement == domain.SettlementFinalized {
			p.Settlement.FinalityBlock = payment.FinalityBlock
			finalized := payment.FinalizedAt
			p.Settlement.FinalizedAt = &finalized
		}
		return p, nil
	}
	passID, err := domain.NewID()
	if err != nil {
		return p, err
	}
	// The provider account, read here rather than carried on the intent: the
	// purchase snapshot froze the provider *record*, and the pass needs the
	// identity behind it so session authorisation never has to re-resolve a
	// row the provider can edit.
	var providerIdentityID domain.ID
	if err = tx.QueryRow(ctx, `SELECT owner_identity_id FROM providers WHERE id=$1`, p.Purchase.Snapshot.ProviderID).Scan(&providerIdentityID); err != nil {
		return p, notFound(err)
	}
	pass, err := domain.NewPurchasedPass(passID, p.Purchase, providerIdentityID)
	if err != nil {
		// Includes the self-purchase invariant. Reaching it here would mean an
		// intent was created before the provider's owner changed, so the
		// payment is left verified and unissued rather than silently owned by
		// its own provider.
		return p, application.ErrConflict
	}
	_, err = tx.Exec(ctx, `UPDATE purchases SET status='CONFIRMED',transaction_hash=$2,verified_sender_wallet=$3,confirmed_at=$4 WHERE id=$1`, id, payment.Hash, payment.Sender, p.Purchase.ConfirmedAt)
	if err != nil {
		return p, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO purchased_passes(id,purchase_id,pass_id,provider_id,service_id,owner_wallet,owner_identity_id,provider_identity_id,pass_title_snapshot,service_name_snapshot,provider_name_snapshot,price_luna_snapshot,original_sessions,used_sessions,remaining_sessions,status,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$13,$14,$15,$16)`, pass.ID, pass.PurchaseID, pass.Snapshot.PassID, pass.Snapshot.ProviderID, pass.Snapshot.ServiceID, pass.OwnerWallet, pass.OwnerIdentityID, pass.ProviderIdentityID, pass.Snapshot.PassTitle, pass.Snapshot.ServiceName, pass.Snapshot.ProviderName, pass.Snapshot.PriceLuna, pass.OriginalSessions, pass.Status, pass.CreatedAt, pass.ExpiresAt)
	if err != nil {
		return p, err
	}
	// The sessions the customer paid for, all of them, in the same
	// transaction as the pass. A pass therefore never exists with a partial
	// session set, and nothing later has to decide how many sessions it
	// "should" have had.
	sessions, err := domain.NewPassSessions(pass.ID, pass.OriginalSessions, pass.CreatedAt, domain.NewID)
	if err != nil {
		return p, err
	}
	// One statement, not one per session.
	//
	// This used to be a loop of single-row INSERTs inside the transaction that
	// issues the Pass, which made settlement cost a round trip per session:
	// measured at roughly a second per twenty thousand rows, all of it holding
	// the pass and purchase locks, and all of it inside `ReconcileDue`'s
	// eight-second budget. `MaxSessionsPerPass` now caps the count at 500, so
	// the loop could no longer be a denial of service — but the cap is what
	// bounds the damage, and this is what makes the work proportionate to it.
	//
	// The ids and sequence numbers travel as two parallel arrays and are zipped
	// by `unnest`, so the parameter count is fixed at five whatever the session
	// count is. Everything else is identical for every row and is sent once.
	ids := make([]string, 0, len(sessions))
	ordinals := make([]int32, 0, len(sessions))
	for _, session := range sessions {
		ids = append(ids, string(session.ID))
		ordinals = append(ordinals, session.SequenceNumber)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO pass_sessions(id,purchased_pass_id,sequence_number,status,created_at,updated_at)
        SELECT t.id, $2, t.ordinal, $3, $4, $4 FROM unnest($1::uuid[], $5::int[]) AS t(id, ordinal)`,
		ids, pass.ID, domain.PassSessionUnscheduled, pass.CreatedAt, ordinals); err != nil {
		return p, err
	}
	// The candidate reaches a terminal state of its own. It used to be left at
	// AWAITING_FINALITY on a purchase that had already confirmed, which both
	// read as "still waiting" and kept the row in `Due`'s work list forever.
	if _, err = tx.Exec(ctx, `UPDATE payment_candidates SET status='CONFIRMED',last_checked_at=$2,retry_count=0 WHERE purchase_id=$1`, id, now); err != nil {
		return p, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO purchase_events(purchase_id,kind,occurred_at) VALUES($1,'TRANSACTION_INCLUDED',$2),($1,$3,$2),($1,'PURCHASE_CONFIRMED',$2),($1,'PASS_PROVISIONED',$2)`, id, now, settlementEvent)
	if err != nil {
		return p, err
	}
	if err = tx.Commit(ctx); err != nil {
		return p, err
	}
	p.PassID = pass.ID
	p.Purchase.Status = domain.PurchaseConfirmed
	p.Purchase.TransactionHash = payment.Hash
	p.CandidateStatus = "CONFIRMED"
	p.Settlement = &application.Settlement{
		Status:                settlement,
		Hash:                  payment.Hash,
		InclusionBlock:        payment.InclusionBlock,
		IncludedAt:            payment.IncludedAt,
		ExpectedFinalityBlock: payment.FinalityBlock,
	}
	if settlement == domain.SettlementFinalized {
		p.Settlement.FinalityBlock = payment.FinalityBlock
		finalized := payment.FinalizedAt
		p.Settlement.FinalizedAt = &finalized
	}
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
	if p.WalletAttemptPending || p.CandidateHash != "" || p.Purchase.Status != domain.PurchasePaymentPending {
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

// GetPass reads one pass the authenticated customer owns.
//
// Ownership is now the pass's own `owner_identity_id` rather than a join back
// through the purchase. Same answer, one less way to be wrong: the previous
// query also required `pa.owner_wallet=pu.expected_wallet`, which silently
// hid a pass from its buyer if either value was ever corrected.
func (r PaymentRepository) GetPass(ctx context.Context, id, customer domain.ID) (domain.PurchasedPass, error) {
	// Expiration is enforced during redemption as well; persist the visible Pass
	// state when its owner reads it so an expired entitlement is not shown ACTIVE.
	if _, err := r.Pool.Exec(ctx, `UPDATE purchased_passes SET status='EXPIRED' WHERE id=$1 AND owner_identity_id=$2 AND status='ACTIVE' AND expires_at<=now()`, id, customer); err != nil {
		return domain.PurchasedPass{}, err
	}
	return scanPurchasedPass(r.Pool.QueryRow(ctx, `SELECT `+purchasedPassFields+purchasedPassSource+` WHERE pa.id=$1 AND pa.owner_identity_id=$2`, id, customer))
}
