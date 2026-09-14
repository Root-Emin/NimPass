ALTER TABLE redemption_challenges
    ADD COLUMN purpose varchar(32) NOT NULL DEFAULT 'AUTHORIZE_REDEMPTION',
    ADD COLUMN network varchar(8) NOT NULL DEFAULT 'TESTNET',
    ADD COLUMN environment varchar(16) NOT NULL DEFAULT 'test',
    ADD COLUMN expected_used_sessions integer NOT NULL DEFAULT 0,
    ADD COLUMN expected_remaining_sessions integer NOT NULL DEFAULT 0,
    ADD COLUMN qr_token_digest bytea,
    ADD COLUMN qr_issued_at timestamptz,
    ADD COLUMN qr_expires_at timestamptz,
    ADD COLUMN authorized_public_key_digest bytea,
    ADD COLUMN authorized_signature_digest bytea;

ALTER TABLE redemption_challenges
    ADD CONSTRAINT redemption_challenges_purpose_valid CHECK (purpose = 'AUTHORIZE_REDEMPTION'),
    ADD CONSTRAINT redemption_challenges_network_valid CHECK (network IN ('TESTNET', 'MAINNET')),
    ADD CONSTRAINT redemption_challenges_environment_valid CHECK (environment IN ('development', 'test', 'production')),
    ADD CONSTRAINT redemption_challenges_expected_sessions_valid CHECK (expected_used_sessions >= 0 AND expected_remaining_sessions >= 0),
    ADD CONSTRAINT redemption_challenges_qr_digest_shape CHECK (qr_token_digest IS NULL OR length(qr_token_digest) = 32),
    ADD CONSTRAINT redemption_challenges_qr_expiry_valid CHECK (qr_expires_at IS NULL OR qr_issued_at IS NOT NULL AND qr_expires_at > qr_issued_at),
    ADD CONSTRAINT redemption_challenges_authorization_digest_shape CHECK (
        (authorized_public_key_digest IS NULL AND authorized_signature_digest IS NULL) OR
        (length(authorized_public_key_digest) = 32 AND length(authorized_signature_digest) = 32)
    );
CREATE UNIQUE INDEX redemption_challenges_qr_digest_idx ON redemption_challenges(qr_token_digest) WHERE qr_token_digest IS NOT NULL;

CREATE TABLE redemption_events (
    id uuid PRIMARY KEY,
    challenge_id uuid NOT NULL REFERENCES redemption_challenges(id),
    redemption_id uuid REFERENCES redemptions(id),
    pass_id uuid NOT NULL REFERENCES passes(id),
    provider_id uuid NOT NULL REFERENCES providers(id),
    kind varchar(40) NOT NULL,
    category varchar(48),
    occurred_at timestamptz NOT NULL,
    CONSTRAINT redemption_events_kind_valid CHECK (kind IN ('CHALLENGE_CREATED','CHALLENGE_AUTHORIZED','AUTHORIZATION_FAILED','CHALLENGE_EXPIRED','CONFIRM_ATTEMPTED','REDEMPTION_CONSUMED','REPLAY_REJECTED','PASS_COMPLETED'))
);
CREATE INDEX redemption_events_challenge_idx ON redemption_events(challenge_id, occurred_at DESC);
CREATE INDEX redemption_events_pass_idx ON redemption_events(pass_id, occurred_at DESC);
CREATE INDEX redemption_events_provider_idx ON redemption_events(provider_id, occurred_at DESC);
