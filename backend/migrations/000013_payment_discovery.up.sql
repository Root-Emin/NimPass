-- Server-side discovery of a payment nobody reported.
--
-- The desktop QR flow is paid inside Nimiq Pay, on a phone, away from the
-- browser that is waiting. No client is in a position to report the hash, so
-- the backend has to find it: `getTransactionsByAddress` on the intent's own
-- recipient, filtered down to transactions that match this purchase exactly.
--
-- Discovery only *nominates* a hash. Everything after that — inclusion,
-- finality, sender, recipient, exact value, reference, network, uniqueness,
-- one-Pass issuance — is the verification path that already existed and is
-- unchanged. See ADR-006 gate G2.

-- Rate limiting for the discovery sweep, mirroring payment_candidates'
-- last_checked_at/retry_count. Without it a pending intent would be swept on
-- every worker tick, and the public RPC allows 20 tokens per 10 seconds.
ALTER TABLE purchases ADD COLUMN discovery_checked_at timestamptz;
ALTER TABLE purchases ADD COLUMN discovery_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD CONSTRAINT purchases_discovery_attempts_sane
    CHECK (discovery_attempts >= 0);

-- Where a candidate came from. `validateEvidence` requires a submission time
-- inside the intent's lifetime; a discovered candidate supplies the moment the
-- server found it, and this column keeps that honest rather than letting a
-- server-found payment look like a client-reported one in the audit trail.
ALTER TABLE payment_candidates ADD COLUMN origin varchar(16) NOT NULL DEFAULT 'CLIENT';
ALTER TABLE payment_candidates ADD CONSTRAINT payment_candidates_origin_valid
    CHECK (origin IN ('CLIENT', 'DISCOVERY'));

-- One transaction, one purchase — enforced at the candidate stage for
-- discovered hashes, not only at settlement.
--
-- verified_payments.transaction_hash is already the primary key, so a replayed
-- transaction can never settle twice. This index is the earlier guard that
-- discovery specifically needs: two concurrent sweeps must not adopt the same
-- on-chain transaction for two different purchases and then race to confirm.
-- It is partial so the client submission path keeps its existing behaviour,
-- where an unverified hash is an untrusted hint and never a reservation.
CREATE UNIQUE INDEX payment_candidates_discovered_hash_uniq
    ON payment_candidates (transaction_hash) WHERE origin = 'DISCOVERY';

-- The sweep's own access path: pending intents with no candidate yet, oldest
-- check first.
CREATE INDEX purchases_discovery_due_idx
    ON purchases (discovery_checked_at NULLS FIRST, id)
    WHERE status = 'PAYMENT_PENDING';
