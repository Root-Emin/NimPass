package config

import (
	"testing"

	"nimpass/backend/internal/domain"
)

func TestParseRequiresSafeDatabaseConfiguration(t *testing.T) {
	cases := []struct {
		name   string
		values map[string]string
		valid  bool
	}{
		{"missing database", nil, false},
		{"missing environment", map[string]string{"NIMIQ_NETWORK": "TESTNET", "DATABASE_URL": "postgres://user:pass@localhost:5432/nimpass?sslmode=disable", "PUBLIC_ORIGIN": "http://localhost:5173", "SESSION_COOKIE_MODE": "local-insecure", "NIMIQ_RPC_URL": "http://localhost:8648"}, false},
		{"missing network", map[string]string{"APP_ENV": "development", "DATABASE_URL": "postgres://user:pass@localhost:5432/nimpass?sslmode=disable", "PUBLIC_ORIGIN": "http://localhost:5173", "SESSION_COOKIE_MODE": "local-insecure", "NIMIQ_RPC_URL": "http://localhost:8648"}, false},
		{"invalid database", map[string]string{"DATABASE_URL": "http://localhost/app"}, false},
		{"production without TLS", map[string]string{"APP_ENV": "production", "DATABASE_URL": "postgres://user:pass@localhost:5432/nimpass?sslmode=disable"}, false},
		{"valid development", map[string]string{"APP_ENV": "development", "NIMIQ_NETWORK": "TESTNET", "DATABASE_URL": "postgres://user:pass@localhost:5432/nimpass?sslmode=disable", "PUBLIC_ORIGIN": "http://localhost:5173", "SESSION_COOKIE_MODE": "local-insecure", "NIMIQ_RPC_URL": "http://localhost:8648"}, true},
		{"valid trusted proxies", map[string]string{"APP_ENV": "development", "NIMIQ_NETWORK": "TESTNET", "DATABASE_URL": "postgres://user:pass@localhost:5432/nimpass?sslmode=disable", "PUBLIC_ORIGIN": "http://localhost:5173", "SESSION_COOKIE_MODE": "local-insecure", "NIMIQ_RPC_URL": "http://localhost:8648", "TRUSTED_PROXY_CIDRS": "10.0.0.0/8, 192.0.2.0/24"}, true},
		{"invalid trusted proxy", map[string]string{"APP_ENV": "development", "NIMIQ_NETWORK": "TESTNET", "DATABASE_URL": "postgres://user:pass@localhost:5432/nimpass?sslmode=disable", "PUBLIC_ORIGIN": "http://localhost:5173", "SESSION_COOKIE_MODE": "local-insecure", "NIMIQ_RPC_URL": "http://localhost:8648", "TRUSTED_PROXY_CIDRS": "not-a-cidr"}, false},
		{"production cannot use insecure cookie", map[string]string{"APP_ENV": "production", "DATABASE_URL": "postgres://user:pass@localhost:5432/nimpass?sslmode=require", "PUBLIC_ORIGIN": "https://app.example", "SESSION_COOKIE_MODE": "local-insecure"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse(func(key string) string { return tc.values[key] })
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
		})
	}
}

func TestProductionConfigurationFailFast(t *testing.T) {
	base := map[string]string{"APP_ENV": "production", "DATABASE_URL": "postgres://user:secret@db.example/nimpass?sslmode=verify-full", "NIMIQ_NETWORK": "MAINNET", "NIMIQ_RPC_URL": "https://rpc.example", "PUBLIC_ORIGIN": "https://app.example", "NIMIQ_SIGNING_SCHEME": "raw"}
	if _, err := Parse(func(k string) string { return base[k] }); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ key, value string }{{"NIMIQ_NETWORK", "TESTNET"}, {"DATABASE_URL", "postgres://user:secret@db.example/nimpass"}, {"DATABASE_URL", "postgres://user:secret@db.example/nimpass?sslmode=prefer"}, {"SESSION_COOKIE_MODE", "local-insecure"}, {"PUBLIC_ORIGIN", "https://user:secret@app.example"}, {"PUBLIC_ORIGIN", "*"}, {"NIMIQ_RPC_URL", "http://rpc.example"}, {"NIMIQ_SIGNING_SCHEME", "auto"}, {"NIMIQ_CONFIRMATION_POLICY", "micro"}, {"NIMIQ_CONFIRMATION_POLICY", "INCLUSION"}, {"NIMIQ_CONFIRMATION_POLICY", "mempool"}, {"NIMIQ_CONFIRMATION_POLICY", "true"}} {
		t.Run(tc.key+tc.value, func(t *testing.T) {
			if _, err := Parse(func(k string) string {
				if k == tc.key {
					return tc.value
				}
				return base[k]
			}); err == nil {
				t.Fatal("unsafe production config accepted")
			}
		})
	}
}

// The settlement rule is a risk decision, so it has to be readable off the
// configuration and impossible to set by accident.
func TestConfirmationPolicyIsExplicitOrTheDocumentedDefault(t *testing.T) {
	base := map[string]string{"APP_ENV": "development", "NIMIQ_NETWORK": "TESTNET", "DATABASE_URL": "postgres://user@localhost/nimpass_test?sslmode=disable", "NIMIQ_RPC_URL": "http://127.0.0.1:8648", "PUBLIC_ORIGIN": "http://localhost:5173"}
	parse := func(policy string) (Config, error) {
		return Parse(func(k string) string {
			if k == "NIMIQ_CONFIRMATION_POLICY" {
				return policy
			}
			return base[k]
		})
	}
	// Unset is the product's rule (ADR-021), stated once in configuration
	// rather than guessed at each call site.
	cfg, err := parse("")
	if err != nil || cfg.ConfirmationPolicy != domain.ConfirmOnInclusion {
		t.Fatalf("default policy: %q %v", cfg.ConfirmationPolicy, err)
	}
	for _, policy := range []domain.ConfirmationPolicy{domain.ConfirmOnInclusion, domain.ConfirmOnFinality} {
		cfg, err := parse(string(policy))
		if err != nil || cfg.ConfirmationPolicy != policy {
			t.Fatalf("%s: %q %v", policy, cfg.ConfirmationPolicy, err)
		}
	}
	// Anything else is a startup failure, never a fallback. A typo must not
	// quietly pick a risk posture.
	// Case and unknown words are both refused. Surrounding whitespace is not
	// in that list: `fallback` trims it, as it does for every other value
	// here, because a stray space in a deployment's environment is not a
	// different risk policy.
	for _, invalid := range []string{"micro", "INCLUSION", "Finality", "mempool", "0", "none", "inclusion,finality"} {
		if _, err := parse(invalid); err == nil {
			t.Fatalf("accepted confirmation policy %q", invalid)
		}
	}
}

func TestDevelopmentRejectsMainnet(t *testing.T) {
	values := map[string]string{"APP_ENV": "development", "NIMIQ_NETWORK": "MAINNET", "DATABASE_URL": "postgres://user@localhost/nimpass_test?sslmode=disable"}
	if _, err := Parse(func(k string) string { return values[k] }); err == nil {
		t.Fatal("development MAINNET accepted")
	}
}
