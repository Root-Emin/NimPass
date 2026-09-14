package config

import "testing"

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
