-- Package visual identity. A curated token, never a free-form colour: the
-- provider picks how their pass details read, and the same six earth tones
-- the rest of Nimpass already uses for derived marks.
ALTER TABLE packages
    ADD COLUMN accent varchar(16);

ALTER TABLE packages
    ADD CONSTRAINT packages_accent_valid
    CHECK (accent IS NULL OR accent IN ('PINE', 'SLATE', 'CLAY', 'OLIVE', 'PLUM', 'AMBER'));
