package application

import (
	"context"
	"encoding/hex"
	"os"
	"testing"
	"time"

	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// A dry-run of the discovery matcher against a real chain.
//
// Every other test in this package feeds `matchDiscovered` transactions this
// repository wrote. That proves the rules and proves nothing about the wire:
// Nimiq renders addresses with spaces, values as integers, timestamps in
// milliseconds, `recipientData` as hex, and a fixture that got any of those
// subtly wrong would pass its own tests and strand a real payment.
//
// So this one reads real transactions off a real node, builds the purchase
// intent that *would* have produced the newest one, and asserts the real
// matcher adopts it. No wallet, no key, no payment — it only reads.
//
//	NIMIQ_LIVE_RPC=http://127.0.0.1:8648 \
//	NIMIQ_LIVE_NETWORK=TESTNET \
//	NIMIQ_LIVE_ADDRESS='NQ.. .... ....' \
//	go test ./internal/application -run TestLiveDiscoveryMatcher -v
func TestLiveDiscoveryMatcherAdoptsARealTransaction(t *testing.T) {
	endpoint := os.Getenv("NIMIQ_LIVE_RPC")
	address := os.Getenv("NIMIQ_LIVE_ADDRESS")
	if endpoint == "" || address == "" {
		t.Skip("set NIMIQ_LIVE_RPC and NIMIQ_LIVE_ADDRESS to dry-run against a real chain")
	}
	network := os.Getenv("NIMIQ_LIVE_NETWORK")
	if network == "" {
		network = "MAINNET"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()

	client := nimiq.NewRPCClient(endpoint)
	txs, err := client.TransactionsByAddress(ctx, address, network)
	if err != nil {
		t.Fatalf("TransactionsByAddress: %v", err)
	}
	if len(txs) == 0 {
		t.Skipf("%s has no transactions on %s; nothing to dry-run against", address, network)
	}
	t.Logf("read %d real transactions for %s on %s", len(txs), address, network)

	// The newest one, as the sweep would see it.
	tx := txs[0]
	if tx.Value == nil || tx.Timestamp == nil {
		t.Fatalf("under-described transaction from the wire: %+v", tx)
	}
	recipient, err := nimiq.ValidateAddress(tx.To)
	if err != nil {
		t.Fatalf("the chain's recipient does not normalize: %q: %v", tx.To, err)
	}
	sender, err := nimiq.ValidateAddress(tx.From)
	if err != nil {
		t.Fatalf("the chain's sender does not normalize: %q: %v", tx.From, err)
	}
	data, err := nimiq.DecodeRecipientData(tx.RecipientData)
	if err != nil {
		t.Fatalf("the chain's recipientData does not decode: %q: %v", tx.RecipientData, err)
	}
	paidAt := time.UnixMilli(int64(*tx.Timestamp)).UTC()
	t.Logf("newest: hash=%s from=%s to=%s value=%d data=%dB at=%s",
		tx.Hash, sender, recipient, *tx.Value, len(data), paidAt)

	// The intent this transaction would have settled: same recipient, same
	// amount to the Luna, same network, and a lifetime containing it.
	intent := domain.Purchase{
		ID:                "11111111-1111-4111-8111-111111111111",
		CustomerContextID: "22222222-2222-4222-8222-222222222222",
		ExpectedWallet:    domain.WalletAddress(sender),
		PaymentReference:  "NP1:0123456789abcdef0123456789abcdef",
		Snapshot: domain.PurchaseSnapshot{
			Recipient: domain.WalletAddress(recipient),
			PriceLuna: domain.Luna(*tx.Value),
			Network:   domain.NimiqNetwork(network),
		},
		CreatedAt: paidAt.Add(-time.Minute),
		ExpiresAt: paidAt.Add(domain.PurchaseIntentTTL),
	}
	// A transaction carrying somebody else's data is not ours, and the
	// fixture reference above is nobody's — so the empty-data fallback is
	// what a real quiet transaction exercises here.
	if len(data) != 0 {
		intent.PaymentReference = domain.PaymentReference(data)
		t.Logf("this transaction carries data; matching on it as the reference")
	}
	now := paidAt.Add(time.Minute)

	got := matchDiscovered(intent, txs, now)
	if got != tx.Hash {
		t.Fatalf("the matcher did not adopt the real transaction it was shaped for: got %q, want %q", got, tx.Hash)
	}
	t.Logf("matcher adopted the real transaction %s from live chain data", got)

	// And the same real data must be refused when the amount is off by one
	// Luna — proof the match is exact rather than approximate.
	underpaid := intent
	underpaid.Snapshot.PriceLuna = domain.Luna(*tx.Value) - 1
	if got := matchDiscovered(underpaid, txs, now); got != "" {
		t.Fatalf("a one-Luna mismatch adopted %q from real data", got)
	}

	// And when the recipient is anyone else.
	elsewhere := intent
	elsewhere.Snapshot.Recipient = domain.WalletAddress("NQ07 0000 0000 0000 0000 0000 0000 0000 0000")
	if got := matchDiscovered(elsewhere, txs, now); got != "" {
		t.Fatalf("a foreign recipient adopted %q from real data", got)
	}
}

// The same dry-run for the *verification* half, against one named transaction.
//
// `TestLiveDiscoveryMatcherAdoptsARealTransaction` above proves a real
// transaction can be adopted; this proves a real transaction can be verified —
// the step that actually issues a Pass, and the step that refused two paid
// Testnet purchases on 2026-09-17 because the payment left an HTLC rather than
// a basic account (ADR-014).
//
// The intent is reconstructed from the transaction itself, exactly as the
// matcher test does: whatever the chain says was paid is what the purchase is
// declared to have asked for. That is the point — every field then has to
// survive the real `Inspect` envelope and the real `validateEvidence` rules.
//
//	NIMIQ_LIVE_RPC=http://127.0.0.1:8648 \
//	NIMIQ_LIVE_NETWORK=TESTNET \
//	NIMIQ_LIVE_TX=<64 hex> \
//	go test ./internal/application -run TestLiveEvidence -v
func TestLiveEvidenceVerifiesARealTransaction(t *testing.T) {
	endpoint := os.Getenv("NIMIQ_LIVE_RPC")
	hash := os.Getenv("NIMIQ_LIVE_TX")
	if endpoint == "" || hash == "" {
		t.Skip("set NIMIQ_LIVE_RPC and NIMIQ_LIVE_TX to verify a real transaction")
	}
	network := os.Getenv("NIMIQ_LIVE_NETWORK")
	if network == "" {
		network = "MAINNET"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()

	client := nimiq.NewRPCClient(endpoint)
	evidence, err := client.Inspect(ctx, hash, network)
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	tx := evidence.Transaction
	recipient, err := nimiq.ValidateAddress(tx.To)
	if err != nil {
		t.Fatalf("recipient: %v", err)
	}
	sender, err := nimiq.ValidateAddress(tx.From)
	if err != nil {
		t.Fatalf("sender: %v", err)
	}
	data, err := hex.DecodeString(tx.RecipientData)
	if err != nil {
		t.Fatalf("recipientData: %v", err)
	}
	if !evidence.Finalized {
		t.Skip("transaction is not finalized yet")
	}

	paidAt := evidence.IncludedAt
	submitted := paidAt.Add(-time.Second)
	intent := PurchaseRecord{
		CandidateHash: tx.Hash,
		SubmittedAt:   &submitted,
		Purchase: domain.Purchase{
			ID:               domain.ID("11111111-1111-4111-8111-111111111111"),
			Status:           domain.PurchasePaymentPending,
			ExpectedWallet:   domain.WalletAddress(sender),
			PaymentReference: domain.PaymentReference(data),
			Snapshot: domain.PurchaseSnapshot{
				Recipient: domain.WalletAddress(recipient),
				PriceLuna: domain.Luna(*tx.Value),
				Network:   domain.NimiqNetwork(network),
			},
			CreatedAt: paidAt.Add(-time.Minute),
			ExpiresAt: paidAt.Add(domain.PurchaseIntentTTL),
		},
	}
	now := paidAt.Add(2 * time.Minute)

	verified, category := validateEvidence(intent, evidence, now)
	if category != "" {
		t.Fatalf("a real finalized payment was refused as %q (fromType %v, toType %v, flags %v)",
			category, deref(tx.FromType), deref(tx.ToType), deref(tx.Flags))
	}
	t.Logf("verified real transaction %s: %d Luna from %s (fromType %d) to %s, reference on chain: %v",
		tx.Hash, verified.AmountLuna, verified.Sender, deref(tx.FromType), verified.Recipient, verified.ReferenceOnChain)

	// The same real evidence must still be refused when the intent asked for
	// a different amount — proof this verified rather than waved through.
	underpaid := intent
	underpaid.Purchase.Snapshot.PriceLuna = domain.Luna(*tx.Value) - 1
	if _, category := validateEvidence(underpaid, evidence, now); category != "AMOUNT" {
		t.Fatalf("a one-Luna mismatch was not refused on real data, got %q", category)
	}
}

func deref(v *uint8) int {
	if v == nil {
		return -1
	}
	return int(*v)
}
