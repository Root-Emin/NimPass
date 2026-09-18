package nimiq

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

var ErrRPCUnavailable = errors.New("nimiq RPC unavailable")

// ErrRPCNetworkMismatch is the one RPC condition that must never be retried,
// tolerated or merely warned about: the endpoint is serving a different chain
// from the one this deployment settles payments on.
//
// It is a sentinel rather than a bare error because the two callers that decide
// whether the process may run at all — startup and readiness — have to tell it
// apart from every other failure. An unreachable, throttled or slow node is
// uncertainty, and the server keeps serving; a node on the wrong chain is a
// misconfiguration that could settle a Mainnet purchase against a Testnet
// transaction, so it fails closed (docs/05 §92, §94, docs/09-SECURITY.md §101).
var ErrRPCNetworkMismatch = errors.New("nimiq RPC network mismatch")
var ErrRPCNotFound = errors.New("nimiq transaction not found")
var ErrRPCMalformed = errors.New("malformed Nimiq RPC response")

// ErrRPCRateLimited is a distinct sentinel because it is the one failure whose
// cause is us, not the chain. rpc.nimiqwatch.com allows 20 tokens per 10s per
// IP and answers 429 beyond that, spending "1 token per started 100 items" on
// list results — so an address query costs more than a hash lookup and a busy
// reconciler can hit the ceiling without anything being wrong with a payment.
//
// It still reads as uncertain, never as failure: callers must back off and
// re-ask, and must never conclude that a transaction is absent because we were
// throttled while looking for it (docs/05 §95, §97, §158).
var ErrRPCRateLimited = errors.New("nimiq RPC rate limited")

// ErrRPCMethodNotAllowed marks a method this endpoint refuses to serve at all,
// as opposed to one that failed.
//
// Public gateways expose a subset. rpc.nimiqwatch.com answers `getNetworkId`
// with a bare `{"error":"Method not allowed"}` while serving every other method
// Nimpass needs (observed 2026-09-16). Distinguishing it lets the network check
// fall back to a source that *is* served, instead of reporting the whole
// endpoint as broken — or, far worse, skipping the check.
var ErrRPCMethodNotAllowed = errors.New("nimiq RPC method not allowed")

// rpcError normalizes the two error shapes seen in the wild.
type rpcError struct {
	Code    int
	Message string
	Data    string
}

func (e rpcError) detail() string { return e.Message + " " + e.Data }

func (e rpcError) notAllowed() bool {
	return strings.Contains(strings.ToLower(e.Message), "method not allowed") ||
		strings.Contains(strings.ToLower(e.Message), "method not found") || e.Code == -32601
}

// parseRPCError accepts an object error, a string error, or no error at all.
// It returns an error of its own only when the field is present but is neither.
func parseRPCError(raw json.RawMessage) (*rpcError, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var object struct {
		Code    int             `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if json.Unmarshal(raw, &object) == nil {
		return &rpcError{Code: object.Code, Message: object.Message, Data: string(object.Data)}, nil
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return &rpcError{Message: text}, nil
	}
	return nil, ErrRPCMalformed
}

// RPCClient uses the PoS JSON-RPC result.data envelope. The URL is supplied
// solely by server configuration; no user-controlled URL reaches this adapter.
type RPCClient struct {
	URL  string
	HTTP *http.Client

	// Remembers that this endpoint was proven to serve a given network.
	//
	// Purely a rate-limit measure, and a narrow one. rpc.nimiqwatch.com allows
	// 20 tokens per 10 seconds, and every verification already spends several
	// on the transaction, its block, the macro block and the head; re-proving
	// the chain on each one would spend up to two more for an answer that
	// cannot change while the process is pointed at the same endpoint.
	//
	// Only success is cached, and only for the exact network string that was
	// proven, so a mismatch or an outage is never remembered as an approval.
	// The TTL keeps a repointed endpoint from being trusted indefinitely.
	networkMu       sync.Mutex
	networkVerified map[string]time.Time

	// The gateway's own limiter state, as the gateway reports it.
	//
	// rpc.nimiqwatch.com answers every request with `X-RateLimit-Remaining`
	// and `X-RateLimit-Reset`, and the window it describes is a hard one:
	// measured 2026-09-17, twenty requests are served per fixed ten-second
	// window with no refill inside it, and `Reset` is the unix second the
	// next window opens. Reading those two numbers is the difference between
	// knowing the budget and discovering it by being refused.
	//
	// Discovering it by being refused is expensive here in a way it is not
	// elsewhere: a throttled verification used to be recorded as UNCERTAIN,
	// which is the one status that increments `retry_count`, which pushes the
	// next look out 30 s, 60 s, … 8 min (ADR-019). One 429 during a
	// settlement therefore cost the customer half a minute of spinner for a
	// payment that was already on chain.
	//
	// Zero effect on a node that publishes no such headers — a local
	// core-rs-albatross, for instance — where `budgetKnown` simply stays
	// false and every call goes out exactly as before.
	budgetMu        sync.Mutex
	budgetKnown     bool
	budgetRemaining int
	budgetResetAt   time.Time

	// Chain state that every concurrent verification asks for and that none
	// of them can each usefully have its own copy of.
	chainMu     sync.Mutex
	head        ChainBlock
	headAt      time.Time
	consensusAt time.Time
	macroAfter  map[uint32]uint32

	// Injectable clock. Every TTL and every budget window in this adapter is
	// measured through it, so a test can hold time still or move it on
	// purpose rather than racing a one-second cache.
	now func() time.Time
}

func (c *RPCClient) clock() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
}

// How long a proven network stays proven. Short enough that a redirected
// endpoint is re-checked promptly, long enough to take the check off the
// per-verification token budget.
const networkCheckTTL = 5 * time.Minute

// How long the chain head may be reused.
//
// Albatross produces a micro block roughly every second, so a head read within
// the last second is the head. What this removes is not one call but N: the
// reconciler verifies up to four purchases concurrently and sweeps discovery
// addresses in the same pass, and every one of those legs asks for the head
// and for consensus. Against a twenty-per-ten-seconds gateway that was the
// budget, spent on re-reading one number.
//
// The staleness this admits is one-directional and therefore safe: a head that
// is up to a second old can only make a transaction look *less* final than it
// is, delaying a confirmation by under a second. It can never make an
// unfinalised transaction look finalised, because the comparison is
// `head.Number < macroHeight` and a stale head is a smaller number.
const headCacheTTL = time.Second

// How long an established consensus may be assumed to still be established.
//
// One reconciler tick. This is a genuine safety check being cached — the
// adapter refuses to read a node that is not in consensus — so the window is
// deliberately the shortest one that removes the duplicate calls within a
// single sweep, rather than the longest one that would still "probably" hold.
// Everything the evidence rests on is re-read inside that window anyway: the
// transaction, its block, the macro block and the head.
const consensusCacheTTL = 2 * time.Second

// How many macro-block answers to remember. `getMacroBlockAfter(n)` is a pure
// function of the height and the network's batch length — the node computes it
// from policy, not from chain state — so an answer for a given height cannot
// change while this client points at one endpoint, whose network is proven
// separately. Bounded because it is a cache, not a ledger.
const macroMemoLimit = 1024

func NewRPCClient(endpoint string) *RPCClient {
	return &RPCClient{URL: endpoint, HTTP: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}
}

// reserve spends one unit of the gateway budget, or refuses to send.
//
// Refusing locally is strictly better than being refused remotely: a request
// that is never sent cannot be counted against us, cannot deepen whatever
// penalty the gateway applies to a client that keeps knocking, and returns the
// same answer — ErrRPCRateLimited — without a round trip.
//
// The decrement is optimistic because the reconciler calls concurrently: four
// goroutines reading a remaining of 1 must not all conclude they may send. The
// gateway's own figure overwrites this on the next response, so the estimate
// can be briefly pessimistic and never durably wrong.
func (c *RPCClient) reserve(now time.Time) bool {
	c.budgetMu.Lock()
	defer c.budgetMu.Unlock()
	if !c.budgetKnown {
		return true
	}
	if !now.Before(c.budgetResetAt) {
		// The window we were told about has closed. We do not know the new
		// one's figures until something is sent, so send.
		c.budgetKnown = false
		return true
	}
	if c.budgetRemaining <= 0 {
		return false
	}
	c.budgetRemaining--
	return true
}

// observe records what the gateway just said about our budget.
//
// Only headers describing a window that has not already closed are taken, and
// within one window the *lower* figure wins: concurrent responses arrive out
// of order, and believing a stale higher remaining is how a limiter gets
// walked into.
func (c *RPCClient) observe(header http.Header, now time.Time) {
	remainingText := strings.TrimSpace(header.Get("X-RateLimit-Remaining"))
	resetText := strings.TrimSpace(header.Get("X-RateLimit-Reset"))
	if remainingText == "" || resetText == "" {
		return
	}
	remaining, err := strconv.Atoi(remainingText)
	if err != nil || remaining < 0 {
		return
	}
	seconds, err := strconv.ParseInt(resetText, 10, 64)
	if err != nil || seconds <= 0 {
		return
	}
	resetAt := time.Unix(seconds, 0)
	if !resetAt.After(now) {
		return
	}
	c.budgetMu.Lock()
	defer c.budgetMu.Unlock()
	if c.budgetKnown && c.budgetResetAt.Equal(resetAt) && remaining > c.budgetRemaining {
		return
	}
	c.budgetKnown, c.budgetRemaining, c.budgetResetAt = true, remaining, resetAt
}

// exhausted marks the current window as spent, after the gateway has said so
// in the only way that is not a guess: a 429.
func (c *RPCClient) exhausted(now time.Time) {
	c.budgetMu.Lock()
	defer c.budgetMu.Unlock()
	if !c.budgetKnown || !now.Before(c.budgetResetAt) {
		// Without a reset time from the gateway there is nothing to wait for
		// but the caller's own backoff; assume the shortest published window.
		c.budgetKnown, c.budgetResetAt = true, now.Add(10*time.Second)
	}
	c.budgetRemaining = 0
}

func (c *RPCClient) call(ctx context.Context, method string, params []any, dst any) error {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		return err
	}
	if !c.reserve(c.clock()) {
		return ErrRPCRateLimited
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(body))
	if err != nil {
		return ErrRPCUnavailable
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := c.HTTP.Do(req)
	if err != nil {
		return ErrRPCUnavailable
	}
	defer func() { _ = response.Body.Close() }()
	c.observe(response.Header, c.clock())
	if response.StatusCode == http.StatusTooManyRequests {
		c.exhausted(c.clock())
		return ErrRPCRateLimited
	}
	// A JSON-RPC error does not always arrive with 200. rpc.nimiqwatch.com
	// answers a method outside its allowlist with HTTP 400 and
	// {"jsonrpc":"2.0","error":"Method not allowed","id":1} (observed
	// 2026-09-16), and returning early here reported that as a generic outage —
	// which hid a fixable configuration fact behind "the chain is unreachable".
	//
	// The body is therefore read for a client-error status too, but only an
	// *error* may be taken from one: `ok` gates the result branch below, so a
	// non-200 carrying a result is refused rather than believed.
	ok := response.StatusCode == http.StatusOK
	if !ok && (response.StatusCode < 400 || response.StatusCode > 404) {
		return ErrRPCUnavailable
	}
	limited := io.LimitReader(response.Body, 2<<20+1)
	data, err := io.ReadAll(limited)
	if err != nil || len(data) > 2<<20 {
		return ErrRPCMalformed
	}
	var envelope struct {
		JSONRPC string `json:"jsonrpc"`
		ID      int    `json:"id"`
		Result  *struct {
			Data json.RawMessage `json:"data"`
		} `json:"result"`
		// Not always a JSON-RPC error object. A gateway in front of a node may
		// answer with a bare string — rpc.nimiqwatch.com returns
		//   {"jsonrpc":"2.0","error":"Method not allowed","id":1}
		// for a method outside its allowlist (observed 2026-09-16). Typing this
		// as a struct made the whole envelope fail to parse, which surfaced as
		// ErrRPCMalformed and hid the actual reason.
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(data, &envelope) != nil || envelope.JSONRPC != "2.0" || envelope.ID != 1 {
		if !ok {
			return ErrRPCUnavailable
		}
		return ErrRPCMalformed
	}
	rpcError, err := parseRPCError(envelope.Error)
	if err != nil {
		return ErrRPCMalformed
	}
	if !ok && rpcError == nil {
		// A client-error status with no error in it explains nothing.
		return ErrRPCUnavailable
	}
	if rpcError != nil && envelope.Result != nil {
		return ErrRPCMalformed
	}
	if rpcError != nil {
		if rpcError.notAllowed() {
			return ErrRPCMethodNotAllowed
		}
		// A missing transaction is not a failed payment. All other RPC errors
		// are infrastructure-uncertain and must not trigger a second payment.
		//
		// Where the node puts that sentence is not fixed: core-rs-albatross
		// v2.1.0 answers an unknown hash with
		//   {"code":-32603,"message":"Internal error","data":"Transaction not found: …"}
		// so reading `message` alone misses it (observed against a local
		// Testnet history node, 2026-09-16). Missing it is not cosmetic: the
		// mempool lookup below runs only on ErrRPCNotFound, so a transaction
		// that is broadcast but not yet in a block would never be seen there.
		if method == "getTransactionByHash" || method == "getTransactionFromMempool" {
			if strings.Contains(strings.ToLower(rpcError.detail()), "not found") {
				return ErrRPCNotFound
			}
		}
		return ErrRPCUnavailable
	}
	if !ok || envelope.Result == nil || len(envelope.Result.Data) == 0 || string(envelope.Result.Data) == "null" {
		return ErrRPCMalformed
	}
	if json.Unmarshal(envelope.Result.Data, dst) != nil {
		return ErrRPCMalformed
	}
	return nil
}

// latestBlock reads the chain head, reusing one read across a whole sweep.
//
// Callers get a value, never the cache's own copy, so nothing downstream can
// mutate what the next caller sees.
func (c *RPCClient) latestBlock(ctx context.Context) (ChainBlock, error) {
	now := c.clock()
	c.chainMu.Lock()
	if c.head.Hash != "" && now.Sub(c.headAt) < headCacheTTL {
		head := c.head
		c.chainMu.Unlock()
		return head, nil
	}
	c.chainMu.Unlock()
	var head ChainBlock
	if err := c.call(ctx, "getLatestBlock", []any{false}, &head); err != nil {
		return ChainBlock{}, err
	}
	if head.Hash == "" || head.Number == 0 {
		return ChainBlock{}, ErrRPCMalformed
	}
	c.chainMu.Lock()
	// Never move the remembered head backwards. Two concurrent reads can
	// return different heights, and the older one arriving second must not
	// un-advance the chain for everyone else.
	if head.Number >= c.head.Number {
		c.head, c.headAt = head, now
	}
	c.chainMu.Unlock()
	return head, nil
}

// requireConsensus refuses to read a node that is not in consensus, which is
// the same refusal as before — asked once per tick rather than once per leg.
func (c *RPCClient) requireConsensus(ctx context.Context) error {
	now := c.clock()
	c.chainMu.Lock()
	fresh := !c.consensusAt.IsZero() && now.Sub(c.consensusAt) < consensusCacheTTL
	c.chainMu.Unlock()
	if fresh {
		return nil
	}
	var consensus bool
	if err := c.call(ctx, "isConsensusEstablished", []any{}, &consensus); err != nil {
		return err
	}
	if !consensus {
		// Deliberately not remembered. Only an established consensus is
		// cached; a node that has lost it is re-asked on the very next leg.
		c.chainMu.Lock()
		c.consensusAt = time.Time{}
		c.chainMu.Unlock()
		return ErrRPCUnavailable
	}
	c.chainMu.Lock()
	c.consensusAt = now
	c.chainMu.Unlock()
	return nil
}

// macroBlockAfter is the height of the first macro block above `height`.
//
// Memoized, because the answer is policy rather than chain state: macro blocks
// sit at fixed multiples of the batch length, so for one height on one network
// this number is a constant. A settlement waiting on finality asks for it on
// every poll — up to thirty times for one purchase on Mainnet, where a batch
// is sixty seconds — and every answer after the first is the first one again.
func (c *RPCClient) macroBlockAfter(ctx context.Context, height uint32) (uint32, error) {
	c.chainMu.Lock()
	if remembered, ok := c.macroAfter[height]; ok {
		c.chainMu.Unlock()
		return remembered, nil
	}
	c.chainMu.Unlock()
	var macroHeight uint32
	if err := c.call(ctx, "getMacroBlockAfter", []any{height}, &macroHeight); err != nil {
		return 0, err
	}
	if macroHeight <= height {
		return 0, ErrRPCMalformed
	}
	c.chainMu.Lock()
	if c.macroAfter == nil || len(c.macroAfter) >= macroMemoLimit {
		c.macroAfter = make(map[uint32]uint32, macroMemoLimit)
	}
	c.macroAfter[height] = macroHeight
	c.chainMu.Unlock()
	return macroHeight, nil
}

// ChainHead is the least a caller needs to know to decide whether asking
// anything else is worth a request.
type ChainHead struct {
	Number uint32
	Hash   string
}

// Head reports the current chain height on the proven network.
//
// It exists so the reconciler can answer "has the macro block that would
// finalise this payment been produced yet?" without running the whole
// verification pipeline to be told no. Cheap by construction: the network
// proof and the head are both cached, so a sweep of many purchases costs at
// most one request between them all.
func (c *RPCClient) Head(ctx context.Context, network string) (ChainHead, error) {
	expected, _, err := ExpectedNetworkID(network)
	if err != nil {
		return ChainHead{}, err
	}
	if err := c.CheckNetwork(ctx, network); err != nil {
		return ChainHead{}, err
	}
	head, err := c.latestBlock(ctx)
	if err != nil {
		return ChainHead{}, err
	}
	if head.Network != expected {
		return ChainHead{}, ErrRPCNetworkMismatch
	}
	return ChainHead{Number: head.Number, Hash: head.Hash}, nil
}

func (c *RPCClient) NetworkID(ctx context.Context) (string, error) {
	var value string
	err := c.call(ctx, "getNetworkId", []any{}, &value)
	return value, err
}

func ExpectedNetworkID(network string) (string, uint8, error) {
	switch network {
	case "TESTNET":
		return "TestAlbatross", 5, nil
	case "MAINNET":
		return "MainAlbatross", 24, nil
	default:
		return "", 0, fmt.Errorf("unsupported network")
	}
}

// CheckNetwork proves the endpoint is serving the chain this deployment means.
//
// Cross-network settlement is forbidden outright (docs/05 §92, §94), so this
// must never be skipped — but `getNetworkId` cannot be relied on to answer it.
// rpc.nimiqwatch.com, the endpoint the product targets, keeps that method
// outside its allowlist and replies "Method not allowed" while serving
// everything else (observed 2026-09-16).
//
// So the check falls back to a source the endpoint does serve: every block
// carries the network it belongs to, and `getLatestBlock` is allowed. The
// property proven is the same one, from the chain's own data rather than from
// a node self-report — arguably the better evidence of the two.
//
// The fallback is only ever reached for a method the endpoint refuses. A
// `getNetworkId` that is served and *disagrees* is still a hard mismatch, and
// an endpoint that serves neither is unavailable, never assumed correct.
func (c *RPCClient) CheckNetwork(ctx context.Context, network string) error {
	expected, _, err := ExpectedNetworkID(network)
	if err != nil {
		return err
	}
	if c.networkIsProven(network) {
		return nil
	}
	actual, err := c.NetworkID(ctx)
	if err == nil {
		if actual != expected {
			return fmt.Errorf("%w: configured for %s, endpoint serves %s", ErrRPCNetworkMismatch, expected, actual)
		}
		c.rememberNetwork(network)
		return nil
	}
	if !errors.Is(err, ErrRPCMethodNotAllowed) {
		return err
	}
	head, err := c.latestBlock(ctx)
	if err != nil {
		return err
	}
	if head.Network != expected {
		return fmt.Errorf("%w: configured for %s, endpoint serves %s", ErrRPCNetworkMismatch, expected, head.Network)
	}
	c.rememberNetwork(network)
	return nil
}

// NetworkProbe is what an operator needs to answer "which chain is this
// deployment actually settling against?" — and nothing else.
//
// Deliberately carries no endpoint URL, no credentials and no host name. It is
// rendered into `/health/ready` and into startup logs, both of which are read
// by more people than the configuration is (docs/09-SECURITY.md §88).
type NetworkProbe struct {
	// Expected is the chain the deployment is configured for, as the chain
	// itself names it: `MainAlbatross` or `TestAlbatross`.
	Expected string
	// Observed is the chain the endpoint answered with, empty when it could
	// not be established.
	Observed string
	// Source names how Observed was established: "getNetworkId" when the node
	// served it, "block" when it was proven from `getLatestBlock` instead.
	Source string
	// Status is one of:
	//   verified   the endpoint is serving the expected chain
	//   mismatch   the endpoint is serving a different chain — fail closed
	//   unverified the endpoint could not be read at all — uncertainty
	Status string
	// Head is the chain height, when a block was read on the way.
	Head uint32
	// Cause is why an `unverified` probe could not establish the chain. Nil
	// for `verified` and for `mismatch`, both of which are answers rather than
	// failures.
	//
	// It exists so a caller can keep treating a *malformed* reply as a
	// configuration error — an endpoint that is not a Nimiq PoS RPC at all is
	// as wrong as one on the other chain — while still tolerating a timeout or
	// a 429.
	Cause error
}

const (
	NetworkVerified   = "verified"
	NetworkMismatch   = "mismatch"
	NetworkUnverified = "unverified"
)

// Probe reports the network the endpoint is serving, as a structured fact
// rather than as an error string.
//
// It runs the same proof `CheckNetwork` runs — `getNetworkId` first, the
// `getLatestBlock` network field where the gateway refuses that method — and
// differs only in what it returns: a caller that has to *report* the state
// needs to distinguish "wrong chain" from "could not ask", and an error alone
// makes that a matter of string comparison.
//
// It never caches a failure and never widens what CheckNetwork would accept:
// `Status` is `verified` only where CheckNetwork would have returned nil.
func (c *RPCClient) Probe(ctx context.Context, network string) NetworkProbe {
	expected, _, err := ExpectedNetworkID(network)
	if err != nil {
		return NetworkProbe{Status: NetworkUnverified}
	}
	probe := NetworkProbe{Expected: expected, Status: NetworkUnverified}
	if c == nil || c.URL == "" {
		return probe
	}
	// A proof that is still inside its TTL answers this without spending a
	// request. That matters because the readiness endpoint is polled by
	// infrastructure on its own schedule, and a probe that cost two tokens
	// every time would be taking them out of the same twenty-per-ten-seconds
	// window a customer's settlement is waiting on (ADR-022). Only success is
	// ever cached, so this can report `verified` and never `mismatch`.
	if c.networkIsProven(network) {
		return NetworkProbe{Expected: expected, Observed: expected, Source: "cached", Status: NetworkVerified}
	}
	if actual, err := c.NetworkID(ctx); err == nil {
		probe.Observed, probe.Source = actual, "getNetworkId"
		probe.Status = NetworkMismatch
		if actual == expected {
			probe.Status = NetworkVerified
			c.rememberNetwork(network)
		}
		return probe
	} else if !errors.Is(err, ErrRPCMethodNotAllowed) {
		probe.Cause = err
		return probe
	}
	head, err := c.latestBlock(ctx)
	if err != nil {
		probe.Cause = err
		return probe
	}
	probe.Observed, probe.Source, probe.Head = head.Network, "block", head.Number
	probe.Status = NetworkMismatch
	if head.Network == expected {
		probe.Status = NetworkVerified
		c.rememberNetwork(network)
	}
	return probe
}

// Err turns a probe back into the error its status means, so a caller that
// only wants to fail closed does not have to re-implement the mapping.
func (p NetworkProbe) Err() error {
	switch p.Status {
	case NetworkVerified:
		return nil
	case NetworkMismatch:
		return fmt.Errorf("%w: configured for %s, endpoint serves %s", ErrRPCNetworkMismatch, p.Expected, p.Observed)
	default:
		if p.Cause != nil {
			return p.Cause
		}
		return ErrRPCUnavailable
	}
}

func (c *RPCClient) networkIsProven(network string) bool {
	c.networkMu.Lock()
	defer c.networkMu.Unlock()
	at, ok := c.networkVerified[network]
	return ok && c.clock().Sub(at) < networkCheckTTL
}

func (c *RPCClient) rememberNetwork(network string) {
	c.networkMu.Lock()
	defer c.networkMu.Unlock()
	if c.networkVerified == nil {
		c.networkVerified = make(map[string]time.Time, 1)
	}
	c.networkVerified[network] = c.clock()
}

type ChainTransaction struct {
	Hash            string  `json:"hash"`
	BlockNumber     *uint32 `json:"blockNumber"`
	Timestamp       *uint64 `json:"timestamp"`
	From            string  `json:"from"`
	FromType        *uint8  `json:"fromType"`
	To              string  `json:"to"`
	ToType          *uint8  `json:"toType"`
	Value           *uint64 `json:"value"`
	SenderData      string  `json:"senderData"`
	RecipientData   string  `json:"recipientData"`
	Flags           *uint8  `json:"flags"`
	Proof           string  `json:"proof"`
	NetworkID       *uint8  `json:"networkId"`
	ExecutionResult *bool   `json:"executionResult"`
}

type ChainBlock struct {
	Hash         string             `json:"hash"`
	Number       uint32             `json:"number"`
	Timestamp    uint64             `json:"timestamp"`
	Network      string             `json:"network"`
	Type         string             `json:"type"`
	Transactions []ChainTransaction `json:"transactions"`
}

type ChainEvidence struct {
	Transaction    ChainTransaction
	IncludedAt     time.Time
	InclusionBlock uint32
	FinalityBlock  uint32
	FinalizedAt    time.Time
	Finalized      bool
}

func (c *RPCClient) Inspect(ctx context.Context, hash, network string) (ChainEvidence, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	expectedName, expectedID, err := ExpectedNetworkID(network)
	if err != nil {
		return ChainEvidence{}, err
	}
	if err := c.CheckNetwork(ctx, network); err != nil {
		return ChainEvidence{}, err
	}
	if err := c.requireConsensus(ctx); err != nil {
		return ChainEvidence{}, err
	}
	var tx ChainTransaction
	if err := c.call(ctx, "getTransactionByHash", []any{hash}, &tx); err != nil {
		if !errors.Is(err, ErrRPCNotFound) {
			return ChainEvidence{}, err
		}
		if err = c.call(ctx, "getTransactionFromMempool", []any{hash}, &tx); err != nil {
			return ChainEvidence{}, err
		}
	}
	if !strings.EqualFold(tx.Hash, hash) || tx.NetworkID == nil || *tx.NetworkID != expectedID || tx.Value == nil || tx.FromType == nil || tx.ToType == nil || tx.Flags == nil || (tx.BlockNumber != nil && tx.ExecutionResult == nil) {
		return ChainEvidence{}, ErrRPCMalformed
	}
	if tx.BlockNumber == nil {
		return ChainEvidence{Transaction: tx}, nil
	}
	var included ChainBlock
	if err := c.call(ctx, "getBlockByNumber", []any{*tx.BlockNumber, true}, &included); err != nil {
		return ChainEvidence{}, err
	}
	if included.Number != *tx.BlockNumber || included.Network != expectedName || included.Type != "micro" || included.Hash == "" || included.Timestamp == 0 || included.Transactions == nil {
		return ChainEvidence{}, ErrRPCMalformed
	}
	matched := false
	for _, inBlock := range included.Transactions {
		if strings.EqualFold(inBlock.Hash, hash) && inBlock.ExecutionResult != nil && *inBlock.ExecutionResult == *tx.ExecutionResult {
			matched = true
			break
		}
	}
	if !matched {
		return ChainEvidence{}, ErrRPCUnavailable
	} // possible reorg or unsynced node
	evidence := ChainEvidence{Transaction: tx, InclusionBlock: included.Number, IncludedAt: time.UnixMilli(int64(included.Timestamp)).UTC()}
	if tx.Timestamp == nil || *tx.Timestamp != included.Timestamp {
		return ChainEvidence{}, ErrRPCMalformed
	}
	macroHeight, err := c.macroBlockAfter(ctx, included.Number)
	if err != nil {
		return ChainEvidence{}, err
	}
	// Reported even while it is still in the future, and this is the point of
	// it: a caller that knows which macro block would finalise this payment
	// can wait for that height instead of re-running the whole pipeline every
	// couple of seconds to be told the same no. `Finalized` stays false, so
	// nothing downstream can mistake a height for a settlement.
	evidence.FinalityBlock = macroHeight
	head, err := c.latestBlock(ctx)
	if err != nil {
		return ChainEvidence{}, err
	}
	if head.Network != expectedName {
		return ChainEvidence{}, ErrRPCMalformed
	}
	if head.Number < macroHeight {
		return evidence, nil
	}
	var macro ChainBlock
	if err := c.call(ctx, "getBlockByNumber", []any{macroHeight, false}, &macro); err != nil {
		return ChainEvidence{}, err
	}
	if macro.Number != macroHeight || macro.Network != expectedName || macro.Type != "macro" || macro.Hash == "" || macro.Timestamp < included.Timestamp {
		return ChainEvidence{}, ErrRPCMalformed
	}
	// Re-read the inclusion height after observing the macro block. The first
	// lookup could have raced a reorg; finality must apply to the same chain.
	var canonical ChainBlock
	if err := c.call(ctx, "getBlockByNumber", []any{included.Number, false}, &canonical); err != nil {
		return ChainEvidence{}, err
	}
	if canonical.Hash != included.Hash || canonical.Number != included.Number || canonical.Network != expectedName {
		return ChainEvidence{}, ErrRPCUnavailable
	}
	evidence.FinalityBlock = macroHeight
	evidence.FinalizedAt = time.UnixMilli(int64(macro.Timestamp)).UTC()
	evidence.Finalized = true
	return evidence, nil
}

// MaxAddressTransactions bounds one discovery sweep.
//
// Kept small on purpose. The public endpoint charges "1 token per started 100
// items" out of 20 tokens per 10 seconds, and a provider's recent history is
// where a payment made minutes ago lives — walking a long tail would cost
// throughput and find nothing, because every candidate must fall inside the
// intent's own lifetime anyway.
const MaxAddressTransactions = 100

// TransactionsByAddress lists recent transactions involving one address.
//
// This is the only primitive that can find a payment nobody reported: the
// desktop QR flow completes inside Nimiq Pay, on a different device from the
// browser that is waiting, so no client is in a position to hand us a hash
// (docs/NIMIQ-PAYMENT-QR-INVESTIGATION-2026-09-16.md §4, ADR-006 gate G2).
//
// Official method, PoS JSON-RPC: `getTransactionsByAddress(address, max,
// startAt)`, returning transactions in descending order — latest first — for
// an address appearing as either sender or recipient. It requires an
// address-indexing node; rpc.nimiqwatch.com documents itself as "a Nimiq
// Proof-of-Stake History node", which satisfies that. The optional `startAt`
// pagination hash is left off: one bounded page of the newest transactions is
// exactly the window a live purchase can be settled from.
//
// Finding a transaction here settles nothing. It only nominates a hash, which
// then goes through the unchanged Inspect + verification path.
func (c *RPCClient) TransactionsByAddress(ctx context.Context, address, network string) ([]ChainTransaction, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	_, expectedID, err := ExpectedNetworkID(network)
	if err != nil {
		return nil, err
	}
	// Same guards as Inspect, and for the same reason: a node on the wrong
	// chain or without consensus can report a history that is not ours.
	// CheckNetwork rather than NetworkID directly, because the endpoint may not
	// serve getNetworkId at all and the fallback lives there.
	if err := c.CheckNetwork(ctx, network); err != nil {
		return nil, err
	}
	if err := c.requireConsensus(ctx); err != nil {
		return nil, err
	}
	normalized, err := ValidateAddress(address)
	if err != nil {
		return nil, err
	}
	var list []ChainTransaction
	// Three positional parameters, all of them. The node's deserializer counts
	// them before it looks at their types: two arguments fail with
	// "invalid length 2, expected … with 3 elements" (measured against
	// rpc.nimiqwatch.com, 2026-09-16), so the optional `startAt` pagination
	// hash is sent explicitly as null rather than omitted.
	if err := c.call(ctx, "getTransactionsByAddress", []any{normalized, MaxAddressTransactions, nil}, &list); err != nil {
		return nil, err
	}
	out := make([]ChainTransaction, 0, len(list))
	for _, tx := range list {
		// Anything under-described is dropped rather than guessed at. A reward
		// transaction, for instance, carries no sender of the shape we need.
		if tx.NetworkID == nil || *tx.NetworkID != expectedID || tx.Value == nil || tx.From == "" || tx.To == "" {
			continue
		}
		// A hash that is not canonical lowercase hex is not a hash. Dropped
		// here rather than downstream because this value becomes a discovery
		// cursor, and a malformed one would poison an address's whole sweep.
		if !canonicalHash(tx.Hash) {
			continue
		}
		out = append(out, tx)
	}
	return out, nil
}

func DecodeRecipientData(value string) ([]byte, error) {
	value = strings.TrimPrefix(value, "0x")
	if len(value)%2 != 0 {
		return nil, ErrRPCMalformed
	}
	data, err := hex.DecodeString(value)
	if err != nil {
		return nil, ErrRPCMalformed
	}
	return data, nil
}

// canonicalHash is the shape every Nimiq transaction hash has on the wire:
// 32 bytes as 64 lowercase hex characters.
func canonicalHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, c := range value {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return false
		}
	}
	return true
}
