-- The provider's chosen face, from Nimiq's own identicon set.
--
-- 0 is the identicon of the owner wallet itself, which is what every existing
-- provider already shows (docs/DECISIONS.md ADR-010) — so the default keeps
-- every row exactly as it renders today. A higher variant selects another
-- identicon derived from the same address, which is a *picture the provider
-- chose*: it sits where an uploaded photograph sits, and never replaces the
-- wallet the payment path uses.
--
-- Bounded because it is drawn, not stored: the client renders identicon
-- number N for this wallet, so N has to be a number the gallery can actually
-- offer.
ALTER TABLE providers
 ADD COLUMN avatar_variant smallint NOT NULL DEFAULT 0
 CONSTRAINT providers_avatar_variant_range CHECK (avatar_variant BETWEEN 0 AND 255);
