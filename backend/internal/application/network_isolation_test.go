package application

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// A transaction belongs permanently to the chain it was made on, so no amount
// of matching value, recipient, reference or timing can carry it across.
//
// Every other check in the verifier is about whether this is the right payment.
// This one is about whether it is even the right ledger, and it is the check
// that a Mainnet migration can most easily lose: the economic facts of a
// correct Testnet payment are indistinguishable from those of a correct
// Mainnet payment (docs/05 §92, §94, docs/09-SECURITY.md §101).

// networkOf stamps a transaction with a chain's network id. Mainnet is 24 and
// Testnet is 5, verified against both live chains on 2026-09-18.
func networkOf(tx nimiq.ChainTransaction, id uint8) nimiq.ChainTransaction {
	tx.NetworkID = &id
	return tx
}

func intentOn(t *testing.T, network domain.NimiqNetwork) domain.Purchase {
	t.Helper()
	intent := testIntent(t)
	intent.Snapshot.Network = network
	return intent
}

// Discovery searches an address for a payment nobody reported. It must never
// nominate one from the other chain, even though everything else about it is
// an exact match for the intent.
func TestDiscoveryNeverCrossesNetworks(t *testing.T) {
	for _, tc := range []struct {
		name    string
		network domain.NimiqNetwork
		wrongID uint8
		rightID uint8
	}{
		{"mainnet purchase, testnet transaction", domain.NimiqMainnet, 5, 24},
		{"testnet purchase, mainnet transaction", domain.NimiqTestnet, 24, 5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			intent := intentOn(t, tc.network)
			now := intent.CreatedAt.Add(2 * time.Minute)
			paid := chainTx(hashOf("a"), buyerWallet, providerWallet, 100_000_000, string(intent.PaymentReference), now.Add(-time.Minute))

			foreign := networkOf(paid, tc.wrongID)
			if got := matchDiscovered(intent, []nimiq.ChainTransaction{foreign}, now); got != "" {
				t.Fatalf("a transaction from the other chain was adopted: %q", got)
			}

			// The identical transaction on the right chain is adopted, so the
			// refusal above is the network and nothing else.
			native := networkOf(paid, tc.rightID)
			if got := matchDiscovered(intent, []nimiq.ChainTransaction{native}, now); got != hashOf("a") {
				t.Fatalf("the same payment on the correct chain must be adopted, got %q", got)
			}
		})
	}
}

// The same rule on the reported-hash path. A client may submit any hash it
// likes; a hash from the other chain is a MISMATCH, not a settlement.
func TestVerificationRefusesAForeignNetworkTransaction(t *testing.T) {
	for _, tc := range []struct {
		name    string
		network domain.NimiqNetwork
		wrongID uint8
		rightID uint8
	}{
		{"mainnet purchase, testnet transaction", domain.NimiqMainnet, 5, 24},
		{"testnet purchase, mainnet transaction", domain.NimiqTestnet, 24, 5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			intent := intentOn(t, tc.network)
			now := intent.CreatedAt.Add(2 * time.Minute)
			submitted := now.Add(-time.Minute)
			paid := chainTx(hashOf("a"), buyerWallet, providerWallet, 100_000_000, string(intent.PaymentReference), submitted)
			zero := uint8(0)
			executed := true
			paid.FromType, paid.ToType, paid.Flags, paid.Proof, paid.ExecutionResult = &zero, &zero, &zero, "aa", &executed
			block := uint32(100)
			paid.BlockNumber = &block

			record := PurchaseRecord{Purchase: intent, CandidateHash: hashOf("a"), SubmittedAt: &submitted}
			evidence := func(id uint8) nimiq.ChainEvidence {
				return nimiq.ChainEvidence{
					Transaction:    networkOf(paid, id),
					InclusionBlock: block,
					IncludedAt:     submitted,
					FinalityBlock:  120,
					Finalized:      true,
					FinalizedAt:    submitted.Add(time.Second),
				}
			}

			if _, category := validateEvidence(record, evidence(tc.wrongID), now); category != "NETWORK" {
				t.Fatalf("category = %q, want NETWORK for a transaction from the other chain", category)
			}
			if verified, category := validateEvidence(record, evidence(tc.rightID), now); category != "" {
				t.Fatalf("the same payment on the correct chain was refused as %q (%+v)", category, verified)
			} else if verified.Network != tc.network {
				t.Fatalf("the receipt must record the intent's own network, got %q", verified.Network)
			}
		})
	}
}

// A purchase created on one network cannot be reconciled by a deployment
// configured for the other — the service refuses before it reads the chain at
// all. This is the guard for a database that somehow holds rows from another
// network: nothing is verified against the wrong ledger, and nothing is
// relabelled to make it fit.
func TestReconcileRefusesAPurchaseFromAnotherNetwork(t *testing.T) {
	intent := intentOn(t, domain.NimiqTestnet)
	submitted := intent.CreatedAt.Add(time.Minute)
	store := &networkStubStore{record: PurchaseRecord{Purchase: intent, CandidateHash: hashOf("a"), SubmittedAt: &submitted}}
	chain := &refusingChain{t: t}

	payments := Payments{
		Store:   store,
		Chain:   chain,
		Network: domain.NimiqMainnet, // a Mainnet deployment
		Now:     func() time.Time { return intent.CreatedAt.Add(2 * time.Minute) },
	}
	_, err := payments.Reconcile(context.Background(), Identity{ID: "customer"}, intent.ID)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("err = %v, want ErrConflict", err)
	}
	if chain.called {
		t.Fatal("a cross-network purchase must be refused before the chain is read")
	}
	if store.marked {
		t.Fatal("a cross-network purchase must not be recorded as a failed payment; it is a deployment error")
	}
}

// refusingChain fails the test if it is consulted at all.
type refusingChain struct {
	t      *testing.T
	called bool
}

func (c *refusingChain) Inspect(context.Context, string, string) (nimiq.ChainEvidence, error) {
	c.called = true
	return nimiq.ChainEvidence{}, errors.New("the chain must not be read for a cross-network purchase")
}

// networkStubStore serves one record and records whether anything was written.
type networkStubStore struct {
	record PurchaseRecord
	marked bool
}

func (s *networkStubStore) Get(context.Context, domain.ID, domain.ID) (PurchaseRecord, error) {
	return s.record, nil
}

func (s *networkStubStore) Mark(context.Context, domain.ID, domain.ID, string, string, string, *domain.VerifiedPayment, time.Time) error {
	s.marked = true
	return nil
}

func (s *networkStubStore) BeginWalletAttempt(context.Context, domain.ID, domain.ID, domain.ID, time.Time) (PurchaseRecord, error) {
	return PurchaseRecord{}, errors.New("unused")
}
func (s *networkStubStore) ReleaseWalletAttempt(context.Context, domain.ID, domain.ID, domain.ID) error {
	return errors.New("unused")
}
func (s *networkStubStore) Create(context.Context, domain.ID, domain.WalletAddress, domain.ID, domain.NimiqNetwork, string, time.Time) (PurchaseRecord, bool, error) {
	return PurchaseRecord{}, false, errors.New("unused")
}
func (s *networkStubStore) List(context.Context, domain.ID) ([]PurchaseRecord, error) {
	return nil, errors.New("unused")
}
func (s *networkStubStore) Submit(context.Context, domain.ID, domain.ID, string, time.Time) (PurchaseRecord, error) {
	return PurchaseRecord{}, errors.New("unused")
}
func (s *networkStubStore) Confirm(context.Context, domain.ID, domain.ID, domain.VerifiedPayment, domain.ConfirmationPolicy, time.Time) (PurchaseRecord, error) {
	return PurchaseRecord{}, errors.New("unused")
}
func (s *networkStubStore) Cancel(context.Context, domain.ID, domain.ID, time.Time) (PurchaseRecord, error) {
	return PurchaseRecord{}, errors.New("unused")
}
func (s *networkStubStore) GetPass(context.Context, domain.ID, domain.ID) (domain.PurchasedPass, error) {
	return domain.PurchasedPass{}, errors.New("unused")
}
func (s *networkStubStore) ListPasses(context.Context, domain.ID, PurchasedPassFilter) (PurchasedPassPage, error) {
	return PurchasedPassPage{}, errors.New("unused")
}
func (s *networkStubStore) Due(context.Context, time.Time, int) ([]DuePurchase, error) {
	return nil, nil
}
func (s *networkStubStore) DueDiscoveryAddresses(context.Context, time.Time, int) ([]DiscoveryAddress, error) {
	return nil, nil
}
func (s *networkStubStore) NoteDiscoveryScan(context.Context, domain.WalletAddress, domain.NimiqNetwork, string, time.Time) error {
	return nil
}
func (s *networkStubStore) NoteDiscoveryFailure(context.Context, domain.WalletAddress, domain.NimiqNetwork, time.Time) error {
	return nil
}
func (s *networkStubStore) HasLiveIntents(context.Context, time.Time) (bool, error) {
	return false, nil
}
func (s *networkStubStore) Discover(context.Context, domain.ID, domain.ID, string, time.Time) (PurchaseRecord, error) {
	return PurchaseRecord{}, errors.New("unused")
}
func (s *networkStubStore) DueSettlements(context.Context, time.Time, int) ([]DueSettlement, error) {
	return nil, nil
}
func (s *networkStubStore) NoteSettlementCheck(context.Context, string, time.Time) error { return nil }
func (s *networkStubStore) NoteSettlementFailure(context.Context, string, time.Time) error {
	return nil
}
func (s *networkStubStore) FinalizeSettlement(context.Context, DueSettlement, domain.VerifiedPayment, time.Time) error {
	return nil
}
func (s *networkStubStore) ReanchorSettlement(context.Context, DueSettlement, domain.VerifiedPayment, time.Time) error {
	return nil
}
func (s *networkStubStore) ReverseSettlement(context.Context, DueSettlement, string, time.Time) error {
	return nil
}

// The payment reference is the same shape on both networks, which is exactly
// why it cannot be the thing that separates them: a valid NP1 reference for a
// Mainnet intent would be equally valid bytes in a Testnet transaction. The
// network check has to be independent of it, so it is asserted here that a
// perfectly matching reference does not rescue a foreign-chain transaction.
func TestAMatchingReferenceDoesNotBridgeNetworks(t *testing.T) {
	intent := intentOn(t, domain.NimiqMainnet)
	now := intent.CreatedAt.Add(2 * time.Minute)
	if !strings.HasPrefix(string(intent.PaymentReference), "NP1:") {
		t.Fatalf("reference format changed: %q", intent.PaymentReference)
	}
	paid := networkOf(chainTx(hashOf("a"), buyerWallet, providerWallet, 100_000_000, string(intent.PaymentReference), now.Add(-time.Minute)), 5)
	if got := matchDiscovered(intent, []nimiq.ChainTransaction{paid}, now); got != "" {
		t.Fatalf("this intent's own reference carried a Testnet transaction into a Mainnet purchase: %q", got)
	}
}
