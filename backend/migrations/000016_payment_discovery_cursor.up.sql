-- Automatic discovery becomes the normal way a QR payment settles.
--
-- Discovery already existed (ADR-010) but was shaped as a per-purchase rescue:
-- one address query per pending intent, backing off to four minutes after a
-- few empty looks. That is the wrong shape for the path it now has to carry.
-- A customer standing at their desk watching a QR needs the payment noticed in
-- seconds, and a provider with fifty live intents must not cost fifty scans of
-- the same address.
--
-- Two changes here: a per-address cursor so each sweep looks only at what is
-- new, and the access path for grouping pending intents by the address they
-- are waiting on.

-- One row per address Nimpass is watching, per network.
--
-- The cursor is a transaction hash rather than a block height on purpose:
-- `getTransactionsByAddress` returns transactions newest-first and paginates
-- by hash (`startAt`), so a hash is the cursor the RPC itself understands. A
-- height would have to be translated back into that on every call.
CREATE TABLE payment_discovery_cursors (
    recipient_wallet varchar(36) NOT NULL,
    network varchar(8) NOT NULL,
    -- The newest transaction this address was known to have. A sweep walks
    -- the returned list until it meets this hash and stops; everything above
    -- it is new. NULL means "never scanned", where the first sweep reads one
    -- bounded page and adopts its head.
    last_seen_hash varchar(64),
    last_scanned_at timestamptz,
    -- Consecutive RPC failures, for backing off an endpoint that is down or
    -- throttling. Reset on any successful scan. Note what this does NOT count:
    -- a successful scan that found no payment. Waiting for a customer to walk
    -- to their phone is the normal case and must never slow the sweep down —
    -- that was the defect that made a paid purchase take minutes to notice.
    failures integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (recipient_wallet, network),
    CONSTRAINT payment_discovery_cursors_wallet_shape CHECK (recipient_wallet ~ '^NQ[A-Z0-9]{34}$'),
    CONSTRAINT payment_discovery_cursors_network_valid CHECK (network IN ('TESTNET', 'MAINNET')),
    CONSTRAINT payment_discovery_cursors_hash_shape CHECK (last_seen_hash IS NULL OR last_seen_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT payment_discovery_cursors_failures_sane CHECK (failures >= 0)
);

-- The sweep's own access path: which addresses have a live intent waiting on
-- them, oldest scan first.
CREATE INDEX payment_discovery_cursors_due_idx
    ON payment_discovery_cursors (last_scanned_at NULLS FIRST);

-- Grouping pending intents by the address they expect to be paid on. The
-- partial predicate matches the sweep's query exactly, so listing the live
-- addresses never walks settled history.
CREATE INDEX purchases_pending_recipient_idx
    ON purchases (recipient_wallet, network, expires_at)
    WHERE status = 'PAYMENT_PENDING';

-- ---------------------------------------------------------------------------
-- The pass belongs to the buyer, not to the address that paid
-- ---------------------------------------------------------------------------
--
-- `purchased_passes_verified_purchase_fk` tied `owner_wallet` to the
-- purchase's `verified_sender_wallet` — the schema-level statement that the
-- pass belongs to whoever paid. That held only because the verifier refused
-- any payment whose sender was not the buyer's own wallet, and that refusal
-- is exactly what made a QR payment approved from a second account in the
-- same Nimiq Pay wallet impossible to settle.
--
-- The owner is now the authenticated buyer (`expected_wallet`), which is the
-- address they proved control of to create the intent and the one a
-- redemption challenge is issued against. The paying address is still
-- recorded in `verified_sender_wallet`; it is an audit fact rather than an
-- ownership claim, so it no longer anchors this key.
--
-- Nothing is loosened: the pair is still enforced by a composite foreign key,
-- so a pass cannot name an owner its own purchase does not.

-- Existing rows already satisfy the new shape, because the old sender rule
-- forced the two addresses to be equal. Stated as an UPDATE rather than
-- assumed, so a row that somehow differs is corrected instead of blocking the
-- constraint below with an error nobody can act on.
UPDATE purchased_passes pa
   SET owner_wallet = pu.expected_wallet
  FROM purchases pu
 WHERE pu.id = pa.purchase_id
   AND pu.expected_wallet IS NOT NULL
   AND pa.owner_wallet <> pu.expected_wallet;

ALTER TABLE purchases ADD CONSTRAINT purchases_buyer_relation_unique
    UNIQUE (id, pass_id, provider_id, service_id, expected_wallet);

ALTER TABLE purchased_passes DROP CONSTRAINT purchased_passes_verified_purchase_fk;
ALTER TABLE purchased_passes ADD CONSTRAINT purchased_passes_buyer_purchase_fk
    FOREIGN KEY (purchase_id, pass_id, provider_id, service_id, owner_wallet)
    REFERENCES purchases(id, pass_id, provider_id, service_id, expected_wallet);
