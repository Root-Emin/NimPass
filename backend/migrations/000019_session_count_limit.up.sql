-- A Pass may be sold with at most 500 sessions.
--
-- The number is not new: the Pass form has always told providers "That looks
-- too high. Enter 500 or fewer." What was new is that nothing below the form
-- agreed. `NewSessionCount` accepted any positive int32, so a request posted
-- directly could create a Pass with two billion sessions, and every session a
-- Pass is sold with becomes a row here at purchase time (ADR-012). One Luna
-- bought a settlement transaction that tried to allocate one struct and write
-- one row per session — a fatal out-of-memory in the worker at the top of the
-- range, and a purchase that could never confirm well below it.
--
-- `domain.MaxSessionsPerPass` is the authority and refuses it before anything
-- is allocated. This is the same invariant said where the rows actually live,
-- so a Pass that bypassed the application entirely still cannot exist.

-- ---------------------------------------------------------------------------
-- Why NOT VALID
-- ---------------------------------------------------------------------------
--
-- NOT VALID means "enforce this on every insert and update from now on, do not
-- scan what is already there". Both halves are deliberate.
--
-- Enforcement is what this migration is for, and NOT VALID does not weaken it:
-- a new Pass above the limit is rejected, and so is an UPDATE that raises an
-- existing one.
--
-- Not scanning is what keeps the deploy honest. A row above the limit can only
-- have come from a request that bypassed the form, so it is evidence rather
-- than data — and the two ways to make a validating constraint pass would be to
-- rewrite the provider's own session count or to delete their Pass. Neither is
-- a migration's decision to make. The rows are left exactly as they are, for a
-- person to look at:
--
--   SELECT id, provider_id, status, session_count FROM passes
--    WHERE session_count > 500;
--   SELECT id, purchase_id, original_sessions FROM purchased_passes
--    WHERE original_sessions > 500;
--
-- Once those are dealt with, the constraints can be promoted with
-- `ALTER TABLE ... VALIDATE CONSTRAINT ...`, which takes no exclusive lock.

ALTER TABLE passes
  ADD CONSTRAINT passes_sessions_within_limit
  CHECK (session_count <= 500) NOT VALID;

-- The same bound on the issued side. `original_sessions` is copied from the
-- catalogue row at confirmation and is what `NewPassSessions` counts, so it is
-- the value that decides how many rows a settlement writes.
ALTER TABLE purchased_passes
  ADD CONSTRAINT purchased_passes_sessions_within_limit
  CHECK (original_sessions <= 500) NOT VALID;
