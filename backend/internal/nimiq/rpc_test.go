package nimiq

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
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
	headReads      int
	consensusReads int
	macroReads     int
	requests       int
	tx             map[string]any
}

func (f *rpcFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests++
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
		f.consensusReads++
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
		f.macroReads++
		data = uint32(120)
	case "getLatestBlock":
		f.headReads++
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
	// The adapter reuses one head read for a second so that a sweep of many
	// purchases costs one request between them all. This fixture moves the
	// chain in zero time, so the clock has to be moved with it or the test is
	// asserting against a cache entry rather than against the fixture.
	moment := time.Now()
	client.now = func() time.Time { return moment }
	advance := func() { moment = moment.Add(2 * headCacheTTL) }
	ctx := context.Background()
	hash := strings.Repeat("a", 64)
	e, err := client.Inspect(ctx, hash, "TESTNET")
	if err != nil || e.InclusionBlock != 100 || e.Finalized {
		t.Fatalf("included but not final: %+v %v", e, err)
	}
	// The macro block that would finalise it is named before it exists, which
	// is what lets a caller wait for a height instead of re-verifying.
	if e.FinalityBlock != 120 {
		t.Fatalf("finality height not reported while pending: %+v", e)
	}
	fixture.mu.Lock()
	fixture.head = 120
	fixture.mu.Unlock()
	advance()
	e, err = client.Inspect(ctx, hash, "TESTNET")
	if err != nil || !e.Finalized || e.FinalityBlock != 120 || !e.FinalizedAt.After(e.IncludedAt) {
		t.Fatalf("macro finality: %+v %v", e, err)
	}
	fixture.mu.Lock()
	fixture.reorgOnRecheck = true
	fixture.inclusionReads = 0
	fixture.mu.Unlock()
	advance()
	if _, err := client.Inspect(ctx, hash, "TESTNET"); !errors.Is(err, ErrRPCUnavailable) {
		t.Fatalf("reorg accepted as final: %v", err)
	}
	fixture.mu.Lock()
	fixture.reorgOnRecheck = false
	fixture.mu.Unlock()
	advance()
	if err := client.CheckNetwork(ctx, "MAINNET"); err == nil {
		t.Fatal("wrong RPC network accepted")
	}
	fixture.mu.Lock()
	fixture.missing = true
	fixture.mu.Unlock()
	advance()
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

func TestRPCTransportFailureBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       error
	}{
		{"ambiguous result and error", `{"jsonrpc":"2.0","id":1,"result":{"data":"TestAlbatross"},"error":{"code":-1,"message":"secret"}}`, ErrRPCMalformed},
		{"wrong id", `{"jsonrpc":"2.0","id":2,"result":{"data":"TestAlbatross"}}`, ErrRPCMalformed},
		{"null result", `{"jsonrpc":"2.0","id":1,"result":{"data":null}}`, ErrRPCMalformed},
		{"RPC error", `{"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"credential secret"}}`, ErrRPCUnavailable},
		{"oversized", strings.Repeat("x", (2<<20)+1), ErrRPCMalformed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(tc.body)) }))
			defer server.Close()
			_, err := NewRPCClient(server.URL).NetworkID(context.Background())
			if !errors.Is(err, tc.want) {
				t.Fatal(err)
			}
			if strings.Contains(err.Error(), "secret") {
				t.Fatal("RPC error leaked")
			}
		})
	}
	target := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) { t.Error("redirect followed") }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	if _, err := NewRPCClient(redirect.URL).NetworkID(context.Background()); !errors.Is(err, ErrRPCUnavailable) {
		t.Fatal(err)
	}
	slow := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(100 * time.Millisecond):
		}
	}))
	defer slow.Close()
	client := NewRPCClient(slow.URL)
	client.HTTP.Timeout = 20 * time.Millisecond
	started := time.Now()
	if _, err := client.NetworkID(context.Background()); !errors.Is(err, ErrRPCUnavailable) || time.Since(started) > time.Second {
		t.Fatal("unbounded timeout", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := client.NetworkID(ctx); !errors.Is(err, ErrRPCUnavailable) {
		t.Fatal("cancellation", err)
	}
}

// The shape a real node actually uses for an unknown transaction hash.
//
// Captured from core-rs-albatross v2.1.0 (local Testnet history node,
// 2026-09-16): the sentence lives in `data`, while `message` is the generic
// "Internal error". A stub that puts "not found" in `message` — as the older
// fixtures here do — cannot catch that, which is why this test states the
// observed bytes verbatim rather than a convenient shape.
func TestUnknownHashIsNotFoundWhenTheNodePutsItInErrorData(t *testing.T) {
	const missingHash = "0000000000000000000000000000000000000000000000000000000000000000"
	var mempoolAsked bool

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string `json:"method"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		w.Header().Set("Content-Type", "application/json")
		switch req.Method {
		case "getNetworkId":
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":"TestAlbatross","metadata":null}}`))
		case "isConsensusEstablished":
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":true,"metadata":null}}`))
		case "getTransactionByHash":
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error","data":"Transaction not found: ` + missingHash + `"}}`))
		case "getTransactionFromMempool":
			mempoolAsked = true
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error","data":"Transaction not found: ` + missingHash + `"}}`))
		default:
			http.Error(w, "unexpected method "+req.Method, 400)
		}
	}))
	defer server.Close()

	client := NewRPCClient(server.URL)
	_, err := client.Inspect(context.Background(), missingHash, "TESTNET")

	// Not found, not "the infrastructure is uncertain": an absent transaction
	// is a known state, and only that state lets Inspect consult the mempool.
	if !errors.Is(err, ErrRPCNotFound) {
		t.Fatalf("Inspect error = %v, want ErrRPCNotFound", err)
	}
	// The mempool fallback is the whole reason the distinction matters — a
	// broadcast transaction that is not yet in a block lives only there.
	if !mempoolAsked {
		t.Fatal("the mempool was never consulted, so a pending broadcast would be invisible")
	}
}

// The three things a real public endpoint got wrong that a local node did not.
// All measured against https://rpc.nimiqwatch.com on 2026-09-16.

// A gateway may answer a blocked method with HTTP 400 and a *string* error.
// Both details matter: the old client returned early on the status and typed
// the field as an object, so this arrived as "the chain is unreachable".
func TestBlockedMethodIsRecognisedNotReportedAsAnOutage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","error":"Method not allowed","id":1}`))
	}))
	defer server.Close()

	_, err := (&RPCClient{URL: server.URL, HTTP: server.Client()}).NetworkID(context.Background())
	if !errors.Is(err, ErrRPCMethodNotAllowed) {
		t.Fatalf("err = %v, want ErrRPCMethodNotAllowed", err)
	}
}

// Network verification must survive an endpoint that will not serve
// getNetworkId — by proving the chain from a block, never by skipping it.
func TestNetworkIsVerifiedFromABlockWhenGetNetworkIdIsBlocked(t *testing.T) {
	serve := func(network string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":{"hash":"ab","number":10,"timestamp":1,"network":"` + network + `","type":"micro"}}}`))
		}))
	}

	matching := serve("TestAlbatross")
	defer matching.Close()
	if err := (&RPCClient{URL: matching.URL, HTTP: matching.Client()}).CheckNetwork(context.Background(), "TESTNET"); err != nil {
		t.Fatalf("expected the block fallback to verify the network: %v", err)
	}

	// The property that must not be lost: a mainnet endpoint is still refused
	// for a testnet deployment, even though getNetworkId never answered.
	crossed := serve("MainAlbatross")
	defer crossed.Close()
	if err := (&RPCClient{URL: crossed.URL, HTTP: crossed.Client()}).CheckNetwork(context.Background(), "TESTNET"); err == nil {
		t.Fatal("a cross-network endpoint must be refused, not assumed correct")
	}
}

// Throttling is not absence. A 429 must be its own answer so callers back off
// instead of concluding that a payment does not exist (docs/05 §95).
func TestRateLimitIsItsOwnAnswer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	_, err := (&RPCClient{URL: server.URL, HTTP: server.Client()}).NetworkID(context.Background())
	if !errors.Is(err, ErrRPCRateLimited) {
		t.Fatalf("err = %v, want ErrRPCRateLimited", err)
	}
	if errors.Is(err, ErrRPCNotFound) {
		t.Fatal("a throttled lookup must never read as a missing transaction")
	}
}

// getTransactionsByAddress is deserialized positionally and counts its
// arguments before typing them: two fail with "invalid length 2, expected …
// with 3 elements". The optional startAt must travel as an explicit null.
func TestAddressQuerySendsAllThreePositionalParameters(t *testing.T) {
	var params []any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Method string `json:"method"`
			Params []any  `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		switch body.Method {
		case "getNetworkId":
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":"TestAlbatross"}}`))
		case "isConsensusEstablished":
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":true}}`))
		case "getTransactionsByAddress":
			params = body.Params
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":[]}}`))
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer server.Close()

	client := &RPCClient{URL: server.URL, HTTP: server.Client()}
	if _, err := client.TransactionsByAddress(context.Background(), "NQ07 0000 0000 0000 0000 0000 0000 0000 0000", "TESTNET"); err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(params) != 3 {
		t.Fatalf("sent %d parameters, want 3 (address, max, startAt)", len(params))
	}
	if params[0] != "NQ0700000000000000000000000000000000" {
		t.Fatalf("address = %v; spaces must be stripped", params[0])
	}
	if params[2] != nil {
		t.Fatalf("startAt = %v, want an explicit null", params[2])
	}
}

// A gateway that publishes its own limiter state, the way rpc.nimiqwatch.com
// does: `X-RateLimit-Remaining` and `X-RateLimit-Reset` on every response,
// twenty requests per fixed ten-second window with no refill inside it
// (measured 2026-09-17).
type budgetFixture struct {
	mu      sync.Mutex
	served  int
	limit   int
	resetAt int64
	refused int
}

func (f *budgetFixture) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.served++
	remaining := f.limit - f.served
	w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(f.resetAt, 10))
	if remaining < 0 {
		f.refused++
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"data":true,"metadata":null}}`))
}

func (f *budgetFixture) counts() (int, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.served, f.refused
}

// The adapter must stop spending a budget it has been told is empty, and must
// start again the moment the window it was told about has closed.
//
// The point is not politeness. A request that is sent and refused comes back
// as ErrRPCRateLimited, and a throttled verification is recorded as UNCERTAIN,
// which is the status that backs the next look off by 30 s, 60 s … 8 min
// (ADR-019). Spending requests we know will be refused is therefore paid for
// in customer-visible settlement delay, not in bandwidth.
func TestRPCHonoursThePublishedBudget(t *testing.T) {
	moment := time.Now().Truncate(time.Second)
	fixture := &budgetFixture{limit: 4, resetAt: moment.Add(10 * time.Second).Unix()}
	server := httptest.NewServer(fixture)
	defer server.Close()
	client := NewRPCClient(server.URL)
	client.now = func() time.Time { return moment }
	ctx := context.Background()

	for i := 0; i < 4; i++ {
		if err := client.call(ctx, "isConsensusEstablished", []any{}, new(bool)); err != nil {
			t.Fatalf("call %d inside the budget: %v", i, err)
		}
	}
	// The fifth is refused locally: the gateway said zero remaining, and the
	// window it named has not closed.
	if err := client.call(ctx, "isConsensusEstablished", []any{}, new(bool)); !errors.Is(err, ErrRPCRateLimited) {
		t.Fatalf("exhausted budget not refused: %v", err)
	}
	if served, refused := fixture.counts(); served != 4 || refused != 0 {
		t.Fatalf("a request we knew would be refused was still sent: served=%d refused=%d", served, refused)
	}

	// Still refused a moment later, still without a round trip.
	moment = moment.Add(5 * time.Second)
	if err := client.call(ctx, "isConsensusEstablished", []any{}, new(bool)); !errors.Is(err, ErrRPCRateLimited) {
		t.Fatalf("mid-window call not refused: %v", err)
	}
	if served, _ := fixture.counts(); served != 4 {
		t.Fatalf("mid-window call was sent anyway: served=%d", served)
	}

	// The window closes and the next window's figures are unknown until
	// something is sent, so the next call goes out.
	moment = moment.Add(6 * time.Second)
	fixture.mu.Lock()
	fixture.served, fixture.resetAt = 0, moment.Add(10*time.Second).Unix()
	fixture.mu.Unlock()
	if err := client.call(ctx, "isConsensusEstablished", []any{}, new(bool)); err != nil {
		t.Fatalf("new window not used: %v", err)
	}
}

// A 429 the adapter did not see coming still closes the window, so the next
// call waits rather than knocking again.
func TestRPCRemembersARefusal(t *testing.T) {
	moment := time.Now().Truncate(time.Second)
	fixture := &budgetFixture{limit: 0, resetAt: moment.Add(10 * time.Second).Unix()}
	server := httptest.NewServer(fixture)
	defer server.Close()
	client := NewRPCClient(server.URL)
	client.now = func() time.Time { return moment }
	ctx := context.Background()

	if err := client.call(ctx, "isConsensusEstablished", []any{}, new(bool)); !errors.Is(err, ErrRPCRateLimited) {
		t.Fatalf("429 not reported as rate limited: %v", err)
	}
	if err := client.call(ctx, "isConsensusEstablished", []any{}, new(bool)); !errors.Is(err, ErrRPCRateLimited) {
		t.Fatalf("second call after 429: %v", err)
	}
	if _, refused := fixture.counts(); refused != 1 {
		t.Fatalf("kept knocking after a refusal: refused=%d", refused)
	}
}

// Reading the head and the consensus flag is per-sweep work, not per-purchase
// work. Four concurrent verifications must not cost four of each.
func TestRPCSharesOneHeadReadAcrossASweep(t *testing.T) {
	fixture := &rpcFixture{head: 101, tx: rpcTx()}
	server := httptest.NewServer(fixture)
	defer server.Close()
	client := NewRPCClient(server.URL)
	moment := time.Now()
	client.now = func() time.Time { return moment }
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if _, err := client.Head(ctx, "TESTNET"); err != nil {
			t.Fatalf("head %d: %v", i, err)
		}
		if err := client.requireConsensus(ctx); err != nil {
			t.Fatalf("consensus %d: %v", i, err)
		}
	}
	fixture.mu.Lock()
	heads, consensus := fixture.headReads, fixture.consensusReads
	fixture.mu.Unlock()
	if heads != 1 || consensus != 1 {
		t.Fatalf("sweep re-read shared chain state: heads=%d consensus=%d", heads, consensus)
	}

	moment = moment.Add(2 * consensusCacheTTL)
	if _, err := client.Head(ctx, "TESTNET"); err != nil {
		t.Fatalf("head after TTL: %v", err)
	}
	if err := client.requireConsensus(ctx); err != nil {
		t.Fatalf("consensus after TTL: %v", err)
	}
	fixture.mu.Lock()
	heads, consensus = fixture.headReads, fixture.consensusReads
	fixture.mu.Unlock()
	if heads != 2 || consensus != 2 {
		t.Fatalf("stale chain state reused past its TTL: heads=%d consensus=%d", heads, consensus)
	}
}

// What repeated verification costs the gateway, pinned.
//
// `rpc.nimiqwatch.com` serves twenty requests per fixed ten-second window and
// no JSON-RPC batches, so every re-read inside a loop that runs once per tick
// is spent against a budget five ticks wide (ADR-022).
//
// Measured here: the first look costs six requests and every later one costs
// four — the network proof and the macro height are never asked for twice, and
// the head and consensus are shared for their TTL. What remains per tick is the
// transaction, its block, and the two shared reads once their TTLs lapse.
//
// Four per tick is affordable because of where this path is now reached. Under
// the default `inclusion` policy a purchase passes through it once or twice on
// its way to confirmed, and the waiting afterwards is done by the finality
// worker, which skips a receipt whose macro block demonstrably has not been
// produced yet for one cached head read across the whole sweep (ADR-021). A
// deployment that sets `NIMIQ_CONFIRMATION_POLICY=finality` does hold a
// candidate in this loop for the length of a batch, and on a shared gateway
// that is the busiest thing it will do.
func TestRepeatedVerificationReusesWhatCannotChange(t *testing.T) {
	fixture := &rpcFixture{head: 101, tx: rpcTx()}
	server := httptest.NewServer(fixture)
	defer server.Close()
	client := NewRPCClient(server.URL)
	moment := time.Now()
	client.now = func() time.Time { return moment }
	ctx := context.Background()
	hash := strings.Repeat("a", 64)

	if _, err := client.Inspect(ctx, hash, "TESTNET"); err != nil {
		t.Fatalf("first inspect: %v", err)
	}
	fixture.mu.Lock()
	first, firstHeads := fixture.requests, fixture.headReads
	fixture.mu.Unlock()

	// Four more ticks with the macro block still pending, each one advancing
	// past both caches. That is the honest worst case: nothing below is cheap
	// merely because time stood still.
	for i := 0; i < 4; i++ {
		moment = moment.Add(2 * time.Second)
		if _, err := client.Inspect(ctx, hash, "TESTNET"); err != nil {
			t.Fatalf("inspect %d: %v", i, err)
		}
	}
	fixture.mu.Lock()
	total, heads, macros := fixture.requests, fixture.headReads, fixture.macroReads
	fixture.mu.Unlock()

	// The macro height for one inclusion block is policy arithmetic, not chain
	// state. Asking for it again on every poll was thirty requests per
	// settlement for one unchanging number.
	if macros != 1 {
		t.Fatalf("macro height re-read %d times", macros)
	}
	// The network proof outlives the sweep; the head does not, and must not.
	if heads <= firstHeads {
		t.Fatalf("head never re-read across ticks: %d", heads)
	}
	if steady := total - first; steady >= 4*first {
		t.Fatalf("later ticks cost as much as the first: first=%d four more=%d", first, steady)
	}
	// Five ticks is one rate-limit window. Twenty-two requests is what this
	// path costs; anything materially above it means a new read was added to a
	// loop that runs for the length of a batch.
	if total > 22 {
		t.Fatalf("five ticks cost %d requests, up from 22", total)
	}
}
