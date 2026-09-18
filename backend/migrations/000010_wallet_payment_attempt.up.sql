-- A native wallet call may broadcast even if its response is lost. Keep that
-- uncertainty across devices/reloads; never automatically unlock on a timer.
ALTER TABLE purchases ADD COLUMN wallet_attempt_id uuid;
ALTER TABLE purchases ADD COLUMN wallet_attempt_at timestamptz;
ALTER TABLE purchases ADD CONSTRAINT wallet_attempt_pair CHECK
    ((wallet_attempt_id IS NULL) = (wallet_attempt_at IS NULL));
