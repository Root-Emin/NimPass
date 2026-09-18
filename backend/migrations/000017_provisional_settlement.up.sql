-- A verified payment may be included without yet being final.
--
-- `verified_payments` was written on the assumption that every receipt it
-- holds is already irreversible:
--
--     inclusion_block  NOT NULL
--     included_at      NOT NULL
--     finality_block   NOT NULL
--     finalized_at     NOT NULL
--     CHECK (finality_block > inclusion_block)
--     CHECK (finalized_at >= included_at)
--
-- That was not a description of the chain; it was the macro-block wait, in
-- schema form. A payment canonically included in a micro block and correct in
-- every economic respect had nowhere to be written down, so the only way to
-- avoid recording a lie was to not record it at all — and the customer waited
-- for the batch to close before their Pass existed. On Mainnet that is up to
-- roughly a minute, against a micro-block time of about one second.
--
-- The model this migration establishes:
--
--     inclusion_block   NOT NULL     always. Inclusion stays mandatory; a
--     included_at       NOT NULL     mempool transaction still settles nothing.
--     finality_block    NULL         until the macro block is observed
--     finalized_at      NULL         until the macro block is observed
--     settlement_status INCLUDED | FINALIZED | CONTESTED
--
-- Every integrity rule that was being enforced is still enforced — it is now
-- conditional on the state that makes it meaningful rather than assumed of
-- every row. A row cannot claim finality without naming the macro block that
-- granted it, that block must still sit above the inclusion block, and it
-- still cannot predate the block it finalises.

-- ---------------------------------------------------------------------------
-- The settlement state itself
-- ---------------------------------------------------------------------------

-- Defaulted for the backfill only. Every existing receipt is finalised by
-- construction, because the old NOT NULL constraints admitted nothing else.
ALTER TABLE verified_payments
    ADD COLUMN settlement_status varchar(16) NOT NULL DEFAULT 'FINALIZED';
ALTER TABLE verified_payments ALTER COLUMN settlement_status DROP DEFAULT;

-- The macro block this inclusion is waiting for, known from the moment the
-- payment is accepted.
--
-- `getMacroBlockAfter(height)` is policy arithmetic rather than chain state —
-- macro blocks sit at fixed multiples of the batch length — so the height is
-- available immediately and cannot change while the node serves one network.
-- Storing it is what lets the finality worker ask the chain one cheap question
-- ("is the head past this height yet?") instead of re-running the whole
-- verification pipeline every couple of seconds to be told no.
--
-- It is emphatically NOT a claim of finality. `finality_block` below is the
-- observed one, and only it is allowed to be non-null when a row says
-- FINALIZED.
ALTER TABLE verified_payments ADD COLUMN expected_finality_block bigint;
UPDATE verified_payments SET expected_finality_block = finality_block
 WHERE expected_finality_block IS NULL;
ALTER TABLE verified_payments ALTER COLUMN expected_finality_block SET NOT NULL;

-- The finality worker's own backoff, mirroring payment_candidates'
-- last_checked_at / retry_count and following the same rule discovery and
-- verification already follow (ADR-013, ADR-019): attempts count *failures*,
-- never the ordinary quiet of a macro block that has not been produced yet.
ALTER TABLE verified_payments ADD COLUMN settlement_checked_at timestamptz;
ALTER TABLE verified_payments ADD COLUMN settlement_attempts integer NOT NULL DEFAULT 0;

-- The audit record of a canonicality failure. The receipt is never deleted:
-- it is the evidence of what was accepted, on what basis, and at what height,
-- and a compensation case is opened against it rather than in place of it.
ALTER TABLE verified_payments ADD COLUMN contested_at timestamptz;
ALTER TABLE verified_payments ADD COLUMN contest_reason varchar(40);

-- ---------------------------------------------------------------------------
-- Finality fields become conditional, not optional
-- ---------------------------------------------------------------------------

ALTER TABLE verified_payments ALTER COLUMN finality_block DROP NOT NULL;
ALTER TABLE verified_payments ALTER COLUMN finalized_at DROP NOT NULL;

-- Replaced rather than kept, because both are now expressed inside the
-- settlement constraint where they can be stated per state. Dropping them and
-- leaving nothing in their place would be the weakening this migration is
-- specifically not doing.
ALTER TABLE verified_payments DROP CONSTRAINT verified_payments_blocks_ordered;
ALTER TABLE verified_payments DROP CONSTRAINT verified_payments_time_ordered;

ALTER TABLE verified_payments ADD CONSTRAINT verified_payments_settlement_valid
    CHECK (settlement_status IN ('INCLUDED', 'FINALIZED', 'CONTESTED'));

ALTER TABLE verified_payments ADD CONSTRAINT verified_payments_attempts_sane
    CHECK (settlement_attempts >= 0);

-- One constraint, three states, and no row can be in none or two of them.
--
-- FINALIZED  must name its macro block and the moment it was produced, that
--            block must be above the inclusion block, and it cannot predate
--            the block it finalises. These are the two checks this migration
--            dropped above, restated where they apply.
-- INCLUDED   must claim no finality at all. A provisional receipt with a
--            finality block would be indistinguishable from a settled one.
-- CONTESTED  likewise: a finalised payment is beyond reorganisation by
--            definition, so a contested one was never finalised.
ALTER TABLE verified_payments ADD CONSTRAINT verified_payments_settlement_fields CHECK (
    (settlement_status = 'FINALIZED'
        AND finality_block IS NOT NULL
        AND finalized_at IS NOT NULL
        AND finality_block > inclusion_block
        AND finalized_at >= included_at
        AND contested_at IS NULL
        AND contest_reason IS NULL)
 OR (settlement_status = 'INCLUDED'
        AND finality_block IS NULL
        AND finalized_at IS NULL
        AND contested_at IS NULL
        AND contest_reason IS NULL)
 OR (settlement_status = 'CONTESTED'
        AND finality_block IS NULL
        AND finalized_at IS NULL
        AND contested_at IS NOT NULL
        AND contest_reason IS NOT NULL)
);

-- The expected macro block is above the inclusion block in every state,
-- including the contested one, because it describes where finality *would*
-- have been rather than whether it happened.
ALTER TABLE verified_payments ADD CONSTRAINT verified_payments_expected_block_ordered
    CHECK (expected_finality_block > inclusion_block);

-- The finality worker's access path: provisional receipts, least recently
-- checked first. Partial, so the sweep never walks settled history — which is
-- where all but a handful of rows live at any moment.
CREATE INDEX verified_payments_settlement_due_idx
    ON verified_payments (settlement_checked_at NULLS FIRST, transaction_hash)
    WHERE settlement_status = 'INCLUDED';

-- ---------------------------------------------------------------------------
-- The candidate's own terminal state
-- ---------------------------------------------------------------------------
--
-- A settled candidate had no status of its own to move to: under the old
-- policy it sat at 'AWAITING_FINALITY' forever, which read as "still waiting"
-- on a purchase that had long since confirmed. 'CONFIRMED' is what the row now
-- says once its purchase is settled, whichever policy settled it.
ALTER TABLE payment_candidates DROP CONSTRAINT payment_candidates_status_valid;
ALTER TABLE payment_candidates ADD CONSTRAINT payment_candidates_status_valid
    CHECK (status IN ('SUBMITTED', 'NOT_FOUND', 'UNCERTAIN', 'INCLUDED', 'AWAITING_FINALITY',
                      'CONFIRMED', 'MISMATCH', 'COMPENSATION_REQUIRED', 'SETTLEMENT_REVERSED'));

-- ---------------------------------------------------------------------------
-- Compensation covers the reverse case too
-- ---------------------------------------------------------------------------
--
-- The existing reason is "real money arrived and no Pass could be issued".
-- Fast settlement introduces its mirror image: a Pass was issued and the
-- payment behind it turns out never to have become canonical. Both are states
-- where the receipt and the entitlement disagree and a human has to close the
-- loop, so they belong in the same ledger — a second recovery subsystem would
-- be two places to look for one kind of problem.
ALTER TABLE compensation_cases DROP CONSTRAINT compensation_cases_reason_valid;
ALTER TABLE compensation_cases ADD CONSTRAINT compensation_cases_reason_valid
    CHECK (reason IN ('PASS_EXPIRED_BEFORE_ACTIVATION', 'PAYMENT_SETTLEMENT_REVERSED'));

-- `PASS_WITHDRAWN` is how a reversed settlement is closed: the entitlement was
-- withdrawn and nothing is owed in either direction, because no money moved.
ALTER TABLE compensation_cases DROP CONSTRAINT compensation_cases_resolution_valid;
ALTER TABLE compensation_cases ADD CONSTRAINT compensation_cases_resolution_valid CHECK (
    (status = 'OPEN' AND resolved_at IS NULL AND resolution_kind IS NULL AND resolution_reference IS NULL)
 OR (status = 'RESOLVED' AND resolved_at IS NOT NULL
        AND resolution_kind IN ('MANUAL_REFUND', 'REISSUE', 'PASS_WITHDRAWN')
        AND resolution_reference IS NOT NULL AND length(trim(resolution_reference)) > 0)
);
