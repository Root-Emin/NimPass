-- Owned passes get their two parties by identity, and their sessions become
-- records instead of a counter.
--
-- Two separate problems, one migration, because they are the same fact seen
-- twice: a purchased pass belongs to the buyer *and* to the provider who has
-- to deliver it, and a session is the unit both of them actually talk about
-- ("is Tuesday's session done?"). Neither question could be answered before —
-- ownership was reachable only by joining back through `purchases`, and a
-- session existed only as an integer nobody could point at.

-- ---------------------------------------------------------------------------
-- 1. Ownership, stated rather than derived
-- ---------------------------------------------------------------------------
--
-- `owner_identity_id` is the buyer's account; it was previously recoverable
-- only as `purchases.customer_context_id` two joins away, which is why every
-- pass query carried that join and why the provider had no query at all.
--
-- `provider_identity_id` is the account behind the provider record. It is
-- denormalised on purpose: it is the column the provider-side authorisation
-- check reads on every session write, and resolving it through
-- `providers.owner_identity_id` at write time would make the check depend on a
-- row the provider can edit. Both are immutable once the pass exists.
ALTER TABLE purchased_passes ADD COLUMN owner_identity_id uuid REFERENCES identities(id);
ALTER TABLE purchased_passes ADD COLUMN provider_identity_id uuid REFERENCES identities(id);

UPDATE purchased_passes pa
   SET owner_identity_id = pu.customer_context_id
  FROM purchases pu
 WHERE pu.id = pa.purchase_id
   AND pa.owner_identity_id IS NULL;

UPDATE purchased_passes pa
   SET provider_identity_id = pr.owner_identity_id
  FROM providers pr
 WHERE pr.id = pa.provider_id
   AND pa.provider_identity_id IS NULL;

ALTER TABLE purchased_passes ALTER COLUMN owner_identity_id SET NOT NULL;
ALTER TABLE purchased_passes ALTER COLUMN provider_identity_id SET NOT NULL;

-- The buyer's own collection, newest first: the access path `GET /passes` uses
-- once it stops joining through `purchases`.
CREATE INDEX purchased_passes_owner_identity_idx
    ON purchased_passes (owner_identity_id, created_at DESC, id DESC);

-- The provider's sold passes. Same shape, other party.
CREATE INDEX purchased_passes_provider_identity_idx
    ON purchased_passes (provider_identity_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- 2. Sessions as records
-- ---------------------------------------------------------------------------
--
-- One row per session the pass was sold with, created in the same transaction
-- that creates the pass, and never created later: `sequence_number` is fixed
-- at 1..original_sessions and the unique index below is what stops a second
-- writer inventing an extra session.
--
-- The counter on `purchased_passes` is NOT replaced by a view over this table.
-- It stays, with its existing CHECK constraints
-- (`used + remaining = original`, `remaining >= 0`), because those constraints
-- are the database-level guarantee that a session cannot be spent twice or
-- into the negative — and a derived count could not be constrained that way.
-- What this migration adds is the requirement that the two agree: every
-- COMPLETED row corresponds to exactly one increment of `used_sessions`,
-- written in the same transaction.
CREATE TABLE pass_sessions (
    id uuid PRIMARY KEY,
    purchased_pass_id uuid NOT NULL REFERENCES purchased_passes(id),
    sequence_number integer NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'UNSCHEDULED',
    scheduled_at timestamptz,
    completed_at timestamptz,
    -- Who marked it delivered. OWNER means the pass owner spent it with a
    -- wallet signature (the redemption path); PROVIDER means the provider
    -- recorded the session they delivered. Null while it is not completed.
    completed_by varchar(8),
    -- The signed redemption that spent this session, when there was one. Null
    -- for a provider-recorded completion, which has no challenge and no
    -- signature — the audit fact there is this row plus its pass event.
    redemption_id uuid REFERENCES redemptions(id),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT pass_sessions_sequence_positive CHECK (sequence_number > 0),
    CONSTRAINT pass_sessions_status_valid
        CHECK (status IN ('UNSCHEDULED', 'SCHEDULED', 'COMPLETED', 'CANCELLED')),
    -- "Not scheduled" is a state, not a missing value: an open session either
    -- has a date and says SCHEDULED, or has none and says UNSCHEDULED. A
    -- finished session keeps whatever date it had, because when a session was
    -- meant to happen stays true after it happened.
    CONSTRAINT pass_sessions_schedule_state CHECK (
        (status = 'UNSCHEDULED' AND scheduled_at IS NULL)
     OR (status = 'SCHEDULED' AND scheduled_at IS NOT NULL)
     OR status IN ('COMPLETED', 'CANCELLED')
    ),
    CONSTRAINT pass_sessions_completed_fields
        CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)
               AND (completed_at IS NULL) = (completed_by IS NULL)),
    CONSTRAINT pass_sessions_completed_by_valid
        CHECK (completed_by IS NULL OR completed_by IN ('OWNER', 'PROVIDER')),
    CONSTRAINT pass_sessions_redemption_completed
        CHECK (redemption_id IS NULL OR status = 'COMPLETED'),
    CONSTRAINT pass_sessions_pass_sequence_unique UNIQUE (purchased_pass_id, sequence_number)
);

-- The pass detail screen's own query: every session of one pass, in order.
CREATE INDEX pass_sessions_pass_order_idx ON pass_sessions (purchased_pass_id, sequence_number);

-- One redemption spends one session, so it may appear on at most one row.
CREATE UNIQUE INDEX pass_sessions_redemption_uniq
    ON pass_sessions (redemption_id) WHERE redemption_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Backfill: existing passes get the sessions they were always sold with
-- ---------------------------------------------------------------------------
--
-- Ordinals 1..original_sessions for every existing pass. The first
-- `used_sessions` of them are COMPLETED, because that is exactly what the
-- counter already asserted, and they are matched to the redemptions that
-- produced them by `session_ordinal` — the same 1-based position the
-- redemption audit row already carries, so no history is invented and none is
-- renumbered.
INSERT INTO pass_sessions (
    id, purchased_pass_id, sequence_number, status,
    completed_at, completed_by, redemption_id, created_at, updated_at
)
SELECT
    gen_random_uuid(),
    pa.id,
    seq.n,
    CASE WHEN seq.n <= pa.used_sessions THEN 'COMPLETED' ELSE 'UNSCHEDULED' END,
    CASE WHEN seq.n <= pa.used_sessions THEN COALESCE(r.consumed_at, pa.created_at) END,
    CASE WHEN seq.n <= pa.used_sessions THEN 'OWNER' END,
    r.id,
    pa.created_at,
    pa.created_at
  FROM purchased_passes pa
  CROSS JOIN LATERAL generate_series(1, pa.original_sessions) AS seq(n)
  LEFT JOIN redemptions r
         ON r.pass_id = pa.id
        AND r.session_ordinal = seq.n
        AND seq.n <= pa.used_sessions;

-- Session-level events, alongside the redemption events that already exist.
-- A provider-recorded completion produces no redemption row, so without this
-- it would leave no trail at all.
ALTER TABLE redemption_events DROP CONSTRAINT redemption_events_kind_valid;
ALTER TABLE redemption_events ADD CONSTRAINT redemption_events_kind_valid
    CHECK (kind IN ('CHALLENGE_CREATED','CHALLENGE_AUTHORIZED','AUTHORIZATION_FAILED',
                    'CHALLENGE_EXPIRED','CONFIRM_ATTEMPTED','REDEMPTION_CONSUMED',
                    'REPLAY_REJECTED','PASS_COMPLETED',
                    'SESSION_SCHEDULED','SESSION_UNSCHEDULED','SESSION_COMPLETED'));
ALTER TABLE redemption_events ALTER COLUMN challenge_id DROP NOT NULL;
