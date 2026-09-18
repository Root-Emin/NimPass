package application

import (
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// Nimiq Pay does not always pay from a basic account.
//
// Measured on a real device on 2026-09-17: the app's spendable balance sat in
// an HTLC and it paid by early-resolving it, so the transaction reported
// `fromType: 2` and a `from` that was the contract, not the user's address.
// Two Testnet purchases were correct in every other respect — provider
// address, exact Luna, this intent's own NP1 bytes, `executionResult` true —
// and both were failed permanently after the money had already moved.
//
// What the account type must not do is decide whether a payment counts. What
// must still decide it is everything these tests keep asserting.

// evidenceFor builds the chain evidence for one settled payment, with the
// sender account type and the sender address left to the caller.
func evidenceFor(t *testing.T, p domain.Purchase, hash string, from string, fromType uint8) (PurchaseRecord, nimiq.ChainEvidence) {
	t.Helper()
	included := p.CreatedAt.Add(2 * time.Minute)
	submitted := p.CreatedAt.Add(time.Minute)
	value := uint64(p.Snapshot.PriceLuna)
	network := uint8(5) // TestAlbatross
	zero := uint8(0)
	yes := true
	block := uint32(11683274)
	ms := uint64(included.UnixMilli())

	record := PurchaseRecord{Purchase: p, CandidateHash: hash, SubmittedAt: &submitted}
	tx := nimiq.ChainTransaction{
		Hash:            hash,
		BlockNumber:     &block,
		Timestamp:       &ms,
		From:            from,
		FromType:        &fromType,
		To:              string(p.Snapshot.Recipient),
		ToType:          &zero,
		Value:           &value,
		RecipientData:   hex.EncodeToString([]byte(p.PaymentReference)),
		Flags:           &zero,
		Proof:           "0100c1534c708122968212c6709526801d18218ce9303590f2bca473213d99b24aaf",
		NetworkID:       &network,
		ExecutionResult: &yes,
	}
	return record, nimiq.ChainEvidence{
		Transaction:    tx,
		IncludedAt:     included,
		InclusionBlock: block,
		FinalityBlock:  block + 60,
		FinalizedAt:    included.Add(time.Minute),
		Finalized:      true,
	}
}

// The HTLC contract address observed in the real failure, in the spaced form
// the node reports. It is not the buyer's wallet, which is the whole point.
const contractSender = "NQ68 1BPD 06JJ D99Y YXM1 6Q5A Y4VP PU22 X906"

func TestPaymentFromContractAccountSettles(t *testing.T) {
	intent := testIntent(t)
	record, evidence := evidenceFor(t, intent, hashOf("d"), contractSender, 2)
	now := evidence.FinalizedAt.Add(time.Minute)

	verified, category := validateEvidence(record, evidence, now)
	if category != "" {
		t.Fatalf("a finalized HTLC payment carrying this intent's reference was refused as %q", category)
	}
	if !verified.ReferenceOnChain {
		t.Fatal("the reference was on chain and should have been recorded as such")
	}
	// The paying address is an audit fact, never the Pass owner (ADR-013).
	if verified.Sender == intent.ExpectedWallet {
		t.Fatal("the contract sender must be recorded as itself, not rewritten to the buyer")
	}
	if verified.AmountLuna != intent.Snapshot.PriceLuna || verified.Recipient != intent.Snapshot.Recipient {
		t.Fatal("amount and recipient must survive verification unchanged")
	}
}

// Everything the account type was standing in for is still enforced.
func TestContractSenderDoesNotRelaxTheRestOfExecution(t *testing.T) {
	intent := testIntent(t)
	now := intent.CreatedAt.Add(10 * time.Minute)

	t.Run("recipient must be a plain account", func(t *testing.T) {
		record, evidence := evidenceFor(t, intent, hashOf("d"), contractSender, 2)
		contractRecipient := uint8(2)
		evidence.Transaction.ToType = &contractRecipient
		if _, category := validateEvidence(record, evidence, now); category != "EXECUTION" {
			t.Fatalf("a contract recipient must stay refused, got %q", category)
		}
	})

	t.Run("flags must be zero", func(t *testing.T) {
		record, evidence := evidenceFor(t, intent, hashOf("d"), contractSender, 2)
		signalling := uint8(1)
		evidence.Transaction.Flags = &signalling
		if _, category := validateEvidence(record, evidence, now); category != "EXECUTION" {
			t.Fatalf("a flagged transaction must stay refused, got %q", category)
		}
	})

	t.Run("a failed execution is still a failure", func(t *testing.T) {
		record, evidence := evidenceFor(t, intent, hashOf("d"), contractSender, 2)
		no := false
		evidence.Transaction.ExecutionResult = &no
		if _, category := validateEvidence(record, evidence, now); category != "EXECUTION" {
			t.Fatalf("a reverted transaction must stay refused, got %q", category)
		}
	})

	t.Run("an undescribed sender type is still refused", func(t *testing.T) {
		record, evidence := evidenceFor(t, intent, hashOf("d"), contractSender, 2)
		evidence.Transaction.FromType = nil
		if _, category := validateEvidence(record, evidence, now); category != "EXECUTION" {
			t.Fatalf("an under-described transaction must stay refused, got %q", category)
		}
	})

	t.Run("another purchase's reference is still refused", func(t *testing.T) {
		record, evidence := evidenceFor(t, intent, hashOf("d"), contractSender, 2)
		evidence.Transaction.RecipientData = hex.EncodeToString([]byte("NP1:" + strings.Repeat("b", 32)))
		if _, category := validateEvidence(record, evidence, now); category != "DATA" {
			t.Fatalf("a foreign reference must stay refused, got %q", category)
		}
	})

	t.Run("the exact amount is still required", func(t *testing.T) {
		record, evidence := evidenceFor(t, intent, hashOf("d"), contractSender, 2)
		short := uint64(intent.Snapshot.PriceLuna) - 1
		evidence.Transaction.Value = &short
		if _, category := validateEvidence(record, evidence, now); category != "AMOUNT" {
			t.Fatalf("an underpayment must stay refused, got %q", category)
		}
	})

	// Without the reference there is nothing purchase-specific on chain, so
	// the sender rule stands exactly as ADR-013 left it — and a contract
	// sender is then a stranger like any other.
	t.Run("a contract sender without the reference is still refused", func(t *testing.T) {
		record, evidence := evidenceFor(t, intent, hashOf("d"), contractSender, 2)
		evidence.Transaction.RecipientData = ""
		if _, category := validateEvidence(record, evidence, now); category != "SENDER" {
			t.Fatalf("an unreferenced payment from a foreign sender must stay refused, got %q", category)
		}
	})
}
