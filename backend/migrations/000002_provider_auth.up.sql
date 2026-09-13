CREATE TABLE auth_challenges (
    id uuid PRIMARY KEY,
    purpose varchar(32) NOT NULL CHECK (purpose IN ('AUTH_LOGIN', 'VERIFY_PROVIDER_WALLET')),
    wallet_address varchar(36) NOT NULL,
    provider_id uuid REFERENCES providers(id),
    nonce char(64) NOT NULL UNIQUE,
    network varchar(8) NOT NULL CHECK (network IN ('TESTNET', 'MAINNET')),
    environment varchar(16) NOT NULL CHECK (environment IN ('development', 'test', 'production')),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
    CHECK (expires_at > issued_at),
    CHECK ((purpose = 'AUTH_LOGIN' AND provider_id IS NULL) OR
           (purpose = 'VERIFY_PROVIDER_WALLET' AND provider_id IS NOT NULL))
);
CREATE INDEX auth_challenges_expiry_idx ON auth_challenges(expires_at) WHERE consumed_at IS NULL;
CREATE INDEX auth_challenges_wallet_idx ON auth_challenges(wallet_address, issued_at DESC);

CREATE TABLE auth_sessions (
    id uuid PRIMARY KEY,
    identity_id uuid NOT NULL REFERENCES identities(id),
    token_digest bytea NOT NULL UNIQUE CHECK (length(token_digest) = 32),
    csrf_digest bytea NOT NULL CHECK (length(csrf_digest) = 32),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    last_used_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_identity_idx ON auth_sessions(identity_id, expires_at DESC);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE provider_payout_audit (
    id uuid PRIMARY KEY,
    provider_id uuid NOT NULL REFERENCES providers(id),
    actor_identity_id uuid NOT NULL REFERENCES identities(id),
    challenge_id uuid NOT NULL UNIQUE REFERENCES auth_challenges(id),
    previous_wallet varchar(36),
    new_wallet varchar(36) NOT NULL,
    verified_at timestamptz NOT NULL
);
CREATE INDEX provider_payout_audit_provider_idx ON provider_payout_audit(provider_id, verified_at DESC);
