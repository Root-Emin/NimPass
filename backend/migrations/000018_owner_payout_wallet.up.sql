-- The payout wallet is the wallet that signed in, and it is adopted on sight.
--
-- A provider used to exist with no payout wallet at all and had to run a
-- separate `VERIFY_PROVIDER_WALLET` ceremony before anything they made could
-- be published: type an address, sign from it, sign again from the login
-- wallet. On a phone that arrived as a form between pressing Publish and
-- selling anything, asking for an address the product already knew.
--
-- It already knew it because `AUTH_LOGIN` proved it. A session exists only
-- because a fresh, backend-authored challenge was signed by that wallet, and
-- `identities.wallet_address` is the address that signature resolved to. So
-- adopting the owner's own wallet as the payout destination introduces no
-- unproven address: it reuses the one proof the account is already built on,
-- and the address is derived server-side from the session rather than sent by
-- a client that could name any address it liked (ADR-025).
--
-- The explicit ceremony stays in the schema and in the API for a *change* of
-- payout wallet, which is still a wallet the login proof says nothing about
-- (docs/09-SECURITY.md §22-§23).

-- ---------------------------------------------------------------------------
-- An adoption has no challenge to point at
-- ---------------------------------------------------------------------------
--
-- Every payout assignment is still audited — that is §22's requirement and it
-- is not being dropped — but an assignment that consumed no challenge cannot
-- name one. NULL here means exactly "this wallet came from the session's own
-- login proof"; a non-NULL challenge still means a signed VERIFY_PROVIDER_WALLET
-- ceremony. The UNIQUE stays: PostgreSQL does not treat NULLs as duplicates,
-- so a challenge can still be spent on at most one payout change.
ALTER TABLE provider_payout_audit ALTER COLUMN challenge_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Providers that were left without one
-- ---------------------------------------------------------------------------
--
-- Rows created under the old rule are mid-flow, not opted out: they reached
-- the ceremony and did not finish it, which is why they cannot publish. The
-- wallet they would have verified is the one their owner signed in with, so
-- the backfill assigns exactly that and nothing else.
--
-- Providers that *did* verify a payout wallet are untouched, including any who
-- deliberately chose an address other than their login wallet — the filter is
-- "has none", never "differs from the owner".
INSERT INTO provider_payout_audit(id, provider_id, actor_identity_id, challenge_id, previous_wallet, new_wallet, verified_at)
SELECT gen_random_uuid(), p.id, p.owner_identity_id, NULL, NULL, i.wallet_address, now()
  FROM providers p
  JOIN identities i ON i.id = p.owner_identity_id
 WHERE p.payout_wallet IS NULL;

UPDATE providers p
   SET payout_wallet = i.wallet_address,
       payout_verified_at = now(),
       updated_at = now()
  FROM identities i
 WHERE i.id = p.owner_identity_id
   AND p.payout_wallet IS NULL;
