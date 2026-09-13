package nimiq

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type rpcFixture struct {
	mu             sync.Mutex
	head           uint32
	missing        bool
	mempool        bool
	malformed      bool
	unavailable    bool
	reorgOnRecheck bool
	inclusionReads int
	tx             map[string]any
}

func (f *rpcFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.unavailable {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
		return
	}
	var req struct {
		JSONRPC string            `json:"jsonrpc"`
		ID      int               `json:"id"`
		Method  string            `json:"method"`
		Params  []json.RawMessage `json:"params"`
	}
	if json.NewDecoder(r.Body).Decode(&req) != nil || req.JSONRPC != "2.0" || req.ID != 1 || req.Params == nil {
		http.Error(w, "bad", 400)
		return
	}
	if f.malformed {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":{`))
		return
	}
	var data any
	switch req.Method {
	case "getNetworkId":
		data = "TestAlbatross"
	case "isConsensusEstablished":
		data = true
	case "getTransactionByHash":
		if f.missing {
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "error": map[string]any{"code": -32000, "message": "Transaction not found"}})
			return
		}
		data = f.tx
	case "getTransactionFromMempool":
		if !f.mempool {
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "error": map[string]any{"code": -32000, "message": "Transaction not found"}})
			return
		}
		data = f.tx
	case "getBlockByNumber":
		var height uint32
		_ = json.Unmarshal(req.Params[0], &height)
		if height == 100 {
			f.inclusionReads++
			blockHash := strings.Repeat("b", 64)
			if f.reorgOnRecheck && f.inclusionReads > 1 {
				blockHash = strings.Repeat("e", 64)
			}
			data = map[string]any{"hash": blockHash, "number": 100, "timestamp": uint64(1700000000000), "network": "TestAlbatross", "type": "micro", "transactions": []any{f.tx}}
		} else {
			data = map[string]any{"hash": strings.Repeat("c", 64), "number": 120, "timestamp": uint64(1700000001000), "network": "TestAlbatross", "type": "macro"}
		}
	case "getMacroBlockAfter":
		data = uint32(120)
	case "getLatestBlock":
		data = map[string]any{"hash": strings.Repeat("d", 64), "number": f.head, "network": "TestAlbatross", "type": "micro"}
	default:
		http.Error(w, "unknown", 400)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"data": data, "metadata": map[string]any{}}})
}

func rpcTx() map[string]any {
	return map[string]any{"hash": strings.Repeat("a", 64), "blockNumber": 100, "timestamp": uint64(1700000000000), "from": "NQ60000000000000000000000000000000", "fromType": 0, "to": "NQ60000000000000000000000000000000", "toType": 0, "value": 12340000, "senderData": "", "recipientData": "4e50313a616263", "flags": 0, "proof": "aa", "networkId": 5, "executionResult": true}
}

func TestRPCMainChainAndMacroFinality(t *testing.T) {
	fixture := &rpcFixture{head: 101, tx: rpcTx()}
	server := httptest.NewServer(fixture)
	defer server.Close()
	client := NewRPCClient(server.URL)
	ctx := context.Background()
	hash := strings.Repeat("a", 64)
	e, err := client.Inspect(ctx, hash, "TESTNET")
	if err != nil || e.InclusionBlock != 100 || e.Finalized {
		t.Fatalf("included but not final: %+v %v", e, err)
	}
	fixture.mu.Lock()
	fixture.head = 120
	fixture.mu.Unlock()
	e, err = client.Inspect(ctx, hash, "TESTNET")
	if err != nil || !e.Finalized || e.FinalityBlock != 120 || !e.FinalizedAt.After(e.IncludedAt) {
		t.Fatalf("macro finality: %+v %v", e, err)
	}
	fixture.mu.Lock()
	fixture.reorgOnRecheck = true
	fixture.inclusionReads = 0
	fixture.mu.Unlock()
	if _, err := client.Inspect(ctx, hash, "TESTNET"); !errors.Is(err, ErrRPCUnavailable) {
		t.Fatalf("reorg accepted as final: %v", err)
	}
	fixture.mu.Lock()
	fixture.reorgOnRecheck = false
	fixture.mu.Unlock()
	if err := client.CheckNetwork(ctx, "MAINNET"); err == nil {
		t.Fatal("wrong RPC network accepted")
	}
	fixture.mu.Lock()
	fixture.missing = true
	fixture.mu.Unlock()
	if _, err := client.Inspect(ctx, hash, "TESTNET"); !errors.Is(err, ErrRPCNotFound) {
		t.Fatalf("not found: %v", err)
	}
	fixture.mu.Lock()
	fixture.missing = false
	fixture.unavailable = true
	fixture.mu.Unlock()
	if _, err := client.Inspect(ctx, hash, "TESTNET"); !errors.Is(err, ErrRPCUnavailable) {
		t.Fatalf("unavailable: %v", err)
	}
	fixture.mu.Lock()
	fixture.unavailable = false
	fixture.malformed = true
	fixture.mu.Unlock()
	if _, err := client.Inspect(ctx, hash, "TESTNET"); !errors.Is(err, ErrRPCMalformed) {
		t.Fatalf("malformed: %v", err)
	}
}

func TestRPCPendingAndReorgUncertain(t *testing.T) {
	tx := rpcTx()
	delete(tx, "blockNumber")
	delete(tx, "timestamp")
	fixture := &rpcFixture{head: 120, missing: true, mempool: true, tx: tx}
	server := httptest.NewServer(fixture)
	defer server.Close()
	client := NewRPCClient(server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	e, err := client.Inspect(ctx, strings.Repeat("a", 64), "TESTNET")
	if err != nil || e.Transaction.BlockNumber != nil || e.Finalized {
		t.Fatalf("mempool confirmed: %+v %v", e, err)
	}
}
