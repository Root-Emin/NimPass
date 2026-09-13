ALTER TABLE purchases DROP CONSTRAINT purchases_reference_shape;
ALTER TABLE purchases ADD CONSTRAINT purchases_reference_shape CHECK (payment_reference ~ '^(NP:|NP1:)[0-9a-f]{32}$');
ALTER TABLE purchases DROP CONSTRAINT purchases_status_valid;
ALTER TABLE purchases ADD CONSTRAINT purchases_status_valid CHECK (status IN ('CREATED','PAYMENT_PENDING','TRANSACTION_SUBMITTED','VERIFYING','AWAITING_FINALITY','CONFIRMED','FAILED','CANCELLED','EXPIRED'));

-- The legacy transaction_hash remains NULL until final verified claim. It must
-- never be used as an unverified, globally unique reservation.
CREATE TABLE payment_candidates (
    purchase_id uuid PRIMARY KEY REFERENCES purchases(id),
    transaction_hash varchar(64) NOT NULL,
    submitted_at timestamptz NOT NULL,
    broadcast_observed_at timestamptz,
    last_checked_at timestamptz,
    status varchar(24) NOT NULL DEFAULT 'SUBMITTED',
    failure_category varchar(40),
    inclusion_block bigint,
    included_at timestamptz,
    CONSTRAINT payment_candidates_hash_shape CHECK (transaction_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT payment_candidates_status_valid CHECK (status IN ('SUBMITTED','NOT_FOUND','UNCERTAIN','INCLUDED','AWAITING_FINALITY','MISMATCH'))
);
CREATE INDEX payment_candidates_hash_idx ON payment_candidates(transaction_hash);

CREATE TABLE verified_payments (
    transaction_hash varchar(64) PRIMARY KEY,
    purchase_id uuid NOT NULL UNIQUE REFERENCES purchases(id),
    sender_wallet varchar(36) NOT NULL,
    recipient_wallet varchar(36) NOT NULL,
    value_luna bigint NOT NULL,
    network varchar(8) NOT NULL,
    inclusion_block bigint NOT NULL,
    included_at timestamptz NOT NULL,
    finality_block bigint NOT NULL,
    finalized_at timestamptz NOT NULL,
    CONSTRAINT verified_payments_hash_shape CHECK (transaction_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT verified_payments_value_positive CHECK (value_luna > 0),
    CONSTRAINT verified_payments_blocks_ordered CHECK (finality_block > inclusion_block)
);

CREATE TABLE purchase_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    purchase_id uuid NOT NULL REFERENCES purchases(id),
    kind varchar(40) NOT NULL,
    category varchar(40),
    occurred_at timestamptz NOT NULL
);
CREATE INDEX purchase_events_purchase_idx ON purchase_events(purchase_id, id);
