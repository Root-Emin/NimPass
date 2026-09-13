CREATE TABLE identities (
    id uuid PRIMARY KEY,
    wallet_address varchar(36) NOT NULL UNIQUE,
    created_at timestamptz NOT NULL,
    CONSTRAINT identities_wallet_shape CHECK (wallet_address ~ '^NQ[A-Z0-9]{34}$')
);

CREATE TABLE providers (
    id uuid PRIMARY KEY,
    owner_identity_id uuid NOT NULL REFERENCES identities(id),
    name varchar(160) NOT NULL,
    payout_wallet varchar(36),
    payout_verified_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT providers_name_nonempty CHECK (length(btrim(name)) > 0),
    CONSTRAINT providers_payout_shape CHECK (payout_wallet IS NULL OR payout_wallet ~ '^NQ[A-Z0-9]{34}$'),
    CONSTRAINT providers_payout_verification_pair CHECK ((payout_wallet IS NULL) = (payout_verified_at IS NULL))
);
CREATE INDEX providers_owner_idx ON providers(owner_identity_id);

CREATE TABLE services (
    id uuid PRIMARY KEY,
    provider_id uuid NOT NULL REFERENCES providers(id),
    name varchar(160) NOT NULL,
    description text NOT NULL DEFAULT '',
    status varchar(16) NOT NULL DEFAULT 'DRAFT',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT services_name_nonempty CHECK (length(btrim(name)) > 0),
    CONSTRAINT services_status_valid CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    CONSTRAINT services_provider_id_unique UNIQUE (provider_id, id)
);
CREATE INDEX services_provider_idx ON services(provider_id);

CREATE TABLE packages (
    id uuid PRIMARY KEY,
    provider_id uuid NOT NULL REFERENCES providers(id),
    service_id uuid NOT NULL,
    title varchar(160) NOT NULL,
    description text NOT NULL DEFAULT '',
    session_count integer NOT NULL,
    price_luna bigint NOT NULL,
    currency varchar(3) NOT NULL DEFAULT 'NIM',
    expiration_at timestamptz,
    status varchar(16) NOT NULL DEFAULT 'DRAFT',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT packages_service_provider_fk FOREIGN KEY (provider_id, service_id) REFERENCES services(provider_id, id),
    CONSTRAINT packages_title_nonempty CHECK (length(btrim(title)) > 0),
    CONSTRAINT packages_sessions_positive CHECK (session_count > 0),
    CONSTRAINT packages_price_positive CHECK (price_luna > 0),
    CONSTRAINT packages_currency_nim CHECK (currency = 'NIM'),
    CONSTRAINT packages_status_valid CHECK (status IN ('DRAFT', 'ACTIVE', 'UNAVAILABLE', 'ARCHIVED')),
    CONSTRAINT packages_provider_service_id_unique UNIQUE (id, provider_id, service_id)
);
CREATE INDEX packages_public_idx ON packages(provider_id, status, created_at DESC);
CREATE INDEX packages_service_idx ON packages(service_id);

CREATE TABLE purchases (
    id uuid PRIMARY KEY,
    customer_context_id uuid NOT NULL,
    expected_wallet varchar(36),
    package_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    service_id uuid NOT NULL,
    package_title_snapshot varchar(160) NOT NULL,
    service_name_snapshot varchar(160) NOT NULL,
    provider_name_snapshot varchar(160) NOT NULL,
    purchased_sessions integer NOT NULL,
    expected_price_luna bigint NOT NULL,
    currency varchar(3) NOT NULL DEFAULT 'NIM',
    recipient_wallet varchar(36) NOT NULL,
    network varchar(8) NOT NULL,
    expiration_at_snapshot timestamptz,
    payment_reference varchar(64) NOT NULL UNIQUE,
    idempotency_key varchar(128),
    status varchar(32) NOT NULL,
    transaction_hash varchar(64) UNIQUE,
    verified_sender_wallet varchar(36),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    submitted_at timestamptz,
    confirmed_at timestamptz,
    CONSTRAINT purchases_package_relation_fk FOREIGN KEY (package_id, provider_id, service_id) REFERENCES packages(id, provider_id, service_id),
    CONSTRAINT purchases_sessions_positive CHECK (purchased_sessions > 0),
    CONSTRAINT purchases_price_positive CHECK (expected_price_luna > 0),
    CONSTRAINT purchases_currency_nim CHECK (currency = 'NIM'),
    CONSTRAINT purchases_network_valid CHECK (network IN ('TESTNET', 'MAINNET')),
    CONSTRAINT purchases_status_valid CHECK (status IN ('CREATED', 'PAYMENT_PENDING', 'TRANSACTION_SUBMITTED', 'VERIFYING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'EXPIRED')),
    CONSTRAINT purchases_reference_shape CHECK (payment_reference ~ '^NP:[0-9a-f]{32}$'),
    CONSTRAINT purchases_hash_shape CHECK (transaction_hash IS NULL OR transaction_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT purchases_wallet_shapes CHECK (
        (expected_wallet IS NULL OR expected_wallet ~ '^NQ[A-Z0-9]{34}$')
        AND recipient_wallet ~ '^NQ[A-Z0-9]{34}$'
        AND (verified_sender_wallet IS NULL OR verified_sender_wallet ~ '^NQ[A-Z0-9]{34}$')
    ),
    CONSTRAINT purchases_expiration_after_creation CHECK (expires_at > created_at),
    CONSTRAINT purchases_confirmed_fields CHECK (
        status <> 'CONFIRMED' OR (transaction_hash IS NOT NULL AND verified_sender_wallet IS NOT NULL AND confirmed_at IS NOT NULL)
    ),
    CONSTRAINT purchases_pass_relation_unique UNIQUE (id, package_id, provider_id, service_id, verified_sender_wallet)
);
CREATE INDEX purchases_customer_context_idx ON purchases(customer_context_id, created_at DESC);
CREATE INDEX purchases_package_idx ON purchases(package_id);
CREATE INDEX purchases_status_expiry_idx ON purchases(status, expires_at);
CREATE UNIQUE INDEX purchases_context_idempotency_idx ON purchases(customer_context_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE passes (
    id uuid PRIMARY KEY,
    purchase_id uuid NOT NULL UNIQUE REFERENCES purchases(id),
    package_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    service_id uuid NOT NULL,
    owner_wallet varchar(36) NOT NULL,
    package_title_snapshot varchar(160) NOT NULL,
    service_name_snapshot varchar(160) NOT NULL,
    provider_name_snapshot varchar(160) NOT NULL,
    price_luna_snapshot bigint NOT NULL,
    currency varchar(3) NOT NULL DEFAULT 'NIM',
    original_sessions integer NOT NULL,
    used_sessions integer NOT NULL DEFAULT 0,
    remaining_sessions integer NOT NULL,
    status varchar(16) NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz,
    completed_at timestamptz,
    CONSTRAINT passes_package_relation_fk FOREIGN KEY (package_id, provider_id, service_id) REFERENCES packages(id, provider_id, service_id),
    CONSTRAINT passes_verified_purchase_fk FOREIGN KEY (purchase_id, package_id, provider_id, service_id, owner_wallet) REFERENCES purchases(id, package_id, provider_id, service_id, verified_sender_wallet),
    CONSTRAINT passes_owner_shape CHECK (owner_wallet ~ '^NQ[A-Z0-9]{34}$'),
    CONSTRAINT passes_price_positive CHECK (price_luna_snapshot > 0),
    CONSTRAINT passes_currency_nim CHECK (currency = 'NIM'),
    CONSTRAINT passes_original_positive CHECK (original_sessions > 0),
    CONSTRAINT passes_used_nonnegative CHECK (used_sessions >= 0),
    CONSTRAINT passes_remaining_nonnegative CHECK (remaining_sessions >= 0),
    CONSTRAINT passes_balance_consistent CHECK (used_sessions + remaining_sessions = original_sessions),
    CONSTRAINT passes_status_valid CHECK (status IN ('ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
    CONSTRAINT passes_completed_balance CHECK (status <> 'COMPLETED' OR (remaining_sessions = 0 AND completed_at IS NOT NULL)),
    CONSTRAINT passes_active_balance CHECK (status <> 'ACTIVE' OR remaining_sessions > 0),
    CONSTRAINT passes_expired_has_date CHECK (status <> 'EXPIRED' OR expires_at IS NOT NULL),
    CONSTRAINT passes_provider_owner_unique UNIQUE (id, provider_id, owner_wallet)
);
CREATE INDEX passes_owner_status_idx ON passes(owner_wallet, status, created_at DESC);
CREATE INDEX passes_provider_status_idx ON passes(provider_id, status, created_at DESC);

CREATE TABLE redemption_challenges (
    id uuid PRIMARY KEY,
    pass_id uuid NOT NULL REFERENCES passes(id),
    provider_id uuid NOT NULL REFERENCES providers(id),
    owner_wallet varchar(36) NOT NULL,
    nonce uuid NOT NULL UNIQUE,
    status varchar(16) NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    authorized_at timestamptz,
    consumed_at timestamptz,
    CONSTRAINT redemption_challenges_pass_context_fk FOREIGN KEY (pass_id, provider_id, owner_wallet) REFERENCES passes(id, provider_id, owner_wallet),
    CONSTRAINT redemption_challenges_wallet_shape CHECK (owner_wallet ~ '^NQ[A-Z0-9]{34}$'),
    CONSTRAINT redemption_challenges_status_valid CHECK (status IN ('CREATED', 'AUTHORIZED', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
    CONSTRAINT redemption_challenges_expiry CHECK (expires_at > created_at),
    CONSTRAINT redemption_challenges_authorized CHECK (status NOT IN ('AUTHORIZED', 'CONSUMED') OR authorized_at IS NOT NULL),
    CONSTRAINT redemption_challenges_consumed CHECK (status <> 'CONSUMED' OR consumed_at IS NOT NULL),
    CONSTRAINT redemption_challenges_context_unique UNIQUE (id, pass_id, provider_id, owner_wallet)
);
CREATE UNIQUE INDEX redemption_challenges_one_active_per_pass_idx ON redemption_challenges(pass_id) WHERE status IN ('CREATED', 'AUTHORIZED');
CREATE INDEX redemption_challenges_expiry_idx ON redemption_challenges(status, expires_at);

CREATE TABLE redemptions (
    id uuid PRIMARY KEY,
    challenge_id uuid NOT NULL UNIQUE REFERENCES redemption_challenges(id),
    pass_id uuid NOT NULL REFERENCES passes(id),
    provider_id uuid NOT NULL REFERENCES providers(id),
    owner_wallet varchar(36) NOT NULL,
    session_ordinal integer NOT NULL,
    sessions_consumed integer NOT NULL DEFAULT 1,
    consumed_at timestamptz NOT NULL,
    CONSTRAINT redemptions_challenge_context_fk FOREIGN KEY (challenge_id, pass_id, provider_id, owner_wallet) REFERENCES redemption_challenges(id, pass_id, provider_id, owner_wallet),
    CONSTRAINT redemptions_wallet_shape CHECK (owner_wallet ~ '^NQ[A-Z0-9]{34}$'),
    CONSTRAINT redemptions_one_session CHECK (sessions_consumed = 1),
    CONSTRAINT redemptions_ordinal_positive CHECK (session_ordinal > 0),
    CONSTRAINT redemptions_pass_ordinal_unique UNIQUE (pass_id, session_ordinal)
);
CREATE INDEX redemptions_pass_history_idx ON redemptions(pass_id, consumed_at DESC);
CREATE INDEX redemptions_provider_history_idx ON redemptions(provider_id, consumed_at DESC);
