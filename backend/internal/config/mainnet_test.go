package config

import (
	"strings"
	"testing"
)

// production ⇔ MAINNET, as one table rather than as four scattered assertions.
//
// This is the invariant the whole Mainnet migration rests on: there is no
// configuration in which a production deployment settles against Testnet, and
// none in which a development deployment touches real NIM. Both directions are
// refused at startup, so neither can be reached by editing one variable.
func TestEnvironmentAndNetworkAreBoundToEachOther(t *testing.T) {
	for _, tc := range []struct {
		environment string
		network     string
		accepted    bool
	}{
		{"production", "MAINNET", true},
		{"production", "TESTNET", false},
		{"development", "TESTNET", true},
		{"development", "MAINNET", false},
		{"test", "TESTNET", true},
		{"test", "MAINNET", false},
		{"staging", "MAINNET", false},
		{"production", "", false},
		{"production", "mainnet", false},
	} {
		t.Run(tc.environment+"/"+tc.network, func(t *testing.T) {
			_, err := Parse(env(tc.environment, tc.network, nil))
			if (err == nil) != tc.accepted {
				t.Fatalf("accepted=%v, err=%v", err == nil, err)
			}
		})
	}
}

// A production Mainnet configuration that is complete and safe must actually
// parse — a fail-closed rule that also refuses the correct answer is not a
// safety property, it is an outage.
func TestProductionMainnetConfigurationIsUsable(t *testing.T) {
	cfg, err := Parse(env("production", "MAINNET", nil))
	if err != nil {
		t.Fatalf("a complete production Mainnet configuration was refused: %v", err)
	}
	if cfg.Network != "MAINNET" || cfg.Environment != "production" {
		t.Fatalf("cfg = %+v", cfg)
	}
	if !cfg.CookieSecure {
		t.Fatal("production must issue Secure cookies")
	}
}

// The RPC endpoint is the only thing standing between a Mainnet purchase and
// the wrong ledger, so production refuses every shape that would weaken it:
// absent, plaintext, or carrying a query/fragment that could redirect it.
func TestProductionRPCEndpointIsFixedAndEncrypted(t *testing.T) {
	for _, tc := range []struct {
		name     string
		rpc      string
		accepted bool
	}{
		{"https mainnet gateway", "https://rpc.nimiqwatch.com", true},
		{"https own node", "https://nimiq-rpc.internal.example", true},
		{"missing", "", false},
		{"plaintext", "http://rpc.example", false},
		{"plaintext loopback", "http://127.0.0.1:8648", false},
		{"query string", "https://rpc.example?token=secret", false},
		{"fragment", "https://rpc.example#node", false},
		{"not a url", "rpc.example", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse(env("production", "MAINNET", map[string]string{"NIMIQ_RPC_URL": tc.rpc}))
			if (err == nil) != tc.accepted {
				t.Fatalf("accepted=%v, err=%v", err == nil, err)
			}
		})
	}

	// Development keeps the local node it has always used. The looser rule is
	// scoped to loopback, so "it worked locally" can never be the reason a
	// production deployment reads plaintext RPC.
	if _, err := Parse(env("development", "TESTNET", map[string]string{"NIMIQ_RPC_URL": "http://127.0.0.1:8648"})); err != nil {
		t.Fatalf("the local development node must stay usable: %v", err)
	}
	if _, err := Parse(env("development", "TESTNET", map[string]string{"NIMIQ_RPC_URL": "http://rpc.example"})); err == nil {
		t.Fatal("plaintext RPC to a remote host was accepted in development")
	}
}

// The error a misconfigured operator reads has to name the rule, not merely
// refuse. It must also never quote the value back, because these strings reach
// logs and the database URL is a credential.
func TestConfigurationRefusalsExplainWithoutLeaking(t *testing.T) {
	_, err := Parse(env("production", "TESTNET", nil))
	if err == nil {
		t.Fatal("production TESTNET accepted")
	}
	message := err.Error()
	if !strings.Contains(message, "MAINNET") || !strings.Contains(message, "TESTNET") {
		t.Fatalf("refusal does not name the rule: %q", message)
	}
	if strings.Contains(message, "secret") {
		t.Fatalf("refusal leaked a credential: %q", message)
	}
}

// env builds a complete, otherwise-valid configuration for one
// environment/network pair, with overrides applied last.
func env(environment, network string, overrides map[string]string) func(string) string {
	values := map[string]string{
		"APP_ENV":              environment,
		"NIMIQ_NETWORK":        network,
		"DATABASE_URL":         "postgres://user:secret@db.example/nimpass?sslmode=verify-full",
		"NIMIQ_RPC_URL":        "https://rpc.example",
		"PUBLIC_ORIGIN":        "https://app.example",
		"NIMIQ_SIGNING_SCHEME": "hub",
	}
	if environment != "production" {
		values["DATABASE_URL"] = "postgres://user@localhost/nimpass_test?sslmode=disable"
		values["PUBLIC_ORIGIN"] = "http://localhost:5173"
		values["SESSION_COOKIE_MODE"] = "local-insecure"
		values["NIMIQ_RPC_URL"] = "http://127.0.0.1:8648"
	}
	for key, value := range overrides {
		values[key] = value
	}
	return func(key string) string { return values[key] }
}
