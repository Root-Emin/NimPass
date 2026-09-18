package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

// One projection of a purchased pass, used by every read of one.
//
// `effectiveStatus` is computed in SQL rather than in Go so that filtering,
// paging and display all agree on the same value: a pass whose expiry has
// passed reads EXPIRED to its owner, to its provider and to the status filter
// at the same instant, without a write having to happen first.
const purchasedPassStatusExpr = `CASE WHEN pa.status='ACTIVE' AND pa.expires_at<=now() THEN 'EXPIRED' ELSE pa.status END`

const purchasedPassFields = `pa.id,pa.purchase_id,pa.owner_wallet,pa.owner_identity_id,pa.provider_identity_id,pa.pass_id,pa.provider_id,pa.service_id,pa.pass_title_snapshot,pa.service_name_snapshot,pa.provider_name_snapshot,pa.price_luna_snapshot,pa.original_sessions,pa.used_sessions,pa.remaining_sessions,` + purchasedPassStatusExpr + `,pa.created_at,pa.expires_at,pa.completed_at,pu.network`

const purchasedPassSource = ` FROM purchased_passes pa JOIN purchases pu ON pu.id=pa.purchase_id `

func scanPurchasedPass(r row) (domain.PurchasedPass, error) {
	var p domain.PurchasedPass
	err := r.Scan(&p.ID, &p.PurchaseID, &p.OwnerWallet, &p.OwnerIdentityID, &p.ProviderIdentityID, &p.Snapshot.PassID, &p.Snapshot.ProviderID, &p.Snapshot.ServiceID, &p.Snapshot.PassTitle, &p.Snapshot.ServiceName, &p.Snapshot.ProviderName, &p.Snapshot.PriceLuna, &p.OriginalSessions, &p.UsedSessions, &p.RemainingSessions, &p.Status, &p.CreatedAt, &p.ExpiresAt, &p.CompletedAt, &p.Snapshot.Network)
	if err != nil {
		return p, notFound(err)
	}
	p.Snapshot.Sessions = domain.SessionCount(p.OriginalSessions)
	p.Snapshot.Expiration = domain.NewExpirationPolicy(p.ExpiresAt)
	return p, nil
}

// GetPassForActor reads one purchased pass for whoever is asking.
//
// Both parties see the same row: the buyer who owns it and the provider who
// has to deliver it. Anyone else gets ErrNotFound — not a filtered-out field
// and not a read-only view, because a stranger has no business learning that
// this pass exists at all (docs/09-SECURITY.md §37).
//
// The role comes back with the pass because it is the same decision: the
// caller must not re-derive "am I the provider here?" from data it was handed.
func (r PaymentRepository) GetPassForActor(ctx context.Context, passID, actorID domain.ID) (domain.PurchasedPass, domain.ViewerRole, error) {
	// Persist an expiry the reader is about to be shown, so an entitlement
	// that lapsed is not left ACTIVE in the table while every screen calls it
	// expired. Owner-only: a provider reading a customer's pass must not be
	// able to drive a write on it.
	if _, err := r.Pool.Exec(ctx, `UPDATE purchased_passes SET status='EXPIRED' WHERE id=$1 AND owner_identity_id=$2 AND status='ACTIVE' AND expires_at<=now()`, passID, actorID); err != nil {
		return domain.PurchasedPass{}, "", err
	}
	pass, err := scanPurchasedPass(r.Pool.QueryRow(ctx, `SELECT `+purchasedPassFields+purchasedPassSource+` WHERE pa.id=$1 AND (pa.owner_identity_id=$2 OR pa.provider_identity_id=$2)`, passID, actorID))
	if err != nil {
		return pass, "", err
	}
	role, ok := pass.RoleOf(actorID)
	if !ok {
		// Unreachable while the WHERE clause above holds; kept because a
		// silent role of "" would otherwise authorise nothing and explain
		// nothing.
		return domain.PurchasedPass{}, "", application.ErrNotFound
	}
	return pass, role, nil
}

// ListProviderPasses lists the passes sold from one provider's catalogue.
//
// Scoped by `provider_identity_id`, the account snapshotted onto the pass, and
// additionally by the provider record's own owner — so a provider row that
// changed hands cannot retroactively hand someone else a customer's history.
func (r PaymentRepository) ListProviderPasses(ctx context.Context, providerID, actorID domain.ID, limit int) ([]domain.PurchasedPass, error) {
	if limit < 1 || limit > 100 {
		return nil, application.ErrValidation
	}
	rows, err := r.Pool.Query(ctx, `SELECT `+purchasedPassFields+purchasedPassSource+` JOIN providers pr ON pr.id=pa.provider_id WHERE pa.provider_id=$1 AND pa.provider_identity_id=$2 AND pr.owner_identity_id=$2 ORDER BY pa.created_at DESC,pa.id DESC LIMIT $3`, providerID, actorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.PurchasedPass, 0)
	for rows.Next() {
		pass, err := scanPurchasedPass(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, pass)
	}
	return out, rows.Err()
}

const passSessionFields = `s.id,s.purchased_pass_id,s.sequence_number,s.status,s.scheduled_at,s.completed_at,s.completed_by,s.redemption_id,s.created_at,s.updated_at`

func scanPassSession(r row) (domain.PassSession, error) {
	var s domain.PassSession
	var completedBy, redemptionID *string
	if err := r.Scan(&s.ID, &s.PurchasedPassID, &s.SequenceNumber, &s.Status, &s.ScheduledAt, &s.CompletedAt, &completedBy, &redemptionID, &s.CreatedAt, &s.UpdatedAt); err != nil {
		return s, notFound(err)
	}
	if completedBy != nil {
		s.CompletedBy = domain.PassSessionActor(*completedBy)
	}
	if redemptionID != nil {
		s.RedemptionID = domain.ID(*redemptionID)
	}
	return s, nil
}

// ListPassSessions returns every session of one pass, in order, for either party.
func (r PaymentRepository) ListPassSessions(ctx context.Context, passID, actorID domain.ID) ([]domain.PassSession, error) {
	rows, err := r.Pool.Query(ctx, `SELECT `+passSessionFields+` FROM pass_sessions s JOIN purchased_passes pa ON pa.id=s.purchased_pass_id WHERE s.purchased_pass_id=$1 AND (pa.owner_identity_id=$2 OR pa.provider_identity_id=$2) ORDER BY s.sequence_number`, passID, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.PassSession, 0)
	for rows.Next() {
		session, err := scanPassSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, session)
	}
	return out, rows.Err()
}

// lockedSession loads one session and its pass for writing, with both rows
// locked and the actor's relationship to the pass established.
//
// Every session write goes through here, so authorisation and locking cannot
// drift apart: the statement that decides "may this account touch this
// session?" is the one that takes the lock the write happens under, and an
// account that is neither party matches nothing and is told the session does
// not exist.
//
// **The pass is locked first, then the session, and the order is not
// incidental.** The signed-redemption path in `AuthorizeAndConsume` locks the
// pass with its challenge and only then takes the session it is about to
// spend. Two writers taking the same two rows in opposite orders is the
// textbook deadlock, and it would surface to a customer as a 500 in the
// middle of using a session rather than as the ordinary "somebody got there
// first". Both paths therefore take pass-then-session.
func lockedSession(ctx context.Context, tx pgx.Tx, sessionID, actorID domain.ID) (domain.PassSession, domain.PurchasedPass, domain.ViewerRole, error) {
	var session domain.PassSession
	pass, err := scanPurchasedPass(tx.QueryRow(ctx, `SELECT `+purchasedPassFields+purchasedPassSource+` WHERE pa.id=(SELECT purchased_pass_id FROM pass_sessions WHERE id=$1) AND (pa.owner_identity_id=$2 OR pa.provider_identity_id=$2) FOR UPDATE OF pa`, sessionID, actorID))
	if err != nil {
		return session, pass, "", err
	}
	session, err = scanPassSession(tx.QueryRow(ctx, `SELECT `+passSessionFields+` FROM pass_sessions s WHERE s.id=$1 AND s.purchased_pass_id=$2 FOR UPDATE`, sessionID, pass.ID))
	if err != nil {
		return session, pass, "", err
	}
	role, ok := pass.RoleOf(actorID)
	if !ok {
		return session, pass, "", application.ErrNotFound
	}
	return session, pass, role, nil
}

// ScheduleSession sets or clears one session's date.
//
// Either party may do it. Scheduling is a shared arrangement — the customer
// says which evening suits them, the provider moves it when a slot changes —
// and neither side owns the calendar. It never touches the counters, because
// a date is not a delivery.
func (r PaymentRepository) ScheduleSession(ctx context.Context, sessionID, actorID domain.ID, at *time.Time, now time.Time) (domain.PassSession, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return domain.PassSession{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	session, pass, role, err := lockedSession(ctx, tx, sessionID, actorID)
	if err != nil {
		return session, err
	}
	if pass.Status != domain.PurchasedPassActive {
		return session, application.ErrConflict
	}
	if err := session.Schedule(at, now); err != nil {
		if errors.Is(err, domain.ErrSessionScheduleRange) {
			return session, application.ErrValidation
		}
		return session, application.ErrConflict
	}
	if _, err = tx.Exec(ctx, `UPDATE pass_sessions SET status=$2,scheduled_at=$3,updated_at=$4 WHERE id=$1`, session.ID, session.Status, session.ScheduledAt, session.UpdatedAt); err != nil {
		return session, err
	}
	kind := "SESSION_SCHEDULED"
	if session.Status == domain.PassSessionUnscheduled {
		kind = "SESSION_UNSCHEDULED"
	}
	if err = recordSessionEvent(ctx, tx, pass, kind, string(role), now); err != nil {
		return session, err
	}
	return session, tx.Commit(ctx)
}

// CompleteSession records one delivered session and spends it.
//
// Concurrency is handled by the database, not by the check above it. Two
// requests racing on the same session both queue on the `FOR UPDATE` in
// `lockedSession`; the loser then sees a COMPLETED row and is refused. The
// decrement is written as a conditional UPDATE guarded on
// `remaining_sessions>0` and on the session still being open, and the table's
// own CHECK constraints (`used + remaining = original`, `remaining >= 0`)
// would reject a double decrement even if both guards were wrong. Three
// independent reasons a session cannot be spent twice, and none of them is
// "the UI disables the button".
//
// `actor` is OWNER when a signed redemption spent the session and PROVIDER
// when the provider recorded delivering it. Owners reach this through the
// wallet-signature path in AuthorizeAndConsume; the direct endpoint is the
// provider's, because the provider is the party who knows a session happened.
func (r PaymentRepository) CompleteSession(ctx context.Context, sessionID, actorID domain.ID, now time.Time) (domain.PassSession, domain.PurchasedPass, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return domain.PassSession{}, domain.PurchasedPass{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	session, pass, role, err := lockedSession(ctx, tx, sessionID, actorID)
	if err != nil {
		return session, pass, err
	}
	if role != domain.ViewerProvider {
		// The owner's route to spending a session is the signed redemption,
		// which proves with a wallet signature that the person holding the
		// pass meant it (DECISIONS.md ADR-007). Letting a plain POST do the
		// same would quietly remove that proof from the product.
		return session, pass, application.ErrForbidden
	}
	if err := completeSessionTx(ctx, tx, &session, &pass, domain.PassSessionByProvider, "", now); err != nil {
		return session, pass, err
	}
	if err = recordSessionEvent(ctx, tx, pass, "SESSION_COMPLETED", string(role), now); err != nil {
		return session, pass, err
	}
	return session, pass, tx.Commit(ctx)
}

// completeSessionTx is the one place a session is spent.
//
// Shared by the provider endpoint and the signed redemption path so the
// counter and the session record can never be updated by only one of them.
// The caller has already locked both rows.
func completeSessionTx(ctx context.Context, tx pgx.Tx, session *domain.PassSession, pass *domain.PurchasedPass, by domain.PassSessionActor, redemptionID domain.ID, now time.Time) error {
	if pass.Status != domain.PurchasedPassActive {
		if pass.Status == domain.PurchasedPassCompleted {
			return application.ErrPurchasedPassCompleted
		}
		return application.ErrPurchasedPassExpired
	}
	if pass.ExpiresAt != nil && !now.Before(*pass.ExpiresAt) {
		return application.ErrPurchasedPassExpired
	}
	if !session.IsOpen() {
		return application.ErrRedemptionConsumed
	}
	if err := session.Complete(by, redemptionID, now); err != nil {
		return application.ErrConflict
	}
	if err := pass.ConsumeSession(now); err != nil {
		return application.ErrConflict
	}
	if err := completeSessionRow(ctx, tx, *session, by, redemptionID); err != nil {
		return err
	}
	return spendPassSession(ctx, tx, pass, now)
}

// completeSessionRow writes the COMPLETED transition on one session row.
//
// The WHERE clause repeats the open-status test the caller already made,
// deliberately: it is the statement-level guarantee that two writers cannot
// both complete the same session, and it holds whether or not the Go check
// above it is correct. Zero rows affected therefore means "somebody else got
// here first", which is the one honest reading of it.
func completeSessionRow(ctx context.Context, tx pgx.Tx, session domain.PassSession, by domain.PassSessionActor, redemptionID domain.ID) error {
	var redemption any
	if redemptionID != "" {
		redemption = string(redemptionID)
	}
	tag, err := tx.Exec(ctx, `UPDATE pass_sessions SET status='COMPLETED',completed_at=$2,completed_by=$3,redemption_id=$4,updated_at=$2 WHERE id=$1 AND status IN ('UNSCHEDULED','SCHEDULED')`, session.ID, session.CompletedAt, string(by), redemption)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return application.ErrRedemptionConsumed
	}
	return nil
}

// spendPassSession applies one session's worth of movement to the counter.
//
// Written as a relative, guarded decrement rather than as the absolute values
// the caller computed. Under `AND remaining_sessions>0` the statement is
// self-limiting: it can run at most `original_sessions` times over the life
// of a pass no matter how many writers attempt it, and the table's
// `used + remaining = original` and `remaining >= 0` constraints would refuse
// an over-spend even then.
func spendPassSession(ctx context.Context, tx pgx.Tx, pass *domain.PurchasedPass, now time.Time) error {
	completedAt := pass.CompletedAt
	if pass.Status == domain.PurchasedPassCompleted && completedAt == nil {
		completedAt = &now
	}
	tag, err := tx.Exec(ctx, `UPDATE purchased_passes SET used_sessions=used_sessions+1,remaining_sessions=remaining_sessions-1,status=$2,completed_at=$3 WHERE id=$1 AND status='ACTIVE' AND remaining_sessions>0`, pass.ID, pass.Status, completedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return application.ErrConflict
	}
	pass.CompletedAt = completedAt
	return nil
}

// nextOpenSession locks the session a signed redemption is about to spend.
//
// Lowest open sequence number, locked for the rest of the transaction. Two
// concurrent redemptions therefore cannot pick the same row: the second waits
// here and, once the first commits, no longer sees that row as open.
func nextOpenSession(ctx context.Context, tx pgx.Tx, passID domain.ID) (domain.PassSession, error) {
	return scanPassSession(tx.QueryRow(ctx, `SELECT `+passSessionFields+` FROM pass_sessions s WHERE s.purchased_pass_id=$1 AND s.status IN ('UNSCHEDULED','SCHEDULED') ORDER BY s.sequence_number LIMIT 1 FOR UPDATE`, passID))
}

func recordSessionEvent(ctx context.Context, tx pgx.Tx, pass domain.PurchasedPass, kind, category string, now time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO redemption_events(id,pass_id,provider_id,kind,category,occurred_at) VALUES($1,$2,$3,$4,$5,$6)`, mustNewID(), pass.ID, pass.Snapshot.ProviderID, kind, nullable(category), now)
	return err
}
