package database

import (
	"context"
	"testing"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

/*
What the record says after a provider marks a session delivered.

ADR-012 gives the provider that power on their own — the owner's route is the
wallet signature, the provider's is this endpoint, and there is no customer
confirmation in between. That is a deliberate product decision and this test
does not argue with it. What it does is pin down the audit trail it leaves,
because a unilateral write is exactly the kind whose record has to be complete:
who, which session, when, and by what route.

Recorded, and asserted below:

  - `pass_sessions`: which session, its sequence number, COMPLETED, the
    timestamp, `completed_by='PROVIDER'`, and `redemption_id` NULL — the
    absence of a signature is itself the fact that distinguishes this from an
    owner-signed redemption.
  - `purchased_passes.provider_identity_id`: the account that was allowed to
    do it, snapshotted at purchase. Only this identity passes the role check in
    `CompleteSession`, so it is the acting account.
  - `redemption_events`: a SESSION_COMPLETED row carrying the pass, the
    provider record and the instant, with `category='PROVIDER'`.
  - `purchased_passes.used_sessions`: moved by exactly one, in the same
    transaction.

Not recorded, and asserted here too so the limits are explicit rather than
assumed: the event row names the *pass*, not the session, and it names the
provider *record*, not the identity that acted. Both are recoverable — by the
session's own `completed_at` and by the pass's `provider_identity_id` — but
neither is on the event itself.
*/
func TestAProviderRecordedCompletionLeavesAFullRecord(t *testing.T) {
	f := newRedemptionFixture(t)
	ctx := context.Background()
	pool := f.Pool.Pool
	sessions := application.PassSessions{Store: f.Pool, Now: func() time.Time { return f.Now }}

	view, err := sessions.View(ctx, f.Provider, f.PassID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Role != domain.ViewerProvider {
		t.Fatalf("fixture provider is not the provider: %q", view.Role)
	}
	target := view.Sessions[0]
	before := view.Pass.UsedSessions

	completed, pass, err := sessions.Complete(ctx, f.Provider, target.ID)
	if err != nil {
		t.Fatalf("provider completion: %v", err)
	}

	// --- the session row -------------------------------------------------
	var status, completedBy string
	var completedAt *time.Time
	var redemptionID *string
	var ordinal int32
	if err := pool.QueryRow(ctx, `SELECT status,completed_by,completed_at,redemption_id,sequence_number FROM pass_sessions WHERE id=$1`, target.ID).Scan(&status, &completedBy, &completedAt, &redemptionID, &ordinal); err != nil {
		t.Fatal(err)
	}
	if status != string(domain.PassSessionCompleted) || completedBy != string(domain.PassSessionByProvider) {
		t.Fatalf("session says status=%q by=%q", status, completedBy)
	}
	if completedAt == nil || !completedAt.Equal(f.Now) {
		t.Fatalf("completion time is not the moment it happened: %v", completedAt)
	}
	if redemptionID != nil {
		t.Fatalf("a provider completion claims a redemption: %v", *redemptionID)
	}
	if ordinal != target.SequenceNumber || completed.SequenceNumber != target.SequenceNumber {
		t.Fatalf("a different session was completed: %d/%d want %d", ordinal, completed.SequenceNumber, target.SequenceNumber)
	}

	// --- who was allowed to do it ----------------------------------------
	var providerIdentity domain.ID
	if err := pool.QueryRow(ctx, `SELECT provider_identity_id FROM purchased_passes WHERE id=$1`, f.PassID).Scan(&providerIdentity); err != nil {
		t.Fatal(err)
	}
	if providerIdentity != f.Provider.ID {
		t.Fatalf("the pass names %s as its provider, not the acting account %s", providerIdentity, f.Provider.ID)
	}
	// And nobody else can: the owner's own POST is refused, which is what keeps
	// `completed_by` meaningful (ADR-007).
	if _, _, err := sessions.Complete(ctx, f.Customer, view.Sessions[1].ID); err != application.ErrForbidden {
		t.Fatalf("the owner completed a session without a signature: %v", err)
	}

	// --- the event row ---------------------------------------------------
	var kind, category string
	var eventPass, eventProvider domain.ID
	var occurredAt time.Time
	var challengeID, eventRedemption *string
	if err := pool.QueryRow(ctx, `SELECT kind,category,pass_id,provider_id,occurred_at,challenge_id,redemption_id FROM redemption_events WHERE pass_id=$1 AND kind='SESSION_COMPLETED'`, f.PassID).Scan(&kind, &category, &eventPass, &eventProvider, &occurredAt, &challengeID, &eventRedemption); err != nil {
		t.Fatal(err)
	}
	if category != string(domain.ViewerProvider) || eventPass != f.PassID || eventProvider != pass.Snapshot.ProviderID {
		t.Fatalf("event: category=%q pass=%s provider=%s", category, eventPass, eventProvider)
	}
	if !occurredAt.Equal(f.Now) {
		t.Fatalf("event time %v is not the completion time %v", occurredAt, f.Now)
	}
	// No challenge and no redemption: this route has neither, and the record
	// says so rather than borrowing one.
	if challengeID != nil || eventRedemption != nil {
		t.Fatalf("a provider completion borrowed a signed redemption's fields: %v %v", challengeID, eventRedemption)
	}

	// --- the counter -----------------------------------------------------
	if pass.UsedSessions != before+1 {
		t.Fatalf("used_sessions went %d -> %d", before, pass.UsedSessions)
	}
	after, err := sessions.View(ctx, f.Provider, f.PassID)
	if err != nil {
		t.Fatal(err)
	}
	if got := domain.CountCompleted(after.Sessions); got != after.Pass.UsedSessions {
		t.Fatalf("%d completed rows against a counter of %d", got, after.Pass.UsedSessions)
	}

	// --- the documented limits -------------------------------------------
	//
	// Asserted, not assumed: if either of these gains a column the test should
	// fail and be updated, because the finding in `09-SECURITY.md §24a` rests
	// on exactly what is and is not on this row.
	var hasSessionColumn, hasActorColumn bool
	if err := pool.QueryRow(ctx, `SELECT
            EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='redemption_events' AND column_name IN ('session_id','pass_session_id')),
            EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='redemption_events' AND column_name IN ('actor_identity_id','identity_id'))`).Scan(&hasSessionColumn, &hasActorColumn); err != nil {
		t.Fatal(err)
	}
	if hasSessionColumn || hasActorColumn {
		t.Fatal("redemption_events gained a session or actor column; update 09-SECURITY.md §24a and this test")
	}
}
