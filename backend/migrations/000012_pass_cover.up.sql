-- Pass cover images. Bytes live on disk (docs/08-ARCHITECTURE.md §116);
-- this table is the reference the catalog stores, never a blob.
-- Upload hardening is in the application layer (docs/09-SECURITY.md §83).

CREATE TABLE media_objects (
    id uuid PRIMARY KEY,
    owner_identity_id uuid NOT NULL REFERENCES identities(id),
    kind varchar(32) NOT NULL,
    content_type varchar(64) NOT NULL,
    byte_size integer NOT NULL,
    created_at timestamptz NOT NULL,
    CONSTRAINT media_objects_kind_valid CHECK (kind = 'pass_cover'),
    CONSTRAINT media_objects_type_valid CHECK (content_type = 'image/jpeg'),
    CONSTRAINT media_objects_size_valid CHECK (byte_size > 0 AND byte_size <= 2097152)
);
CREATE INDEX media_objects_owner_idx ON media_objects (owner_identity_id, created_at DESC);

ALTER TABLE passes
    ADD COLUMN cover_media_id uuid REFERENCES media_objects(id);

CREATE INDEX passes_cover_media_idx ON passes (cover_media_id) WHERE cover_media_id IS NOT NULL;
