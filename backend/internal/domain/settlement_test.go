package domain

import (
	"strings"
	"testing"
	"time"
)

func settlementEvidence(includedAt time.Time) VerifiedPayment {
	return VerifiedPayment{
		Hash: strings.Repeat("a", 64), Sender: "NQ07 0000 0000 0000 0000 0000 0000 0000 0000",
		Recipient: "NQ07 1111 1111 1111 1111 1111 1111 1111 1111", AmountLuna: 12_340_000,
		Reference: PaymentReference("NP1:" + strings.Repeat("b", 32)), Network: NimiqTestnet,
		Included: true, IncludedAt: includedAt, InclusionBlock: 100, FinalityBlock: 120,
	}
}

func finalized(v VerifiedPayment) VerifiedPayment {
	v.Finalized = true
	v.FinalizedAt = v.IncludedAt.Add(time.Second)
	return v
}

func TestConfirmationPolicyAcceptsOnlyTheTwoDocumentedValues(t *testing.T) {
	for _, value := range []string{"inclusion", "finality"} {
		policy, err := ParseConfirmationPolicy(value)
		if err != nil || string(policy) != value {
			t.Fatalf("%q: %q %v", value, policy, err)
		}
	}
	// No third value and no fallback between the two. A deployment that fails
	// to say which risk it is taking must not have one chosen for it.
	for _, value := range []string{"", "INCLUSION", "Finality", "mempool", "micro", "included", "final", "1"} {
		if _, err := ParseConfirmationPolicy(value); err == nil {
			t.Fatalf("accepted confirmation policy %q", value)
		}
	}
}

// The distinction the mission asks for, made explicit: economic validity,
// inclusion, finality and "meets the configured policy" are four separate
// questions, and the domain answers each of them separately.
func TestSettlementSeparatesInclusionFromFinality(t *testing.T) {
	at := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	included := settlementEvidence(at)

	if !included.IsIncluded() || included.IsFinalized() {
		t.Fatalf("included evidence misread: included=%v finalized=%v", included.IsIncluded(), included.IsFinalized())
	}
	if included.Settlement() != SettlementIncluded {
		t.Fatalf("settlement state: %s", included.Settlement())
	}
	if !included.Satisfies(ConfirmOnInclusion) {
		t.Fatal("inclusion policy refused a canonical inclusion")
	}
	if included.Satisfies(ConfirmOnFinality) {
		t.Fatal("finality policy accepted an unfinalised payment")
	}
	// An unrecognised policy satisfies nothing, so the failure direction of a
	// bad value is "nothing settles".
	if included.Satisfies(ConfirmationPolicy("anything")) {
		t.Fatal("unknown policy accepted a payment")
	}

	final := finalized(included)
	if !final.IsFinalized() || final.Settlement() != SettlementFinalized {
		t.Fatalf("finalised evidence misread: %+v", final)
	}
	if !final.Satisfies(ConfirmOnInclusion) || !final.Satisfies(ConfirmOnFinality) {
		t.Fatal("a finalised payment must satisfy both policies")
	}
}

// Deleting the old `!payment.Finalized` invariant must not have opened the door
// to arbitrary unfinalised transactions. Each case below is a shape that looks
// like a settlement and is not one.
func TestSettlementRefusesEvidenceThatOnlyLooksSettled(t *testing.T) {
	at := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	for name, break_ := range map[string]func(*VerifiedPayment){
		"the verifier never concluded inclusion": func(v *VerifiedPayment) { v.Included = false },
		"no block number":                        func(v *VerifiedPayment) { v.InclusionBlock = 0 },
		"no block timestamp":                     func(v *VerifiedPayment) { v.IncludedAt = time.Time{} },
		"no macro height to wait for":            func(v *VerifiedPayment) { v.FinalityBlock = 0 },
		"macro height below the inclusion":       func(v *VerifiedPayment) { v.FinalityBlock = 99 },
	} {
		t.Run(name, func(t *testing.T) {
			evidence := settlementEvidence(at)
			break_(&evidence)
			if evidence.Satisfies(ConfirmOnInclusion) {
				t.Fatalf("inclusion policy accepted evidence with %s", name)
			}
			if evidence.Satisfies(ConfirmOnFinality) {
				t.Fatalf("finality policy accepted evidence with %s", name)
			}
		})
	}
	// And the finality-specific ones: a flag is not a macro block.
	for name, break_ := range map[string]func(*VerifiedPayment){
		"finality claimed with no timestamp":       func(v *VerifiedPayment) { v.FinalizedAt = time.Time{} },
		"finality claimed before the inclusion":    func(v *VerifiedPayment) { v.FinalizedAt = v.IncludedAt.Add(-time.Second) },
		"finality claimed at the inclusion height": func(v *VerifiedPayment) { v.FinalityBlock = v.InclusionBlock },
	} {
		t.Run(name, func(t *testing.T) {
			evidence := finalized(settlementEvidence(at))
			break_(&evidence)
			if evidence.IsFinalized() || evidence.Satisfies(ConfirmOnFinality) {
				t.Fatalf("finality accepted with %s", name)
			}
		})
	}
}

// Promotion is only ever granted to the inclusion that was accepted. This is
// the anti-reorg rule, and it is what makes settling on a micro block safe to
// do at all.
func TestPromotionRequiresTheSameTransactionInTheSameBlock(t *testing.T) {
	at := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	stored := settlementEvidence(at)

	if _, err := PromoteSettlement(stored, stored); err == nil {
		t.Fatal("promoted a receipt on evidence that establishes no finality")
	}
	promoted, err := PromoteSettlement(stored, finalized(stored))
	if err != nil || !promoted.IsFinalized() || promoted.InclusionBlock != stored.InclusionBlock {
		t.Fatalf("legitimate promotion refused: %+v %v", promoted, err)
	}
	// An already-finalised receipt is not provisional, which is what makes a
	// second promotion a no-op rather than a second write.
	if _, err := PromoteSettlement(finalized(stored), finalized(stored)); err == nil {
		t.Fatal("promoted an already-finalised receipt")
	}

	for name, break_ := range map[string]func(*VerifiedPayment){
		"a different transaction":     func(v *VerifiedPayment) { v.Hash = strings.Repeat("c", 64) },
		"a different recipient":       func(v *VerifiedPayment) { v.Recipient = "NQ07 2222 2222 2222 2222 2222 2222 2222 2222" },
		"a different amount":          func(v *VerifiedPayment) { v.AmountLuna = 1 },
		"a different reference":       func(v *VerifiedPayment) { v.Reference = PaymentReference("NP1:" + strings.Repeat("d", 32)) },
		"a different network":         func(v *VerifiedPayment) { v.Network = NimiqMainnet },
		"a different inclusion block": func(v *VerifiedPayment) { v.InclusionBlock = 104 },
		"a different inclusion time":  func(v *VerifiedPayment) { v.IncludedAt = v.IncludedAt.Add(time.Second) },
	} {
		t.Run(name, func(t *testing.T) {
			evidence := finalized(stored)
			break_(&evidence)
			if _, err := PromoteSettlement(stored, evidence); err == nil {
				t.Fatalf("promoted on evidence describing %s", name)
			}
		})
	}
}

// Case B: the same payment, canonically included somewhere else.
func TestReanchoringRequiresTheSamePaymentInANewBlock(t *testing.T) {
	at := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	stored := settlementEvidence(at)

	moved := stored
	moved.InclusionBlock = 104
	moved.IncludedAt = at.Add(4 * time.Second)
	moved.FinalityBlock = 140
	fresh, err := ReanchorSettlement(stored, moved)
	if err != nil || fresh.InclusionBlock != 104 || fresh.FinalityBlock != 140 {
		t.Fatalf("legitimate re-anchoring refused: %+v %v", fresh, err)
	}
	// Economic identity is not negotiable: this must not become a way to
	// attach different evidence to a purchase that already settled.
	wrong := moved
	wrong.AmountLuna = 1
	if _, err := ReanchorSettlement(stored, wrong); err == nil {
		t.Fatal("re-anchored onto a different payment")
	}
	// Nothing moved, so there is nothing to correct — the caller should have
	// taken the promotion path.
	if _, err := ReanchorSettlement(stored, stored); err == nil {
		t.Fatal("re-anchored an unchanged inclusion")
	}
	// A transaction back in the mempool is not a new inclusion.
	dropped := moved
	dropped.Included = false
	dropped.InclusionBlock = 0
	if _, err := ReanchorSettlement(stored, dropped); err == nil {
		t.Fatal("re-anchored onto no inclusion at all")
	}
	// And a finalised receipt is beyond all of this.
	if _, err := ReanchorSettlement(finalized(stored), moved); err == nil {
		t.Fatal("re-anchored a finalised receipt")
	}
}

// Case C, and the guard that matters most: a finalised payment cannot be
// contested, because acting on such a reading would withdraw a Pass that was
// genuinely paid for.
func TestOnlyProvisionalReceiptsCanBeContested(t *testing.T) {
	at := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	stored := settlementEvidence(at)

	if err := ValidateContest(stored, at.Add(time.Minute)); err != nil {
		t.Fatalf("provisional receipt could not be contested: %v", err)
	}
	if err := ValidateContest(finalized(stored), at.Add(time.Minute)); err == nil {
		t.Fatal("contested a finalised payment")
	}
	if err := ValidateContest(stored, time.Time{}); err == nil {
		t.Fatal("contested at no time at all")
	}
	if err := ValidateContest(stored, at.Add(-time.Second)); err == nil {
		t.Fatal("contested before the payment was included")
	}
}

// A confirmed purchase is normally terminal. The single thing that can still
// move it is the discovery that its payment never became canonical — and that
// is reachable only through ReverseSettlement, never through the transition
// table, where any other caller would be one typo from withdrawing a paid Pass.
func TestSettlementReversalIsTheOnlyWayOutOfAConfirmedPurchase(t *testing.T) {
	now := time.Now().UTC()
	_, purchase := purchaseFixture(t, now, nil)
	confirmFixture(t, &purchase, now)
	if purchase.Status != PurchaseConfirmed {
		t.Fatalf("fixture status %s", purchase.Status)
	}

	later := now.Add(4 * time.Minute)
	if err := purchase.Fail(later); err == nil {
		t.Fatal("a confirmed purchase was failed through the transition table")
	}
	if err := purchase.Expire(later); err == nil {
		t.Fatal("a confirmed purchase was expired through the transition table")
	}
	if err := purchase.Cancel(later); err == nil {
		t.Fatal("a confirmed purchase was cancelled through the transition table")
	}

	if err := purchase.ReverseSettlement(later); err != nil {
		t.Fatalf("reversal refused: %v", err)
	}
	if purchase.Status != PurchaseCompensationRequired {
		t.Fatalf("reversal produced %s", purchase.Status)
	}
	// The receipt is not erased by the reversal: it is the evidence of why a
	// Pass was withdrawn.
	if purchase.TransactionHash == "" || purchase.ConfirmedAt == nil {
		t.Fatal("reversal discarded the original receipt")
	}
	// Not repeatable, and not a path into compensation from anywhere else.
	if err := purchase.ReverseSettlement(later); err == nil {
		t.Fatal("reversed a settlement twice")
	}
	_, unconfirmed := purchaseFixture(t, now, nil)
	if err := unconfirmed.ReverseSettlement(later); err == nil {
		t.Fatal("reversed the settlement of a purchase that never settled")
	}
}

// The inclusion policy must not have widened the timing window a payment can
// settle from. Faster confirmation, same rules about when a payment counts.
func TestInclusionPolicyKeepsTheIntentTimingWindow(t *testing.T) {
	now := time.Now().UTC()
	_, purchase := purchaseFixture(t, now, nil)
	if err := purchase.AwaitPayment(now); err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("a", 64)
	if err := purchase.RecordSubmission(hash, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := purchase.BeginVerification(now.Add(2 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	evidence := VerifiedPayment{
		Hash: hash, Sender: purchase.ExpectedWallet, Recipient: purchase.Snapshot.Recipient,
		AmountLuna: purchase.Snapshot.PriceLuna, Reference: purchase.PaymentReference,
		Network: purchase.Snapshot.Network, Included: true, IncludedAt: now.Add(2 * time.Minute),
		InclusionBlock: 100, FinalityBlock: 120,
	}

	tooEarly := evidence
	tooEarly.IncludedAt = purchase.CreatedAt.Add(-time.Second)
	if err := purchase.ConfirmVerified(tooEarly, ConfirmOnInclusion, now.Add(3*time.Minute)); err == nil {
		t.Fatal("a transaction included before the intent existed settled it")
	}
	tooLate := evidence
	tooLate.IncludedAt = purchase.ExpiresAt.Add(PurchaseSettlementGrace + time.Second)
	if err := purchase.ConfirmVerified(tooLate, ConfirmOnInclusion, tooLate.IncludedAt.Add(time.Minute)); err == nil {
		t.Fatal("a transaction included past the settlement grace settled it")
	}
	future := evidence
	future.IncludedAt = now.Add(10 * time.Minute)
	if err := purchase.ConfirmVerified(future, ConfirmOnInclusion, now.Add(3*time.Minute)); err == nil {
		t.Fatal("a transaction included in the future settled a purchase")
	}
	wrongHash := evidence
	wrongHash.Hash = strings.Repeat("f", 64)
	if err := purchase.ConfirmVerified(wrongHash, ConfirmOnInclusion, now.Add(3*time.Minute)); err == nil {
		t.Fatal("a transaction other than the reported candidate settled the purchase")
	}
	if purchase.Status != PurchaseVerifying {
		t.Fatalf("a rejected settlement mutated the purchase: %s", purchase.Status)
	}
	if err := purchase.ConfirmVerified(evidence, ConfirmOnInclusion, now.Add(3*time.Minute)); err != nil {
		t.Fatalf("valid inclusion refused: %v", err)
	}
	if purchase.Status != PurchaseConfirmed {
		t.Fatalf("valid inclusion produced %s", purchase.Status)
	}
	// And the resulting Pass is a real one, issued from a provisional receipt.
	pass, err := NewPurchasedPass(mustID(t), purchase, mustID(t))
	if err != nil || pass.Status != PurchasedPassActive || pass.RemainingSessions != int32(purchase.Snapshot.Sessions) {
		t.Fatalf("provisional settlement did not produce a usable Pass: %+v %v", pass, err)
	}
}
