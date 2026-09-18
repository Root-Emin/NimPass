-- One database is one deployment context. Never reinterpret Testnet purchases
-- or development authentication sessions as production/Mainnet data.
CREATE TABLE deployment_context (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 network varchar(8) NOT NULL CHECK (network IN ('TESTNET','MAINNET')),
 environment varchar(16) NOT NULL CHECK (environment IN ('development','test','production'))
);
ALTER TABLE verified_payments ADD CONSTRAINT verified_payments_network_valid CHECK (network IN ('TESTNET','MAINNET'));
ALTER TABLE verified_payments ADD CONSTRAINT verified_payments_time_ordered CHECK (finalized_at >= included_at);
