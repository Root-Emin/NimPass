-- The worker polls the earliest unchecked candidate every ten seconds.
-- Keep this lookup bounded as historical payment_candidates accumulate.
CREATE INDEX payment_candidates_due_idx
    ON payment_candidates(last_checked_at NULLS FIRST, purchase_id)
    WHERE status <> 'MISMATCH';
