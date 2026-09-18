package database

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// The desktop QR checkout, end to end against real PostgreSQL.
//
// Nobody reports a hash on this path: the customer scans a payment request with
// Nimiq Pay and confirms it on their phone, while the desktop only watches. The
// backend has to find the transaction on chain, decide it belongs to exactly
// this purchase, and then run the *same* verification that a mini-app payment
// runs. These tests are about the seam between those two halves.

// testDiscoverer answers the address query the sweep makes.
type testDiscoverer struct {
	mu    sync.Mutex
	txs   []nimiq.ChainTransaction
	err   error
	calls int
}

func (d *testDiscoverer) TransactionsByAddress(context.Context, string, string) ([]nimiq.ChainTransaction, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.calls++
	return d.txs, d.err
}

func (d *testDiscoverer) set(txs []nimiq.ChainTransaction, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.txs = txs
	d.err = err
}

func (d *testDiscoverer) count() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.calls
}

// chainPayment builds the on-chain transaction the customer's wallet made.
// `data` is the transaction's recipientData: the NP1 reference when the wallet
// carried it, empty when the scanner dropped it.
func chainPayment(p application.PurchaseRecord, hash string, luna uint64, from, to, data string, at time.Time) nimiq.ChainTransaction {
	zero := uint8(0)
	net := uint8(5)
	value := luna
	yes := true
	block := uint32(100)
	ms := uint64(at.UnixMilli())
	return nimiq.ChainTransaction{
		Hash: hash, BlockNumber: &block, Timestamp: &ms,
		From: from, FromType: &zero, To: to, ToType: &zero,
		Value: &value, RecipientData: hex.EncodeToString([]byte(data)),
		Flags: &zero, Proof: "aa", NetworkID: &net, ExecutionResult: &yes,
	}
}

// A paid QR purchase becomes a Pass with nothing but the chain and the worker.
func TestDiscoveredQrPaymentIssuesExactlyOnePass(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, providerWallet := paymentOffer(t, pool)
	chain := &testChain{err: nimiq.ErrRPCNotFound}
	finder := &testDiscoverer{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}

	p, _, err := svc.Create(ctx, customer, pkg, "qr-1")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if p.CandidateHash != "" {
		t.Fatal("a fresh intent must have no candidate")
	}

	// The customer pays from Nimiq Pay. The scanner did not carry the
	// reference through, which is the case the fallback exists for.
	hash := strings.Repeat("c", 64)
	paid := chainPayment(p, hash, uint64(p.Purchase.Snapshot.PriceLuna), string(customer.Wallet), providerWallet, "", time.Now().UTC())
	finder.set([]nimiq.ChainTransaction{paid}, nil)
	chain.set(nimiq.ChainEvidence{
		Transaction: paid, InclusionBlock: 100, IncludedAt: time.Now().UTC(),
		Finalized: true, FinalityBlock: 120, FinalizedAt: time.Now().UTC(),
	}, nil)

	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	got, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Purchase.Status != domain.PurchaseConfirmed || got.PassID == "" {
		t.Fatalf("expected a confirmed purchase with a Pass, got status=%s pass=%q", got.Purchase.Status, got.PassID)
	}
	if got.Purchase.TransactionHash != hash {
		t.Fatalf("transaction hash = %q, want %q", got.Purchase.TransactionHash, hash)
	}
	// The Pass belongs to the verified sender, and there is exactly one.
	var passes, receipts int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchased_passes WHERE purchase_id=$1`, p.Purchase.ID).Scan(&passes); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM verified_payments WHERE purchase_id=$1`, p.Purchase.ID).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if passes != 1 || receipts != 1 {
		t.Fatalf("passes=%d receipts=%d, want exactly one of each", passes, receipts)
	}
	// The candidate is marked as server-found, not as a client report.
	var origin string
	if err := pool.QueryRow(ctx, `SELECT origin FROM payment_candidates WHERE purchase_id=$1`, p.Purchase.ID).Scan(&origin); err != nil {
		t.Fatal(err)
	}
	if origin != "DISCOVERY" {
		t.Fatalf("candidate origin = %q, want DISCOVERY", origin)
	}
}

// 800 NIM never buys a 1000 NIM Pass, however the payment arrived.
func TestDiscoveryNeverIssuesAPassForAWrongPayment(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, pkg, providerWallet := paymentOffer(t, pool)
	strangerWallet := string(other.Wallet)

	cases := map[string]struct {
		hex  string
		luna uint64
		from string
		to   string
		data func(application.PurchaseRecord) string
	}{
		// `hex` keeps each case's transaction distinguishable *and* a valid
		// hash. It has to be both: the sweep now records the newest hash it
		// saw as the address's cursor, so a fixture hash that is not
		// canonical hex is not a realistic transaction to test against.
		"underpaid":       {hex: "1", luna: 1, data: func(application.PurchaseRecord) string { return "" }},
		"wrong sender":    {hex: "2", from: strangerWallet, data: func(application.PurchaseRecord) string { return "" }},
		"wrong recipient": {hex: "3", to: strangerWallet, data: func(application.PurchaseRecord) string { return "" }},
		"other reference": {hex: "4", data: func(application.PurchaseRecord) string { return "NP1:" + strings.Repeat("9", 32) }},
	}

	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			chain := &testChain{err: nimiq.ErrRPCNotFound}
			finder := &testDiscoverer{}
			svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}
			p, _, err := svc.Create(ctx, customer, pkg, "wrong-"+name)
			if err != nil {
				t.Fatalf("create: %v", err)
			}

			luna := uint64(p.Purchase.Snapshot.PriceLuna)
			if c.luna != 0 {
				luna = c.luna
			}
			from, to := string(customer.Wallet), providerWallet
			if c.from != "" {
				from = c.from
			}
			if c.to != "" {
				to = c.to
			}
			hash := strings.Repeat("d", 63) + c.hex
			paid := chainPayment(p, hash, luna, from, to, c.data(p), time.Now().UTC())
			finder.set([]nimiq.ChainTransaction{paid}, nil)

			if err := svc.DiscoverDue(ctx); err != nil {
				t.Fatalf("sweep: %v", err)
			}
			// Without this the assertions below would also hold for a sweep
			// that never looked at this purchase at all.
			if finder.count() == 0 {
				t.Fatal("the sweep never queried the chain; this case proves nothing")
			}
			got, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
			if err != nil {
				t.Fatalf("get: %v", err)
			}
			if got.PassID != "" {
				t.Fatalf("a wrong payment issued a Pass: %+v", got)
			}
			if got.CandidateHash != "" {
				t.Fatalf("a wrong payment was adopted as a candidate: %q", got.CandidateHash)
			}
			// Still payable: the customer can pay correctly.
			if got.Purchase.Status != domain.PurchasePaymentPending {
				t.Fatalf("status = %s, want the intent to remain payable", got.Purchase.Status)
			}
			// Clear the way for the next sub-case's intent.
			if _, err := svc.Store.Cancel(ctx, p.Purchase.ID, customer.ID, time.Now().UTC()); err != nil {
				t.Fatalf("cancel: %v", err)
			}
		})
	}
}

// One transaction settles one purchase. A second purchase cannot adopt a hash
// that is already spoken for, even before the first one settles.
func TestDiscoveredHashCannotSettleTwoPurchases(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, providerWallet := paymentOffer(t, pool)
	repo := PaymentRepository{Pool: pool}
	chain := &testChain{err: nimiq.ErrRPCNotFound}
	finder := &testDiscoverer{}
	svc := application.Payments{Store: repo, Chain: chain, Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}

	first, _, err := svc.Create(ctx, customer, pkg, "dup-1")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	hash := strings.Repeat("e", 64)
	now := time.Now().UTC()
	if _, err := repo.Discover(ctx, first.Purchase.ID, customer.ID, hash, now); err != nil {
		t.Fatalf("first adoption: %v", err)
	}

	// A second intent for another customer's identical purchase must not be
	// able to take the same transaction.
	secondCustomer, _, otherPkg, _ := paymentOffer(t, pool)
	_ = providerWallet
	second, _, err := svc.Create(ctx, secondCustomer, otherPkg, "dup-2")
	if err != nil {
		t.Fatalf("second create: %v", err)
	}
	if _, err := repo.Discover(ctx, second.Purchase.ID, secondCustomer.ID, hash, now); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("expected a conflict for a transaction already claimed, got %v", err)
	}
}

// Concurrent sweeps must not both adopt the same transaction.
func TestConcurrentDiscoveryAdoptsOnce(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, _ := paymentOffer(t, pool)
	repo := PaymentRepository{Pool: pool}
	svc := application.Payments{Store: repo, Chain: &testChain{err: nimiq.ErrRPCNotFound}, Network: domain.NimiqTestnet, Now: time.Now}
	p, _, err := svc.Create(ctx, customer, pkg, "race-1")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	hash := strings.Repeat("f", 64)
	now := time.Now().UTC()
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := repo.Discover(ctx, p.Purchase.ID, customer.ID, hash, now)
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	for err := range results {
		// Every caller either adopted the same hash or lost harmlessly; none
		// may create a second candidate.
		if err != nil && !errors.Is(err, application.ErrConflict) {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	var candidates int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM payment_candidates WHERE purchase_id=$1`, p.Purchase.ID).Scan(&candidates); err != nil {
		t.Fatal(err)
	}
	if candidates != 1 {
		t.Fatalf("candidates = %d, want exactly 1", candidates)
	}
}

// An unreachable RPC must never conclude that no payment exists, and must back
// off rather than re-query the same address on every tick: asking a node that
// is down more often will not make it answer.
func TestDiscoverySweepBacksOffAndKeepsThePurchasePayable(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, _ := paymentOffer(t, pool)
	finder := &testDiscoverer{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: &testChain{err: nimiq.ErrRPCNotFound}, Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}
	p, _, err := svc.Create(ctx, customer, pkg, "rpc-down")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	finder.set(nil, nimiq.ErrRPCUnavailable)
	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("an outage must not fail the sweep: %v", err)
	}
	after := finder.count()

	// Immediately sweeping again must not re-query: the backoff interval has
	// not elapsed.
	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if finder.count() != after {
		t.Fatalf("expected the address to back off, queried %d times", finder.count())
	}

	got, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Purchase.Status != domain.PurchasePaymentPending {
		t.Fatalf("status = %s; an RPC failure must not fail a payment", got.Purchase.Status)
	}
	if got.CandidateHash != "" {
		t.Fatalf("nothing may be adopted from a failed lookup: %q", got.CandidateHash)
	}
}

// Our own throttling is a different fact from an endpoint being down, and the
// address must not be punished for it.
//
// An outage earns the backoff above. A 429 is Nimpass having asked too much: it
// clears on the gateway's own fixed schedule, the adapter already refuses a
// call the window cannot serve without spending anything on it, and the next
// tick is therefore free. Recording it as a failure backed the address off by
// up to five minutes — on the desktop QR checkout, five minutes of a paid
// purchase looking unpaid (ADR-022).
func TestThrottlingDoesNotBackOffTheAddress(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, providerWallet := paymentOffer(t, pool)
	finder := &testDiscoverer{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: newHashChain(), Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}
	p, _, err := svc.Create(ctx, customer, pkg, "rpc-429")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	finder.set(nil, nimiq.ErrRPCRateLimited)
	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("a 429 must not fail the sweep: %v", err)
	}
	after := finder.count()
	if after == 0 {
		t.Fatal("the sweep never reached the address")
	}

	// The very next tick looks again, so the moment the window reopens the
	// payment is found.
	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if finder.count() != after+1 {
		t.Fatalf("a throttled address was not re-queried: %d then %d", after, finder.count())
	}

	// And nothing was written down, because nothing was learned: no cursor, no
	// failure count, not even a scan time.
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM payment_discovery_cursors WHERE recipient_wallet=$1 AND network='TESTNET'`, providerWallet).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatalf("a look that never happened wrote %d cursor rows", rows)
	}

	got, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Purchase.Status != domain.PurchasePaymentPending || got.CandidateHash != "" {
		t.Fatalf("throttling changed the purchase: %s/%q", got.Purchase.Status, got.CandidateHash)
	}
}

// ---------------------------------------------------------------------------
// Automatic settlement: the QR path, with nobody reporting anything
// ---------------------------------------------------------------------------

// hashChain answers Inspect per transaction hash, which the multi-purchase
// cases need: one sweep can adopt two different hashes for two purchases and
// each has to verify against its own transaction.
type hashChain struct {
	mu sync.Mutex
	by map[string]nimiq.ChainEvidence
}

func newHashChain() *hashChain { return &hashChain{by: map[string]nimiq.ChainEvidence{}} }

func (c *hashChain) add(tx nimiq.ChainTransaction, at time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.by[strings.ToLower(tx.Hash)] = nimiq.ChainEvidence{
		Transaction: tx, InclusionBlock: 100, IncludedAt: at,
		Finalized: true, FinalityBlock: 120, FinalizedAt: at.Add(time.Second),
	}
}

func (c *hashChain) Inspect(_ context.Context, hash, _ string) (nimiq.ChainEvidence, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	evidence, ok := c.by[strings.ToLower(hash)]
	if !ok {
		return nimiq.ChainEvidence{}, nimiq.ErrRPCNotFound
	}
	return evidence, nil
}

func hexHash(seed byte) string { return strings.Repeat(string(seed), 64) }

// Two live intents, one provider, one price — told apart only by the
// reference each carries on chain.
//
// This is the case that makes recipient+amount matching unusable and the
// reason every intent gets 16 random bytes of its own. Both customers pay the
// same provider the same amount within seconds of each other; each Pass must
// land on the purchase whose reference was in the transaction.
func TestDiscoveryBindsEachPaymentToItsOwnReference(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	alice, bob, pkg, providerWallet := paymentOffer(t, pool)
	chain := newHashChain()
	finder := &testDiscoverer{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}

	first, _, err := svc.Create(ctx, alice, pkg, "collide-a")
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := svc.Create(ctx, bob, pkg, "collide-b")
	if err != nil {
		t.Fatal(err)
	}
	if first.Purchase.PaymentReference == second.Purchase.PaymentReference {
		t.Fatal("two intents shared a payment reference")
	}

	at := time.Now().UTC()
	price := uint64(first.Purchase.Snapshot.PriceLuna)
	// Deliberately crossed: Alice's transaction carries Alice's reference but
	// is paid from Bob's address, and vice versa. Only the reference may
	// decide, so crossing the senders proves the reference is what decided.
	payA := chainPayment(first, hexHash('a'), price, string(bob.Wallet), providerWallet, string(first.Purchase.PaymentReference), at)
	payB := chainPayment(second, hexHash('b'), price, string(alice.Wallet), providerWallet, string(second.Purchase.PaymentReference), at)
	chain.add(payA, at)
	chain.add(payB, at)
	finder.set([]nimiq.ChainTransaction{payB, payA}, nil)

	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	for _, want := range []struct {
		who      application.Identity
		purchase domain.ID
		hash     string
	}{{alice, first.Purchase.ID, hexHash('a')}, {bob, second.Purchase.ID, hexHash('b')}} {
		got, err := svc.Store.Get(ctx, want.purchase, want.who.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.Purchase.Status != domain.PurchaseConfirmed {
			t.Fatalf("purchase %s did not settle: %s/%s", want.purchase, got.Purchase.Status, got.FailureCategory)
		}
		if got.Purchase.TransactionHash != want.hash {
			t.Fatalf("purchase %s settled on %q, want %q", want.purchase, got.Purchase.TransactionHash, want.hash)
		}
		if got.PassID == "" {
			t.Fatalf("purchase %s issued no Pass", want.purchase)
		}
		// Each Pass belongs to its buyer, not to the address that paid.
		owned, err := PaymentRepository{Pool: pool}.GetPass(ctx, got.PassID, want.who.ID)
		if err != nil {
			t.Fatalf("buyer %s cannot read their Pass: %v", want.who.ID, err)
		}
		if owned.OwnerIdentityID != want.who.ID {
			t.Fatalf("Pass owner %q is not buyer %q", owned.OwnerIdentityID, want.who.ID)
		}
	}
}

// A payment carrying a reference that belongs to no live intent settles
// nothing — not the purchase it nearly matches, and not any other.
func TestDiscoveryRefusesAPaymentWhoseReferenceIsUnknown(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, providerWallet := paymentOffer(t, pool)
	chain := newHashChain()
	finder := &testDiscoverer{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}

	p, _, err := svc.Create(ctx, customer, pkg, "unknown-ref")
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC()
	// Right provider, right amount, right customer — a reference that is not
	// this intent's.
	stray := chainPayment(p, hexHash('e'), uint64(p.Purchase.Snapshot.PriceLuna), string(customer.Wallet), providerWallet, "NP1:"+strings.Repeat("7", 32), at)
	chain.add(stray, at)
	finder.set([]nimiq.ChainTransaction{stray}, nil)

	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if finder.count() == 0 {
		t.Fatal("the sweep never queried the chain; this case proves nothing")
	}
	got, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Purchase.Status != domain.PurchasePaymentPending || got.CandidateHash != "" || got.PassID != "" {
		t.Fatalf("a foreign reference settled something: %+v", got)
	}
}

// Fifty intents on one provider cost one address query, not fifty.
//
// The sweep is grouped by payout address because every intent waiting on that
// address is waiting on the same list of transactions. Getting this wrong is
// not just slow: on the public gateway's token budget it is the difference
// between a sweep that runs and a sweep that is throttled into uselessness.
func TestDiscoveryQueriesOneAddressOnceForManyPendingIntents(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	chain := newHashChain()
	finder := &testDiscoverer{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}

	// One provider, many customers, all waiting.
	customer, _, pkg, _ := paymentOffer(t, pool)
	const others = 7
	for i := 0; i < others; i++ {
		buyer := enrolBuyer(t, pool)
		if _, _, err := svc.Create(ctx, buyer, pkg, ""); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	if _, _, err := svc.Create(ctx, customer, pkg, ""); err != nil {
		t.Fatal(err)
	}

	var pending int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchases WHERE status='PAYMENT_PENDING'`).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != others+1 {
		t.Fatalf("fixture produced %d pending intents, want %d", pending, others+1)
	}

	finder.set(nil, nil)
	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if finder.count() != 1 {
		t.Fatalf("%d pending intents on one address cost %d address queries, want 1", pending, finder.count())
	}
}

// The cursor: a second sweep does not re-examine what the first already saw.
func TestDiscoveryAdvancesItsCursorPastExaminedTransactions(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, providerWallet := paymentOffer(t, pool)
	chain := newHashChain()
	finder := &testDiscoverer{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}

	p, _, err := svc.Create(ctx, customer, pkg, "cursor")
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC()
	// Somebody else's traffic on the same provider address, seen first.
	noise := chainPayment(p, hexHash('9'), 1, string(customer.Wallet), providerWallet, "", at)
	finder.set([]nimiq.ChainTransaction{noise}, nil)
	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("first sweep: %v", err)
	}

	var cursor string
	if err := pool.QueryRow(ctx, `SELECT last_seen_hash FROM payment_discovery_cursors WHERE recipient_wallet=$1 AND network='TESTNET'`, providerWallet).Scan(&cursor); err != nil {
		t.Fatalf("no cursor was recorded: %v", err)
	}
	if cursor != hexHash('9') {
		t.Fatalf("cursor = %q, want the head of what was scanned", cursor)
	}

	// The real payment arrives above it. The sweep must look at the new
	// transaction and stop at the one it already knows.
	paid := chainPayment(p, hexHash('a'), uint64(p.Purchase.Snapshot.PriceLuna), string(customer.Wallet), providerWallet, string(p.Purchase.PaymentReference), at)
	chain.add(paid, at)
	finder.set([]nimiq.ChainTransaction{paid, noise}, nil)
	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("second sweep: %v", err)
	}

	got, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Purchase.Status != domain.PurchaseConfirmed || got.PassID == "" {
		t.Fatalf("the new payment did not settle: %s/%s", got.Purchase.Status, got.FailureCategory)
	}
	if err := pool.QueryRow(ctx, `SELECT last_seen_hash FROM payment_discovery_cursors WHERE recipient_wallet=$1 AND network='TESTNET'`, providerWallet).Scan(&cursor); err != nil {
		t.Fatal(err)
	}
	if cursor != hexHash('a') {
		t.Fatalf("cursor = %q, want it advanced to the new head", cursor)
	}
}

// A failed lookup leaves the cursor where it was: we did not look, so we know
// nothing new, and the next sweep must re-read the same window.
func TestDiscoveryDoesNotAdvanceItsCursorOnAFailedLookup(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, providerWallet := paymentOffer(t, pool)
	finder := &testDiscoverer{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: newHashChain(), Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}

	if _, _, err := svc.Create(ctx, customer, pkg, "throttled"); err != nil {
		t.Fatal(err)
	}
	finder.set(nil, nimiq.ErrRPCUnavailable)
	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("a failed sweep must not fail the worker: %v", err)
	}

	var cursor *string
	var failures int
	if err := pool.QueryRow(ctx, `SELECT last_seen_hash,failures FROM payment_discovery_cursors WHERE recipient_wallet=$1 AND network='TESTNET'`, providerWallet).Scan(&cursor, &failures); err != nil {
		t.Fatal(err)
	}
	if cursor != nil {
		t.Fatalf("a failed lookup advanced the cursor to %q", *cursor)
	}
	if failures != 1 {
		t.Fatalf("failures = %d, want 1", failures)
	}
}

// Two workers sweeping the same address at the same time settle one purchase
// once. Discovery is safe to run on several replicas.
func TestConcurrentDiscoveryIssuesOnePass(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, providerWallet := paymentOffer(t, pool)
	chain := newHashChain()
	finder := &testDiscoverer{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}

	p, _, err := svc.Create(ctx, customer, pkg, "race")
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC()
	paid := chainPayment(p, hexHash('f'), uint64(p.Purchase.Snapshot.PriceLuna), string(customer.Wallet), providerWallet, string(p.Purchase.PaymentReference), at)
	chain.add(paid, at)
	finder.set([]nimiq.ChainTransaction{paid}, nil)

	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = svc.DiscoverDue(ctx)
		}()
	}
	wg.Wait()

	var passes, receipts, candidates int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM purchased_passes WHERE purchase_id=$1`, p.Purchase.ID).Scan(&passes); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM verified_payments WHERE transaction_hash=$1`, hexHash('f')).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM payment_candidates WHERE purchase_id=$1`, p.Purchase.ID).Scan(&candidates); err != nil {
		t.Fatal(err)
	}
	if passes != 1 || receipts != 1 || candidates != 1 {
		t.Fatalf("racing sweeps produced passes=%d receipts=%d candidates=%d, want 1 of each", passes, receipts, candidates)
	}
}

// A payment that lands after the intent expired but inside the settlement
// grace is still the customer's payment, and still settles.
func TestDiscoverySettlesALatePaymentInsideTheGrace(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, providerWallet := paymentOffer(t, pool)
	chain := newHashChain()
	finder := &testDiscoverer{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}

	p, _, err := svc.Create(ctx, customer, pkg, "late")
	if err != nil {
		t.Fatal(err)
	}
	// Age the intent so now sits past its expiry but inside the grace — the
	// customer took their time at the phone.
	shift := domain.PurchaseIntentTTL + time.Minute
	if _, err := pool.Exec(ctx, `UPDATE purchases SET created_at=created_at-$2::interval,expires_at=expires_at-$2::interval WHERE id=$1`, p.Purchase.ID, shift); err != nil {
		t.Fatal(err)
	}
	reread, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	paidAt := reread.Purchase.CreatedAt.Add(2 * time.Minute)
	paid := chainPayment(reread, hexHash('b'), uint64(reread.Purchase.Snapshot.PriceLuna), string(customer.Wallet), providerWallet, string(reread.Purchase.PaymentReference), paidAt)
	chain.add(paid, paidAt)
	finder.set([]nimiq.ChainTransaction{paid}, nil)

	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	got, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Purchase.Status != domain.PurchaseConfirmed || got.PassID == "" {
		t.Fatalf("a payment inside the grace must settle: %s/%s", got.Purchase.Status, got.FailureCategory)
	}
}

// Past the grace the intent is no longer swept at all. A transaction found
// later cannot be retrofitted onto it.
func TestDiscoveryIgnoresAnIntentPastTheSettlementGrace(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, pkg, providerWallet := paymentOffer(t, pool)
	chain := newHashChain()
	finder := &testDiscoverer{}
	svc := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Discovery: finder, Network: domain.NimiqTestnet, Now: time.Now}

	p, _, err := svc.Create(ctx, customer, pkg, "stale")
	if err != nil {
		t.Fatal(err)
	}
	shift := domain.PurchaseIntentTTL + domain.PurchaseSettlementGrace + time.Minute
	if _, err := pool.Exec(ctx, `UPDATE purchases SET created_at=created_at-$2::interval,expires_at=expires_at-$2::interval WHERE id=$1`, p.Purchase.ID, shift); err != nil {
		t.Fatal(err)
	}
	reread, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC()
	paid := chainPayment(reread, hexHash('c'), uint64(reread.Purchase.Snapshot.PriceLuna), string(customer.Wallet), providerWallet, string(reread.Purchase.PaymentReference), at)
	chain.add(paid, at)
	finder.set([]nimiq.ChainTransaction{paid}, nil)

	if err := svc.DiscoverDue(ctx); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if finder.count() != 0 {
		t.Fatalf("an intent past its grace was still swept (%d queries)", finder.count())
	}
	got, err := svc.Store.Get(ctx, p.Purchase.ID, customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Purchase.Status == domain.PurchaseConfirmed || got.PassID != "" {
		t.Fatalf("a purchase past its grace settled anyway: %+v", got)
	}
}

// enrolBuyer creates one more authenticated customer, so a test can put
// several live intents on the same provider address.
func enrolBuyer(t *testing.T, pool *pgxpool.Pool) application.Identity {
	t.Helper()
	wallet, _, _ := missionKey(t)
	id := paymentID(t)
	if _, err := pool.Exec(context.Background(), `INSERT INTO identities(id,wallet_address,created_at) VALUES($1,$2,$3)`, id, wallet, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	return application.Identity{ID: id, Wallet: wallet}
}
