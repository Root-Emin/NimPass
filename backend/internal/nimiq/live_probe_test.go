package nimiq

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

// Opt-in probe against a real endpoint. Skipped unless NIMIQ_LIVE_RPC is set.
func TestLiveRPCProbe(t *testing.T) {
	url := os.Getenv("NIMIQ_LIVE_RPC")
	if url == "" {
		t.Skip("set NIMIQ_LIVE_RPC to probe a real endpoint")
	}
	network := os.Getenv("NIMIQ_LIVE_NETWORK")
	if network == "" {
		network = "MAINNET"
	}
	c := NewRPCClient(url)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()

	if err := c.CheckNetwork(ctx, network); err != nil {
		t.Fatalf("CheckNetwork: %v", err)
	}
	t.Log("CheckNetwork OK (fallback path exercised if getNetworkId is blocked)")

	txs, err := c.TransactionsByAddress(ctx, "NQ07 0000 0000 0000 0000 0000 0000 0000 0000", network)
	if err != nil {
		t.Fatalf("TransactionsByAddress: %v", err)
	}
	t.Logf("TransactionsByAddress returned %d usable transactions", len(txs))
	if len(txs) == 0 {
		t.Fatal("expected at least one transaction for the burn address")
	}
	first := txs[0]
	t.Logf("sample: hash=%s from=%q to=%q value=%d networkId=%d proof=%q",
		first.Hash, first.From, first.To, *first.Value, *first.NetworkID, first.Proof)
}

// TestLiveInspectProbe reads one real transaction end to end.
//
// The opt-in counterpart to the fixture tests: it drives the exact code a
// purchase's verification drives — network proof, consensus, the transaction,
// its block, the macro block after it, and the re-read that guards against a
// reorg — against a live node, on a hash the caller names.
//
//	NIMIQ_LIVE_RPC=http://127.0.0.1:8648 \
//	NIMIQ_LIVE_NETWORK=TESTNET \
//	NIMIQ_LIVE_TX=<64 hex> go test ./internal/nimiq -run TestLiveInspectProbe -v
func TestLiveInspectProbe(t *testing.T) {
	url := os.Getenv("NIMIQ_LIVE_RPC")
	hash := os.Getenv("NIMIQ_LIVE_TX")
	if url == "" || hash == "" {
		t.Skip("set NIMIQ_LIVE_RPC and NIMIQ_LIVE_TX to inspect a real transaction")
	}
	network := os.Getenv("NIMIQ_LIVE_NETWORK")
	if network == "" {
		network = "MAINNET"
	}
	c := NewRPCClient(url)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()

	evidence, err := c.Inspect(ctx, hash, network)
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	tx := evidence.Transaction
	if tx.NetworkID == nil || tx.Value == nil || tx.ExecutionResult == nil {
		t.Fatalf("under-described transaction: %+v", tx)
	}
	t.Logf("hash=%s networkId=%d from=%q to=%q value=%d executed=%t",
		tx.Hash, *tx.NetworkID, tx.From, tx.To, *tx.Value, *tx.ExecutionResult)
	t.Logf("inclusion=%d includedAt=%s finalityBlock=%d finalized=%t finalizedAt=%s",
		evidence.InclusionBlock, evidence.IncludedAt, evidence.FinalityBlock,
		evidence.Finalized, evidence.FinalizedAt)

	if evidence.InclusionBlock == 0 {
		t.Fatal("expected an included transaction")
	}
	if !evidence.Finalized {
		t.Fatal("a transaction this old must be finalized")
	}
	if evidence.FinalityBlock <= evidence.InclusionBlock {
		t.Fatalf("finality %d must follow inclusion %d", evidence.FinalityBlock, evidence.InclusionBlock)
	}
}

// TestLiveCrossNetworkEndpointIsRefused points a Testnet deployment at a
// Mainnet endpoint and requires it to be caught.
//
// This is the one configuration mistake that could settle a purchase against
// the wrong chain, and it is easy to make: rpc.nimiqwatch.com is the endpoint
// the official raw-RPC docs use in their examples, it is Mainnet, and it has
// no Testnet counterpart — so a developer following the docs while running a
// Testnet deployment has already made it.
//
// `getNetworkId` is not available to catch it with; that gateway keeps the
// method outside its allowlist. The fallback reads the network off a block,
// which is the chain's own statement rather than a node's self-report.
//
//	NIMIQ_LIVE_MAINNET_RPC=https://rpc.nimiqwatch.com \
//	go test ./internal/nimiq -run TestLiveCrossNetworkEndpointIsRefused -v
func TestLiveCrossNetworkEndpointIsRefused(t *testing.T) {
	url := os.Getenv("NIMIQ_LIVE_MAINNET_RPC")
	if url == "" {
		t.Skip("set NIMIQ_LIVE_MAINNET_RPC to a real Mainnet endpoint")
	}
	c := NewRPCClient(url)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()

	// It really is Mainnet...
	if err := c.CheckNetwork(ctx, "MAINNET"); err != nil {
		t.Fatalf("expected a live Mainnet endpoint: %v", err)
	}
	// ...and a Testnet deployment pointed at it is refused outright, with a
	// mismatch rather than a shrug.
	fresh := NewRPCClient(url)
	err := fresh.CheckNetwork(ctx, "TESTNET")
	if err == nil {
		t.Fatal("a Mainnet endpoint was accepted for a TESTNET deployment")
	}
	if errors.Is(err, ErrRPCUnavailable) || errors.Is(err, ErrRPCMethodNotAllowed) {
		t.Fatalf("a cross-network endpoint must be a mismatch, not an outage: %v", err)
	}
	t.Logf("TESTNET against a Mainnet endpoint refused with: %v", err)

	// And nothing can be read from it under the wrong network, so a
	// misconfigured deployment discovers nothing rather than discovering the
	// wrong chain's transactions.
	if _, err := fresh.TransactionsByAddress(ctx, "NQ07 0000 0000 0000 0000 0000 0000 0000 0000", "TESTNET"); err == nil {
		t.Fatal("an address query ran against the wrong chain")
	}
}
