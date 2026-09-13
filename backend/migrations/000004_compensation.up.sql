ALTER TABLE purchases DROP CONSTRAINT purchases_status_valid;
ALTER TABLE purchases ADD CONSTRAINT purchases_status_valid CHECK (status IN ('CREATED','PAYMENT_PENDING','TRANSACTION_SUBMITTED','VERIFYING','AWAITING_FINALITY','CONFIRMED','COMPENSATION_REQUIRED','FAILED','CANCELLED','EXPIRED'));
ALTER TABLE purchases DROP CONSTRAINT purchases_confirmed_fields;
ALTER TABLE purchases ADD CONSTRAINT purchases_confirmed_fields CHECK (
    status NOT IN ('CONFIRMED','COMPENSATION_REQUIRED') OR
    (transaction_hash IS NOT NULL AND verified_sender_wallet IS NOT NULL AND confirmed_at IS NOT NULL)
);

ALTER TABLE payment_candidates DROP CONSTRAINT payment_candidates_status_valid;
ALTER TABLE payment_candidates ADD CONSTRAINT payment_candidates_status_valid CHECK (status IN ('SUBMITTED','NOT_FOUND','UNCERTAIN','INCLUDED','AWAITING_FINALITY','MISMATCH','COMPENSATION_REQUIRED'));

-- The receipt is the global hash claim. A compensation case must point to that
-- exact receipt; one purchase cannot silently acquire another transaction.
ALTER TABLE verified_payments ADD CONSTRAINT verified_payments_purchase_hash_unique UNIQUE (purchase_id, transaction_hash);
CREATE TABLE compensation_cases (
    purchase_id uuid PRIMARY KEY,
    transaction_hash varchar(64) NOT NULL,
    reason varchar(48) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'OPEN',
    created_at timestamptz NOT NULL,
    resolved_at timestamptz,
    resolution_kind varchar(24),
    resolution_reference text,
    CONSTRAINT compensation_cases_receipt_fk FOREIGN KEY (purchase_id, transaction_hash) REFERENCES verified_payments(purchase_id, transaction_hash),
    CONSTRAINT compensation_cases_reason_valid CHECK (reason = 'PACKAGE_EXPIRED_BEFORE_ACTIVATION'),
    CONSTRAINT compensation_cases_status_valid CHECK (status IN ('OPEN','RESOLVED')),
    CONSTRAINT compensation_cases_resolution_valid CHECK (
        (status = 'OPEN' AND resolved_at IS NULL AND resolution_kind IS NULL AND resolution_reference IS NULL) OR
        (status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolution_kind IN ('MANUAL_REFUND','REISSUE') AND resolution_reference IS NOT NULL AND length(trim(resolution_reference)) > 0)
    )
);
CREATE INDEX compensation_cases_status_idx ON compensation_cases(status, created_at);
