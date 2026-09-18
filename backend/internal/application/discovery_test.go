package application

import (
	"context"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// Server-side discovery is what makes the QR checkout settle: the payment
// happens inside Nimiq Pay on a phone, so nobody is in a position to report a
// transaction hash to the backend, and the server has to find one itself.
//
// These tests are about the one decision discovery makes — *which* transaction
// may be adopted as a purchase's candidate. Everything after adoption is the
// pre-existing verification path (inclusion, finality, uniqueness, one Pass),
// which has its own tests; nothing here can settle a payment on its own.

const (
	providerWallet = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000"
	buyerWallet    = "NQ07 0000 0000 0000 0000 0000 0000 0000 0097"
	strangerWallet = "NQ07 0000 0000 0000 0000 0000 0000 0000 00J4"
)

func testIntent(t *testing.T) domain.Purchase {
	t.Helper()
	recipient, err := domain.NewWalletAddress(providerWallet)
	if err != nil {
		t.Fatalf("recipient: %v", err)
	}
	buyer, err := domain.NewWalletAddress(buyerWallet)
	if err != nil {
		t.Fatalf("buyer: %v", err)
	}
	created := time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC)
	return domain.Purchase{
		ID:               domain.ID("11111111-1111-4111-8111-111111111111"),
		ExpectedWallet:   buyer,
		PaymentReference: domain.PaymentReference("NP1:" + strings.Repeat("a", 32)),
		Status:           domain.PurchasePaymentPending,
		CreatedAt:        created,
		ExpiresAt:        created.Add(domain.PurchaseIntentTTL),
		Snapshot: domain.PurchaseSnapshot{
			// 1000 NIM, the mission's example.
			PriceLuna: 100_000_000,
			Recipient: recipient,
			Network:   domain.NimiqTestnet,
		},
	}
}

// chainTx builds a transaction as the RPC would report one.
func chainTx(hash string, from, to string, luna uint64, data string, at time.Time) nimiq.ChainTransaction {
	network := uint8(5) // TestAlbatross
	value := luna
	ms := uint64(at.UnixMilli())
	return nimiq.ChainTransaction{
		Hash:          hash,
		From:          from,
		To:            to,
		Value:         &value,
		NetworkID:     &network,
		Timestamp:     &ms,
		RecipientData: hex.EncodeToString([]byte(data)),
	}
}

func hashOf(seed string) string {
	return strings.Repeat(seed, 64)[:64]
}

func TestDiscoveryAdoptsTheExactPayment(t *testing.T) {
	intent := testIntent(t)
	now := intent.CreatedAt.Add(2 * time.Minute)
	paid := chainTx(hashOf("a"), buyerWallet, providerWallet, 100_000_000, string(intent.PaymentReference), now.Add(-time.Minute))

	if got := matchDiscovered(intent, []nimiq.ChainTransaction{paid}, now); got != hashOf("a") {
		t.Fatalf("expected the matching payment to be adopted, got %q", got)
	}
}

// A payment scanned into Nimiq Pay may arrive with no data field at all — no
// official source says a request link's `message` reaches `recipientData`. It
// must still settle, because the sender, recipient, exact amount and window
// already identify it, and refusing it would take real money for no Pass.
func TestDiscoveryAdoptsAPaymentWithNoReference(t *testing.T) {
	intent := testIntent(t)
	now := intent.CreatedAt.Add(2 * time.Minute)
	paid := chainTx(hashOf("b"), buyerWallet, providerWallet, 100_000_000, "", now.Add(-time.Minute))

	if got := matchDiscovered(intent, []nimiq.ChainTransaction{paid}, now); got != hashOf("b") {
		t.Fatalf("a reference-less exact payment must still be discoverable, got %q", got)
	}
}

// The asymmetry that keeps the reference meaningful: absent is a fallback,
// but *wrong* is a refusal (docs/05 §142).
func TestDiscoveryRefusesAnotherPurchasesReference(t *testing.T) {
	intent := testIntent(t)
	now := intent.CreatedAt.Add(2 * time.Minute)
	other := "NP1:" + strings.Repeat("b", 32)
	paid := chainTx(hashOf("c"), buyerWallet, providerWallet, 100_000_000, other, now.Add(-time.Minute))

	if got := matchDiscovered(intent, []nimiq.ChainTransaction{paid}, now); got != "" {
		t.Fatalf("a transaction carrying another purchase's reference must not settle this one, got %q", got)
	}
}

func TestDiscoveryRefusesEverythingThatIsNotThisPayment(t *testing.T) {
	intent := testIntent(t)
	now := intent.CreatedAt.Add(2 * time.Minute)
	within := now.Add(-time.Minute)
	reference := string(intent.PaymentReference)

	underpaid := chainTx(hashOf("d"), buyerWallet, providerWallet, 80_000_000, reference, within)
	overpaid := chainTx(hashOf("e"), buyerWallet, providerWallet, 120_000_000, reference, within)
	offByOneLuna := chainTx(hashOf("f"), buyerWallet, providerWallet, 99_999_999, reference, within)
	wrongRecipient := chainTx(hashOf("1"), buyerWallet, strangerWallet, 100_000_000, reference, within)
	// A stranger's address *and* nothing on chain tying the transfer to this
	// purchase. Both halves matter: with the reference present the sender is
	// deliberately no longer part of the match (see
	// TestDiscoveryMatchesAReferencedPaymentFromAnyAccount), so an
	// unreferenced transfer is what the sender rule is actually there for.
	wrongSender := chainTx(hashOf("2"), strangerWallet, providerWallet, 100_000_000, "", within)
	tooEarly := chainTx(hashOf("3"), buyerWallet, providerWallet, 100_000_000, reference, intent.CreatedAt.Add(-time.Hour))
	tooLate := chainTx(hashOf("4"), buyerWallet, providerWallet, 100_000_000, reference, intent.ExpiresAt.Add(time.Hour))
	unexplainedData := chainTx(hashOf("5"), buyerWallet, providerWallet, 100_000_000, "hello", within)

	wrongNetwork := chainTx(hashOf("6"), buyerWallet, providerWallet, 100_000_000, reference, within)
	mainnet := uint8(24)
	wrongNetwork.NetworkID = &mainnet

	cases := map[string]nimiq.ChainTransaction{
		// The mission's headline case: 800 NIM never buys a 1000 NIM Pass.
		"underpaid":         underpaid,
		"overpaid":          overpaid,
		"one Luna short":    offByOneLuna,
		"wrong recipient":   wrongRecipient,
		"wrong sender":      wrongSender,
		"before the intent": tooEarly,
		"after the window":  tooLate,
		"unexplained data":  unexplainedData,
		"wrong network":     wrongNetwork,
	}
	for name, tx := range cases {
		t.Run(name, func(t *testing.T) {
			if got := matchDiscovered(intent, []nimiq.ChainTransaction{tx}, now); got != "" {
				t.Fatalf("expected no match, adopted %q", got)
			}
		})
	}
}

// An intent with no known buyer and no reference on chain cannot be matched:
// recipient and amount alone would match any stranger paying the same provider
// for the same Pass.
func TestDiscoveryRefusesAnUnreferencedIntentWithNoExpectedWallet(t *testing.T) {
	intent := testIntent(t)
	intent.ExpectedWallet = ""
	now := intent.CreatedAt.Add(2 * time.Minute)
	paid := chainTx(hashOf("a"), buyerWallet, providerWallet, 100_000_000, "", now.Add(-time.Minute))

	if got := matchDiscovered(intent, []nimiq.ChainTransaction{paid}, now); got != "" {
		t.Fatalf("expected no match without an expected wallet, adopted %q", got)
	}
}

// The change this whole mission turns on.
//
// Nimiq Pay pays from whichever account the customer approves and gives the
// mini app no way to pin one, so requiring the sender to be the wallet the
// intent was issued to meant a correctly-paid QR purchase could be
// unmatchable forever. A transaction carrying this intent's own reference —
// 16 random bytes the server issued for this one purchase — is bound to it
// more tightly than an address ever bound it.
//
// Everything else still has to hold, which is what the refusal table above
// asserts: this widens the sender rule and nothing else.
func TestDiscoveryMatchesAReferencedPaymentFromAnyAccount(t *testing.T) {
	intent := testIntent(t)
	now := intent.CreatedAt.Add(2 * time.Minute)
	reference := string(intent.PaymentReference)
	within := now.Add(-time.Minute)

	// A second account of the customer's wallet, or any account at all: the
	// matcher cannot tell the difference and no longer needs to.
	fromAnother := chainTx(hashOf("a"), strangerWallet, providerWallet, 100_000_000, reference, within)
	if got := matchDiscovered(intent, []nimiq.ChainTransaction{fromAnother}, now); got != hashOf("a") {
		t.Fatalf("a referenced payment must match whoever sent it, got %q", got)
	}

	// And the widening is exactly one rule wide. A referenced transaction
	// that is wrong in any other way is still refused.
	for name, tx := range map[string]nimiq.ChainTransaction{
		"wrong amount":    chainTx(hashOf("b"), strangerWallet, providerWallet, 99_999_999, reference, within),
		"wrong recipient": chainTx(hashOf("c"), strangerWallet, strangerWallet, 100_000_000, reference, within),
		"after the window": chainTx(hashOf("d"), strangerWallet, providerWallet, 100_000_000, reference,
			intent.ExpiresAt.Add(time.Hour)),
	} {
		t.Run(name, func(t *testing.T) {
			if got := matchDiscovered(intent, []nimiq.ChainTransaction{tx}, now); got != "" {
				t.Fatalf("expected no match, adopted %q", got)
			}
		})
	}
}

// Two indistinguishable payments are a question for a human. Picking one would
// be guessing which of a customer's two transfers this purchase consumed.
func TestDiscoveryRefusesToChooseBetweenAmbiguousPayments(t *testing.T) {
	intent := testIntent(t)
	now := intent.CreatedAt.Add(5 * time.Minute)
	first := chainTx(hashOf("a"), buyerWallet, providerWallet, 100_000_000, "", now.Add(-2*time.Minute))
	second := chainTx(hashOf("b"), buyerWallet, providerWallet, 100_000_000, "", now.Add(-time.Minute))

	if got := matchDiscovered(intent, []nimiq.ChainTransaction{first, second}, now); got != "" {
		t.Fatalf("expected discovery to decline an ambiguous pair, adopted %q", got)
	}
}

// The same transaction reported twice in one page is not ambiguity.
func TestDiscoveryToleratesADuplicatedListing(t *testing.T) {
	intent := testIntent(t)
	now := intent.CreatedAt.Add(2 * time.Minute)
	paid := chainTx(hashOf("a"), buyerWallet, providerWallet, 100_000_000, "", now.Add(-time.Minute))

	if got := matchDiscovered(intent, []nimiq.ChainTransaction{paid, paid}, now); got != hashOf("a") {
		t.Fatalf("expected one adoption, got %q", got)
	}
}

// --- The sweep around the matcher ------------------------------------------

type discoveryStub struct {
	PaymentStore
	due         []DiscoveryAddress
	record      PurchaseRecord
	chainErr    error
	txs         []nimiq.ChainTransaction
	scans       int
	failures    int
	cursors     []string
	lookups     int
	discovered  []string
	discoverErr error
}

func (s *discoveryStub) DueDiscoveryAddresses(context.Context, time.Time, int) ([]DiscoveryAddress, error) {
	return s.due, nil
}

func (s *discoveryStub) NoteDiscoveryScan(_ context.Context, _ domain.WalletAddress, _ domain.NimiqNetwork, head string, _ time.Time) error {
	s.scans++
	s.cursors = append(s.cursors, head)
	return nil
}

func (s *discoveryStub) NoteDiscoveryFailure(context.Context, domain.WalletAddress, domain.NimiqNetwork, time.Time) error {
	s.failures++
	return nil
}

func (s *discoveryStub) Get(context.Context, domain.ID, domain.ID) (PurchaseRecord, error) {
	return s.record, nil
}

func (s *discoveryStub) Discover(_ context.Context, _, _ domain.ID, hash string, _ time.Time) (PurchaseRecord, error) {
	s.discovered = append(s.discovered, hash)
	return s.record, s.discoverErr
}

func (s *discoveryStub) TransactionsByAddress(context.Context, string, string) ([]nimiq.ChainTransaction, error) {
	s.lookups++
	if s.chainErr != nil {
		return nil, s.chainErr
	}
	return s.txs, nil
}

func sweepFixture(t *testing.T) (*discoveryStub, Payments, domain.Purchase) {
	t.Helper()
	intent := testIntent(t)
	stub := &discoveryStub{
		due: []DiscoveryAddress{{
			Recipient: intent.Snapshot.Recipient,
			Network:   domain.NimiqTestnet,
			Purchases: []PendingIntent{{
				PurchaseID: intent.ID,
				Customer:   Identity{ID: domain.ID("22222222-2222-4222-8222-222222222222")},
			}},
		}},
		record: PurchaseRecord{Purchase: intent},
	}
	now := intent.CreatedAt.Add(2 * time.Minute)
	return stub, Payments{
		Store:     stub,
		Discovery: stub,
		Network:   domain.NimiqTestnet,
		Now:       func() time.Time { return now },
	}, intent
}

// A throttled or unreachable RPC means "we did not look", never "there is no
// payment" — the intent must stay pending and be swept again (docs/05 §95).
func TestSweepTreatsRPCFailureAsUnknownNotAbsent(t *testing.T) {
	for name, chainErr := range map[string]error{
		"unavailable": nimiq.ErrRPCUnavailable,
		"timeout":     context.DeadlineExceeded,
		"malformed":   nimiq.ErrRPCMalformed,
	} {
		t.Run(name, func(t *testing.T) {
			stub, payments, _ := sweepFixture(t)
			stub.chainErr = chainErr

			if err := payments.DiscoverDue(context.Background()); err != nil {
				t.Fatalf("a failed lookup must not fail the sweep: %v", err)
			}
			if len(stub.discovered) != 0 {
				t.Fatalf("nothing may be adopted from a failed lookup, got %v", stub.discovered)
			}
			// Backed off rather than re-queried on the next tick — and the
			// cursor is untouched, because we did not look.
			if stub.failures != 1 || stub.scans != 0 {
				t.Fatalf("failures=%d scans=%d, want 1 and 0", stub.failures, stub.scans)
			}
		})
	}
}

// Our own throttling is not the address's fault, and must not be recorded as
// if it were.
//
// An unreachable endpoint earns a backoff: asking it again sooner will not make
// it answer. A rate limit is the opposite — it is Nimpass having asked too
// much, it clears on a fixed schedule, and the adapter already refuses a call
// the window cannot serve without spending anything on it. Counting it as a
// failure backed the address off by up to five minutes, which on the QR
// checkout is five minutes of a paid purchase looking unpaid (ADR-022).
func TestSweepDoesNotPenaliseAnAddressForOurOwnThrottling(t *testing.T) {
	stub, payments, _ := sweepFixture(t)
	stub.chainErr = nimiq.ErrRPCRateLimited

	if err := payments.DiscoverDue(context.Background()); err != nil {
		t.Fatalf("a throttled sweep must not fail: %v", err)
	}
	if len(stub.discovered) != 0 {
		t.Fatalf("nothing may be adopted without a look, got %v", stub.discovered)
	}
	// Neither a failure nor a scan: the cursor is where it was, the backoff is
	// where it was, and the address is due again on the next tick.
	if stub.failures != 0 || stub.scans != 0 {
		t.Fatalf("failures=%d scans=%d, want 0 and 0", stub.failures, stub.scans)
	}
}

func TestSweepAdoptsAndThenLeavesVerificationAlone(t *testing.T) {
	stub, payments, intent := sweepFixture(t)
	stub.txs = []nimiq.ChainTransaction{
		chainTx(hashOf("a"), buyerWallet, providerWallet, 100_000_000, string(intent.PaymentReference), intent.CreatedAt.Add(time.Minute)),
	}
	// Reconcile runs straight after adoption; with no chain inspector wired it
	// returns an error, which must not be mistaken for a settlement.
	_ = payments.DiscoverDue(context.Background())

	if len(stub.discovered) != 1 || stub.discovered[0] != hashOf("a") {
		t.Fatalf("expected exactly one adoption of the matching hash, got %v", stub.discovered)
	}
}

// A purchase that acquired a candidate between listing and sweeping is left
// alone: the client got there first, and one purchase has one candidate.
func TestSweepSkipsAPurchaseThatIsNoLongerPending(t *testing.T) {
	stub, payments, intent := sweepFixture(t)
	stub.record.CandidateHash = hashOf("9")
	stub.txs = []nimiq.ChainTransaction{
		chainTx(hashOf("a"), buyerWallet, providerWallet, 100_000_000, string(intent.PaymentReference), intent.CreatedAt.Add(time.Minute)),
	}

	if err := payments.DiscoverDue(context.Background()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(stub.discovered) != 0 {
		t.Fatalf("expected no adoption for an already-claimed purchase, got %v", stub.discovered)
	}
}

// Losing the race to another sweep or to a client is a correct outcome, not a
// worker error.
func TestSweepAcceptsLosingTheAdoptionRace(t *testing.T) {
	stub, payments, intent := sweepFixture(t)
	stub.discoverErr = ErrConflict
	stub.txs = []nimiq.ChainTransaction{
		chainTx(hashOf("a"), buyerWallet, providerWallet, 100_000_000, string(intent.PaymentReference), intent.CreatedAt.Add(time.Minute)),
	}

	if err := payments.DiscoverDue(context.Background()); err != nil {
		t.Fatalf("a lost race must not fail the sweep: %v", err)
	}
}

// Without an address-indexing node there is simply no discovery. That is a
// missing feature, never an unsafe one.
func TestSweepIsInertWithoutADiscoverer(t *testing.T) {
	payments := Payments{Network: domain.NimiqTestnet, Now: time.Now}
	if err := payments.DiscoverDue(context.Background()); err != nil {
		t.Fatalf("expected an inert sweep, got %v", err)
	}
}

func TestSweepRefusesACrossNetworkIntent(t *testing.T) {
	stub, payments, intent := sweepFixture(t)
	stub.due[0].Network = domain.NimiqMainnet
	stub.txs = []nimiq.ChainTransaction{
		chainTx(hashOf("a"), buyerWallet, providerWallet, 100_000_000, string(intent.PaymentReference), intent.CreatedAt.Add(time.Minute)),
	}

	if err := payments.DiscoverDue(context.Background()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(stub.discovered) != 0 {
		t.Fatalf("a mainnet intent must not be settled from the testnet chain, got %v", stub.discovered)
	}
}
