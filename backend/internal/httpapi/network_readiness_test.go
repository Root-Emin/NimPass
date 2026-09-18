package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nimpass/backend/internal/config"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// chainEndpoint stands in for a Nimiq PoS RPC serving one named chain.
//
// `getNetworkId` is refused the way the public gateways refuse it — both
// rpc.nimiqwatch.com and rpc.testnet.nimiqwatch.com keep it outside their
// allowlist (verified 2026-09-18) — so these tests exercise the block fallback,
// which is the path a real deployment takes.
func chainEndpoint(t *testing.T, network string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Method string `json:"method"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		if body.Method == "getNetworkId" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","error":"Method not allowed","id":1}`))
			return
		}
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":{"hash":"` + strings.Repeat("a", 64) + `","number":61952312,"timestamp":1789756475456,"network":"` + network + `","type":"micro"}}}`))
	}))
	t.Cleanup(server.Close)
	return server
}

func readiness(t *testing.T, cfg config.Config) (int, map[string]any) {
	t.Helper()
	pool := httpTestPool(t)
	cfg.PublicOrigin = "http://localhost:5173"
	cfg.ConfirmationPolicy = domain.ConfirmOnInclusion
	router := NewRouterWithChain(pool, slog.Default(), cfg, nimiq.NewRPCClient(cfg.RPCURL))
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("readiness body is not JSON: %s", rr.Body.String())
	}
	return rr.Code, body
}

// A deployment pointed at the wrong chain must not take traffic.
//
// Configuration alone cannot catch this: it only proves what the operator
// wrote. Pointing a Mainnet deployment at a Testnet endpoint is one subdomain's
// difference — rpc.nimiqwatch.com against rpc.testnet.nimiqwatch.com — and
// without this check it would surface as purchases that mysteriously never
// settle rather than as a misconfiguration.
func TestReadinessFailsClosedOnANetworkMismatch(t *testing.T) {
	testnet := chainEndpoint(t, "TestAlbatross")
	status, body := readiness(t, config.Config{Environment: "production", Network: "MAINNET", RPCURL: testnet.URL})
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 for a Mainnet deployment reading a Testnet node", status)
	}
	if failureCode(body) != "NIMIQ_NETWORK_MISMATCH" {
		t.Fatalf("code = %q, want NIMIQ_NETWORK_MISMATCH: %v", failureCode(body), body)
	}

	// And the same mistake the other way round.
	mainnet := chainEndpoint(t, "MainAlbatross")
	status, body = readiness(t, config.Config{Environment: "development", Network: "TESTNET", RPCURL: mainnet.URL})
	if status != http.StatusServiceUnavailable || failureCode(body) != "NIMIQ_NETWORK_MISMATCH" {
		t.Fatalf("a Testnet deployment reading a Mainnet node was reported ready: %d %v", status, body)
	}
}

// The matching endpoint is reported ready, and says which chain it proved.
func TestReadinessReportsTheProvenChain(t *testing.T) {
	for _, tc := range []struct {
		environment string
		network     string
		chain       string
	}{
		{"production", "MAINNET", "MainAlbatross"},
		{"development", "TESTNET", "TestAlbatross"},
	} {
		t.Run(tc.network, func(t *testing.T) {
			endpoint := chainEndpoint(t, tc.chain)
			status, body := readiness(t, config.Config{Environment: tc.environment, Network: tc.network, RPCURL: endpoint.URL})
			if status != http.StatusOK {
				t.Fatalf("status = %d, want 200: %v", status, body)
			}
			if body["network"] != tc.network {
				t.Fatalf("network = %v, want %s", body["network"], tc.network)
			}
			chain, ok := body["nimiq"].(map[string]any)
			if !ok {
				t.Fatalf("readiness must report the chain it proved: %v", body)
			}
			if chain["status"] != nimiq.NetworkVerified || chain["observedChain"] != tc.chain {
				t.Fatalf("nimiq = %v, want a verified %s", chain, tc.chain)
			}
			// Diagnostics, not configuration disclosure: readiness is read by
			// far more people than the environment file is.
			if strings.Contains(strings.ToLower(jsonOf(t, body)), strings.ToLower(endpoint.URL)) {
				t.Fatalf("readiness disclosed the RPC endpoint: %v", body)
			}
		})
	}
}

// An unreachable node is uncertainty, not a wrong chain. The instance stays
// ready — public browsing keeps working and reconciliation retries — and says
// plainly that it could not prove the network.
func TestReadinessStaysUpWhenTheChainCannotBeReached(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer down.Close()

	status, body := readiness(t, config.Config{Environment: "production", Network: "MAINNET", RPCURL: down.URL})
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200: an RPC outage is not a wrong network", status)
	}
	chain, _ := body["nimiq"].(map[string]any)
	if chain["status"] != nimiq.NetworkUnverified {
		t.Fatalf("nimiq = %v, want %q", chain, nimiq.NetworkUnverified)
	}
	if chain["observedChain"] != "" {
		t.Fatalf("an unreachable node must not be reported as serving a chain: %v", chain)
	}
}

// failureCode reads the error code out of the API's standard failure envelope.
func failureCode(body map[string]any) string {
	failure, ok := body["error"].(map[string]any)
	if !ok {
		return ""
	}
	code, _ := failure["code"].(string)
	return code
}

func jsonOf(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
