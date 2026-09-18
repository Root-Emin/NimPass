package nimiq

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The two network identities Nimpass can be configured for, exactly as the
// chain spells them.
//
// These constants are how a Mainnet deployment recognises its own chain, and
// getting either wrong would mean either refusing every real payment or — far
// worse — accepting a Testnet one. They are checked against the live network
// rather than against memory: Mainnet answers `getLatestBlock` with
// `"network":"MainAlbatross"` and stamps `"networkId":24` on every transaction
// (verified against https://rpc.nimiqwatch.com, 2026-09-18); Testnet answers
// `TestAlbatross` / 5.
func TestNetworkIdentitiesMatchTheChains(t *testing.T) {
	for _, tc := range []struct {
		network string
		name    string
		id      uint8
	}{
		{"MAINNET", "MainAlbatross", 24},
		{"TESTNET", "TestAlbatross", 5},
	} {
		name, id, err := ExpectedNetworkID(tc.network)
		if err != nil {
			t.Fatalf("%s: %v", tc.network, err)
		}
		if name != tc.name || id != tc.id {
			t.Fatalf("%s = (%q, %d), want (%q, %d)", tc.network, name, id, tc.name, tc.id)
		}
	}
	if _, _, err := ExpectedNetworkID("DEVNET"); err == nil {
		t.Fatal("an unknown network must be refused, not defaulted")
	}
}

// chainServer answers the handful of methods the network proof uses, as one
// named chain.
//
// `blockOnly` reproduces the public gateways: rpc.nimiqwatch.com and
// rpc.testnet.nimiqwatch.com both keep `getNetworkId` outside their allowlist
// and answer it with a bare `{"error":"Method not allowed"}` (verified
// 2026-09-18), so the chain has to be proven from a block instead.
func chainServer(t *testing.T, network string, blockOnly bool) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Method string `json:"method"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		if body.Method == "getNetworkId" {
			if blockOnly {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"jsonrpc":"2.0","error":"Method not allowed","id":1}`))
				return
			}
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":"` + network + `"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":{"hash":"` + strings.Repeat("a", 64) + `","number":61952312,"timestamp":1789756475456,"network":"` + network + `","type":"micro"}}}`))
	}))
	t.Cleanup(server.Close)
	return server
}

func probeOf(t *testing.T, server *httptest.Server, network string) NetworkProbe {
	t.Helper()
	return (&RPCClient{URL: server.URL, HTTP: server.Client()}).Probe(context.Background(), network)
}

// The invariant this whole migration rests on: neither chain can stand in for
// the other, whichever way round the mistake is made, and whether or not the
// endpoint serves getNetworkId.
func TestNetworksAreNotInterchangeable(t *testing.T) {
	for _, blockOnly := range []bool{false, true} {
		main := chainServer(t, "MainAlbatross", blockOnly)
		test := chainServer(t, "TestAlbatross", blockOnly)

		if got := probeOf(t, main, "MAINNET"); got.Status != NetworkVerified {
			t.Fatalf("blockOnly=%v: a Mainnet endpoint must verify a Mainnet deployment, got %+v", blockOnly, got)
		}
		if got := probeOf(t, test, "TESTNET"); got.Status != NetworkVerified {
			t.Fatalf("blockOnly=%v: a Testnet endpoint must verify a Testnet deployment, got %+v", blockOnly, got)
		}

		crossed := probeOf(t, test, "MAINNET")
		if crossed.Status != NetworkMismatch {
			t.Fatalf("blockOnly=%v: a Testnet endpoint must not satisfy a Mainnet deployment, got %+v", blockOnly, crossed)
		}
		if !errors.Is(crossed.Err(), ErrRPCNetworkMismatch) {
			t.Fatalf("blockOnly=%v: a mismatch must be reportable as ErrRPCNetworkMismatch, got %v", blockOnly, crossed.Err())
		}
		if crossed.Expected != "MainAlbatross" || crossed.Observed != "TestAlbatross" {
			t.Fatalf("blockOnly=%v: a mismatch must name both chains, got %+v", blockOnly, crossed)
		}

		reversed := probeOf(t, main, "TESTNET")
		if reversed.Status != NetworkMismatch {
			t.Fatalf("blockOnly=%v: a Mainnet endpoint must not satisfy a Testnet deployment, got %+v", blockOnly, reversed)
		}

		// The same refusal through the path everything else uses.
		if err := (&RPCClient{URL: test.URL, HTTP: test.Client()}).CheckNetwork(context.Background(), "MAINNET"); !errors.Is(err, ErrRPCNetworkMismatch) {
			t.Fatalf("blockOnly=%v: CheckNetwork err = %v, want ErrRPCNetworkMismatch", blockOnly, err)
		}
	}
}

// An endpoint that cannot be read is uncertainty, never approval and never a
// mismatch. This is the difference between "the gateway is busy" and "this
// deployment is pointed at the wrong ledger", and conflating them either takes
// a healthy service down or lets a misconfigured one run.
func TestUnreadableEndpointIsUnverifiedNotMismatched(t *testing.T) {
	for _, tc := range []struct {
		name    string
		handler http.HandlerFunc
		cause   error
	}{
		{"throttled", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTooManyRequests)
		}, ErrRPCRateLimited},
		{"outage", func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "down", http.StatusServiceUnavailable)
		}, ErrRPCUnavailable},
		{"malformed", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":{`))
		}, ErrRPCMalformed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(tc.handler)
			defer server.Close()
			probe := probeOf(t, server, "MAINNET")
			if probe.Status != NetworkUnverified {
				t.Fatalf("status = %q, want %q", probe.Status, NetworkUnverified)
			}
			if probe.Observed != "" {
				t.Fatalf("an unreadable endpoint must not report an observed chain, got %q", probe.Observed)
			}
			if errors.Is(probe.Err(), ErrRPCNetworkMismatch) {
				t.Fatal("an unreadable endpoint must never be reported as a wrong-network mismatch")
			}
			// The cause survives, because startup treats a malformed reply as
			// a configuration error and a 429 as weather.
			if !errors.Is(probe.Cause, tc.cause) {
				t.Fatalf("cause = %v, want %v", probe.Cause, tc.cause)
			}
		})
	}
}

// A verified network may be remembered; a failure may not. Readiness is polled
// by infrastructure, and a probe that spent RPC budget on every poll would be
// taking it from the settlement that is waiting on the same window.
func TestProbeReusesProofButNeverRemembersFailure(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			Method string `json:"method"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		if body.Method == "getNetworkId" {
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":"MainAlbatross"}}`))
			return
		}
		http.Error(w, "unexpected", 400)
	}))
	defer server.Close()

	client := &RPCClient{URL: server.URL, HTTP: server.Client()}
	if got := client.Probe(context.Background(), "MAINNET"); got.Status != NetworkVerified {
		t.Fatalf("first probe = %+v", got)
	}
	after := calls
	second := client.Probe(context.Background(), "MAINNET")
	if second.Status != NetworkVerified || second.Source != "cached" {
		t.Fatalf("second probe = %+v, want a cached verification", second)
	}
	if calls != after {
		t.Fatalf("a proven network must not be re-asked within its TTL: %d extra calls", calls-after)
	}

	// A different network is not covered by that proof, and must be asked.
	if got := client.Probe(context.Background(), "TESTNET"); got.Status != NetworkMismatch {
		t.Fatalf("a proof of one chain must not vouch for the other: %+v", got)
	}
}

// Mainnet transactions carry networkId 24. A Testnet one (5) presented to a
// Mainnet deployment must be refused by the adapter before any economic check
// runs, so a wrong-chain transaction can never become evidence.
func TestInspectRefusesAForeignNetworkTransaction(t *testing.T) {
	tx := rpcTx() // networkId 5, the Testnet stamp
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Method string `json:"method"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		switch body.Method {
		case "getNetworkId":
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":"MainAlbatross"}}`))
		case "isConsensusEstablished":
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":true}}`))
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"data": tx}})
		}
	}))
	defer server.Close()

	_, err := (&RPCClient{URL: server.URL, HTTP: server.Client()}).Inspect(context.Background(), strings.Repeat("a", 64), "MAINNET")
	if !errors.Is(err, ErrRPCMalformed) {
		t.Fatalf("err = %v, want the transaction refused as under-described rather than accepted", err)
	}
}
