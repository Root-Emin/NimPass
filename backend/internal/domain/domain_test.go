package domain

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func mustID(t *testing.T) ID {
	t.Helper()
	id, err := NewID()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func mustWallet(t *testing.T, suffix string) WalletAddress {
	t.Helper()
	wallet, err := NewWalletAddress("NQ" + strings.Repeat(suffix, 34))
	if err != nil {
		t.Fatal(err)
	}
	return wallet
}

func purchaseFixture(t *testing.T, now time.Time, expiration *time.Time) (Pass, Purchase) {
	t.Helper()
	owner := mustWallet(t, "A")
	provider, err := NewProvider(mustID(t), mustID(t), "Alex Fitness", now)
	if err != nil {
		t.Fatal(err)
	}
	provider.PayoutWallet = mustWallet(t, "B")
	provider.PayoutVerifiedAt = &now
	service, err := NewService(mustID(t), provider.ID, "Personal Training", "Training", now)
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := NewPass(mustID(t), provider.ID, service.ID, "10 Sessions", "Prepaid", 10, 25_000_000, NewExpirationPolicy(expiration), "", now)
	if err != nil {
		t.Fatal(err)
	}
	if err := pkg.Publish(now); err != nil {
		t.Fatal(err)
	}
	reference, err := NewPaymentReference()
	if err != nil {
		t.Fatal(err)
	}
	purchase, err := NewPurchase(mustID(t), mustID(t), owner, pkg, service, provider, NimiqTestnet, reference, now)
	if err != nil {
		t.Fatal(err)
	}
	return pkg, purchase
}

func confirmFixture(t *testing.T, purchase *Purchase, now time.Time) {
	t.Helper()
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
	if err := purchase.ConfirmVerified(VerifiedPayment{
		Hash: hash, Sender: purchase.ExpectedWallet, Recipient: purchase.Snapshot.Recipient,
		AmountLuna: purchase.Snapshot.PriceLuna, Reference: purchase.PaymentReference,
		Network: purchase.Snapshot.Network, Included: true, IncludedAt: now.Add(2 * time.Minute), Finalized: true, InclusionBlock: 1, FinalityBlock: 2, FinalizedAt: now.Add(2*time.Minute + time.Second),
	}, ConfirmOnFinality, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
}

func TestCriticalValueObjectsRejectInvalidValues(t *testing.T) {
	for _, value := range []int64{0, -1, int64(MaxSafeLuna) + 1} {
		if _, err := NewLuna(value); err == nil {
			t.Fatalf("Luna %d accepted", value)
		}
	}
	for _, value := range []int32{0, -1} {
		if _, err := NewSessionCount(value); err == nil {
			t.Fatalf("sessions %d accepted", value)
		}
	}
	if _, err := NewWalletAddress("NQbad"); err == nil {
		t.Fatal("invalid wallet shape accepted")
	}
	if _, err := ParsePaymentReference("NP:bad"); err == nil {
		t.Fatal("invalid payment reference accepted")
	}
	if _, err := ParseID("123"); err == nil {
		t.Fatal("invalid ID accepted")
	}
	if _, err := NewLuna(100_000); err != nil {
		t.Fatal(err)
	}
	if LunaPerNIM != 100_000 {
		t.Fatal("incorrect NIM/Luna conversion constant")
	}
	if amount, err := ParseNIM("250.00001"); err != nil || amount != 25_000_001 {
		t.Fatalf("integer NIM conversion failed: %d %v", amount, err)
	}
	for _, text := range []string{"0", "1.000001", "-1", "+1", "999999999999999999999"} {
		if _, err := ParseNIM(text); err == nil {
			t.Fatalf("invalid NIM amount %q accepted", text)
		}
	}
}

func TestPassRejectsZeroSessionsAndPrice(t *testing.T) {
	now := time.Now().UTC()
	providerID, serviceID := mustID(t), mustID(t)
	if _, err := NewPass(mustID(t), providerID, serviceID, "10 Sessions", "", 0, 100, ExpirationPolicy{}, "", now); err == nil {
		t.Fatal("zero sessions accepted")
	}
	if _, err := NewPass(mustID(t), providerID, serviceID, "10 Sessions", "", 1, 0, ExpirationPolicy{}, "", now); err == nil {
		t.Fatal("zero price accepted")
	}
}

func TestPurchaseSnapshotAndTransitions(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	expiry := now.Add(30 * 24 * time.Hour)
	pkg, purchase := purchaseFixture(t, now, &expiry)
	if purchase.ExpiresAt.Sub(purchase.CreatedAt) != 30*time.Minute {
		t.Fatal("wrong purchase intent TTL")
	}
	pkg.Title = "Changed Pass"
	pkg.PriceLuna = 1
	pkg.Sessions = 2
	expiry = expiry.Add(24 * time.Hour)
	if purchase.Snapshot.PassTitle != "10 Sessions" || purchase.Snapshot.PriceLuna != 25_000_000 || purchase.Snapshot.Sessions != 10 {
		t.Fatal("purchase snapshot changed with catalog Pass")
	}
	if purchase.Snapshot.Expiration.ExpiresAt.Equal(expiry) {
		t.Fatal("expiration snapshot shares mutable pointer")
	}
	if err := purchase.BeginVerification(now); err == nil {
		t.Fatal("invalid CREATED -> VERIFYING accepted")
	}
	if err := purchase.AwaitPayment(now); err != nil {
		t.Fatal(err)
	}
	if err := purchase.RecordSubmission(strings.Repeat("a", 64), now.Add(31*time.Minute)); err == nil {
		t.Fatal("expired intent accepted new payment submission")
	}
	if err := purchase.RecordSubmission(strings.Repeat("a", 64), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := purchase.Expire(now.Add(31 * time.Minute)); err == nil {
		t.Fatal("submitted payment discarded as expired")
	}
	if err := purchase.BeginVerification(now.Add(2 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	wrong := VerifiedPayment{Hash: purchase.TransactionHash, Sender: purchase.ExpectedWallet, Recipient: purchase.Snapshot.Recipient, AmountLuna: 1, Reference: purchase.PaymentReference, Network: NimiqTestnet, Included: true, IncludedAt: now.Add(2 * time.Minute), Finalized: true, InclusionBlock: 1, FinalityBlock: 2, FinalizedAt: now.Add(2*time.Minute + time.Second)}
	if err := purchase.ConfirmVerified(wrong, ConfirmOnFinality, now.Add(3*time.Minute)); err == nil {
		t.Fatal("wrong amount confirmed")
	}
	if purchase.Status != PurchaseVerifying {
		t.Fatal("failed match mutated purchase")
	}
	wrong.AmountLuna = purchase.Snapshot.PriceLuna
	if err := purchase.ConfirmVerified(wrong, ConfirmOnFinality, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if purchase.Status != PurchaseConfirmed || purchase.VerifiedSender != purchase.ExpectedWallet {
		t.Fatal("verified purchase not confirmed")
	}
	if err := purchase.Cancel(now.Add(4 * time.Minute)); err == nil {
		t.Fatal("confirmed purchase cancelled")
	}
}

func TestFixedExpirationPurchaseCutoffIsInclusiveBoundary(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	expires := now.Add(PurchaseCutoffBuffer)
	if _, purchase := purchaseFixture(t, now.Add(-time.Nanosecond), &expires); purchase.ID == "" {
		t.Fatal("intent one nanosecond before cutoff rejected")
	}
	owner := mustWallet(t, "A")
	provider, err := NewProvider(mustID(t), mustID(t), "Alex Fitness", now)
	if err != nil {
		t.Fatal(err)
	}
	provider.PayoutWallet = mustWallet(t, "B")
	provider.PayoutVerifiedAt = &now
	service, err := NewService(mustID(t), provider.ID, "Personal Training", "Training", now)
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := NewPass(mustID(t), provider.ID, service.ID, "10 Sessions", "Prepaid", 10, 25_000_000, NewExpirationPolicy(&expires), "", now)
	if err != nil {
		t.Fatal(err)
	}
	if err := pkg.Publish(now); err != nil {
		t.Fatal(err)
	}
	reference, err := NewPaymentReference()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewPurchase(mustID(t), mustID(t), owner, pkg, service, provider, NimiqTestnet, reference, now); !errors.Is(err, ErrPurchaseCutoff) {
		t.Fatalf("exact cutoff accepted: %v", err)
	}
	if _, err := NewPurchase(mustID(t), mustID(t), owner, pkg, service, provider, NimiqTestnet, reference, now.Add(time.Second)); !errors.Is(err, ErrPurchaseCutoff) {
		t.Fatalf("after cutoff accepted: %v", err)
	}
	if pkg.Expiration.ExpiresAt == nil || !pkg.Expiration.ExpiresAt.Equal(expires) {
		t.Fatal("cutoff mutated pass expiration")
	}
}

func TestOpenEndedPassIgnoresPurchaseCutoff(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	if _, purchase := purchaseFixture(t, now, nil); purchase.Snapshot.Expiration.ExpiresAt != nil {
		t.Fatal("open-ended pass snapshotted an expiration")
	}
}

func TestFinalizedPaymentAfterPassExpiryRequiresCompensationNotPass(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	expires := now.Add(36 * time.Minute)
	_, purchase := purchaseFixture(t, now, &expires)
	if err := purchase.AwaitPayment(now); err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("c", 64)
	if err := purchase.RecordSubmission(hash, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := purchase.BeginVerification(now.Add(2 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	payment := VerifiedPayment{
		Hash: hash, Sender: purchase.ExpectedWallet, Recipient: purchase.Snapshot.Recipient,
		AmountLuna: purchase.Snapshot.PriceLuna, Reference: purchase.PaymentReference,
		Network: purchase.Snapshot.Network, Included: true, IncludedAt: now.Add(2 * time.Minute),
		Finalized: true, InclusionBlock: 1, FinalityBlock: 2, FinalizedAt: now.Add(2*time.Minute + time.Second),
	}
	later := expires.Add(time.Minute)
	if err := purchase.ConfirmVerified(payment, ConfirmOnFinality, later); err == nil {
		t.Fatal("expired pass confirmed into a purchased-pass-capable purchase")
	}
	if err := purchase.ReconcileVerified(payment, ConfirmOnFinality, later); err == nil {
		t.Fatal("expired pass silently confirmed")
	}
	if purchase.Status != PurchaseVerifying {
		t.Fatal("rejected confirmation mutated purchase")
	}
	if err := purchase.ReconcileCompensationRequired(payment, ConfirmOnFinality, now.Add(3*time.Minute)); err == nil {
		t.Fatal("compensation accepted before pass expiry")
	}
	if err := purchase.ReconcileCompensationRequired(payment, ConfirmOnFinality, later); err != nil {
		t.Fatal(err)
	}
	if purchase.Status != PurchaseCompensationRequired || purchase.TransactionHash != hash || purchase.ConfirmedAt == nil {
		t.Fatal("compensation did not preserve verified payment")
	}
	if _, err := NewPurchasedPass(mustID(t), purchase, mustID(t)); err == nil {
		t.Fatal("compensation purchase provisioned a pass")
	}
	if err := purchase.Fail(later); err == nil {
		t.Fatal("compensation marked failed")
	}
}

func TestPurchaseExpiredIntentCannotBeReused(t *testing.T) {
	now := time.Now().UTC()
	_, purchase := purchaseFixture(t, now, nil)
	if err := purchase.Expire(now.Add(time.Minute)); err == nil {
		t.Fatal("intent expired before TTL")
	}
	if err := purchase.Expire(now.Add(30 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := purchase.AwaitPayment(now.Add(31 * time.Minute)); err == nil {
		t.Fatal("expired intent reused")
	}
}

func TestExpiredIntentCanOnlyReconcileVerifiedSettlementWithinGrace(t *testing.T) {
	now := time.Now().UTC()
	_, purchase := purchaseFixture(t, now, nil)
	if err := purchase.AwaitPayment(now); err != nil {
		t.Fatal(err)
	}
	if err := purchase.Expire(now.Add(30 * time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := purchase.RecordSubmission(strings.Repeat("b", 64), now.Add(31*time.Minute)); err == nil {
		t.Fatal("new submission accepted after expiration")
	}
	evidence := VerifiedPayment{
		Hash: strings.Repeat("b", 64), Sender: purchase.ExpectedWallet,
		Recipient: purchase.Snapshot.Recipient, AmountLuna: purchase.Snapshot.PriceLuna,
		Reference: purchase.PaymentReference, Network: purchase.Snapshot.Network,
		Included: true, IncludedAt: purchase.ExpiresAt.Add(4 * time.Minute), Finalized: true, InclusionBlock: 1, FinalityBlock: 2, FinalizedAt: purchase.ExpiresAt.Add(4*time.Minute + time.Second),
	}
	late := evidence
	late.IncludedAt = purchase.ExpiresAt.Add(6 * time.Minute)
	if err := purchase.ReconcileVerified(late, ConfirmOnFinality, now.Add(40*time.Minute)); err == nil {
		t.Fatal("settlement outside grace accepted")
	}
	if purchase.Status != PurchaseExpired {
		t.Fatal("rejected settlement mutated intent")
	}
	if err := purchase.ReconcileVerified(evidence, ConfirmOnFinality, now.Add(40*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if purchase.Status != PurchaseConfirmed || purchase.TransactionHash != evidence.Hash {
		t.Fatal("verified settlement did not recover expired intent")
	}
	if err := purchase.ReconcileVerified(evidence, ConfirmOnFinality, now.Add(41*time.Minute)); err == nil {
		t.Fatal("confirmed payment reconciled twice")
	}
}

func TestPassConsumesExactlyOneAndCompletes(t *testing.T) {
	now := time.Now().UTC()
	_, purchase := purchaseFixture(t, now, nil)
	confirmFixture(t, &purchase, now)
	pass, err := NewPurchasedPass(mustID(t), purchase, mustID(t))
	if err != nil {
		t.Fatal(err)
	}
	if pass.OriginalSessions != 10 || pass.UsedSessions != 0 || pass.RemainingSessions != 10 || pass.Status != PurchasedPassActive {
		t.Fatal("incorrect initial pass")
	}
	for i := 1; i <= 10; i++ {
		if err := pass.ConsumeSession(now.Add(time.Duration(3+i) * time.Minute)); err != nil {
			t.Fatal(err)
		}
		if pass.UsedSessions != int32(i) || pass.RemainingSessions != int32(10-i) {
			t.Fatalf("incorrect balance after session %d", i)
		}
	}
	if pass.Status != PurchasedPassCompleted || pass.CompletedAt == nil {
		t.Fatal("last session did not complete pass")
	}
	if err := pass.ConsumeSession(now.Add(time.Hour)); err == nil {
		t.Fatal("completed pass consumed again")
	}
	if pass.RemainingSessions != 0 {
		t.Fatal("remaining sessions became negative")
	}
}

func TestPassExpirationBlocksRedemption(t *testing.T) {
	now := time.Now().UTC()
	expiry := now.Add(24 * time.Hour)
	_, purchase := purchaseFixture(t, now, &expiry)
	confirmFixture(t, &purchase, now)
	pass, err := NewPurchasedPass(mustID(t), purchase, mustID(t))
	if err != nil {
		t.Fatal(err)
	}
	if pass.ExpiresAt == nil || !pass.ExpiresAt.Equal(expiry) {
		t.Fatal("expiration snapshot lost")
	}
	if err := pass.ConsumeSession(expiry); err == nil {
		t.Fatal("expired pass consumed")
	}
	if !pass.ExpireIfDue(expiry) || pass.Status != PurchasedPassExpired {
		t.Fatal("pass not expired")
	}
}

type verifierFunc func([]byte, WalletAddress, []byte, []byte) error

func (f verifierFunc) Verify(message []byte, wallet WalletAddress, publicKey, signature []byte) error {
	return f(message, wallet, publicKey, signature)
}

func TestRedemptionRequiresSignatureAndIsSingleUse(t *testing.T) {
	now := time.Now().UTC()
	_, purchase := purchaseFixture(t, now, nil)
	confirmFixture(t, &purchase, now)
	pass, err := NewPurchasedPass(mustID(t), purchase, mustID(t))
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := NewRedemptionChallenge(mustID(t), mustID(t), pass, pass.Snapshot.ProviderID, now.Add(4*time.Minute), 2*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if err := challenge.Consume(&pass, now.Add(5*time.Minute)); err == nil {
		t.Fatal("unsigned redemption consumed")
	}
	if err := challenge.Authorize(nil, nil, nil, now.Add(5*time.Minute)); err == nil {
		t.Fatal("missing verifier accepted")
	}
	verifier := verifierFunc(func(message []byte, wallet WalletAddress, _, _ []byte) error {
		if wallet != pass.OwnerWallet || !strings.Contains(string(message), "Purpose: AUTHORIZE_REDEMPTION") || !strings.Contains(string(message), string(challenge.Nonce)) {
			return errors.New("wrong signing context")
		}
		return nil
	})
	if err := challenge.Authorize(verifier, []byte{1}, []byte{2}, now.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := challenge.Consume(&pass, now.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	record, err := NewRedemption(mustID(t), challenge, pass)
	if err != nil || record.SessionOrdinal != 1 || record.PassID != pass.ID {
		t.Fatalf("invalid redemption audit record: %+v %v", record, err)
	}
	if pass.RemainingSessions != 9 {
		t.Fatal("redemption did not consume one session")
	}
	if err := challenge.Consume(&pass, now.Add(5*time.Minute)); err == nil {
		t.Fatal("replay consumed a second session")
	}
	if pass.RemainingSessions != 9 {
		t.Fatal("replay changed balance")
	}
}

func TestRedemptionExpiryAndPassBinding(t *testing.T) {
	now := time.Now().UTC()
	_, purchase := purchaseFixture(t, now, nil)
	confirmFixture(t, &purchase, now)
	pass, err := NewPurchasedPass(mustID(t), purchase, mustID(t))
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := NewRedemptionChallenge(mustID(t), mustID(t), pass, pass.Snapshot.ProviderID, now.Add(4*time.Minute), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	verifier := verifierFunc(func([]byte, WalletAddress, []byte, []byte) error { return nil })
	if err := challenge.Authorize(verifier, []byte{1}, []byte{1}, now.Add(5*time.Minute)); err == nil {
		t.Fatal("expired challenge authorized")
	}
	if challenge.Status != RedemptionExpired {
		t.Fatal("expired challenge not marked expired")
	}
	other := pass
	other.ID = mustID(t)
	challenge, err = NewRedemptionChallenge(mustID(t), mustID(t), pass, pass.Snapshot.ProviderID, now.Add(6*time.Minute), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if err := challenge.Authorize(verifier, []byte{1}, []byte{1}, now.Add(6*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := challenge.Consume(&other, now.Add(6*time.Minute)); err == nil {
		t.Fatal("wrong pass consumed")
	}
	if other.RemainingSessions != 10 {
		t.Fatal("wrong pass balance changed")
	}
}

func TestParseAccent(t *testing.T) {
	if got, err := ParseAccent(""); err != nil || got != "" {
		t.Fatalf("empty accent rejected: %q %v", got, err)
	}
	if got, err := ParseAccent("PLUM"); err != nil || got != AccentPlum {
		t.Fatalf("plum rejected: %q %v", got, err)
	}
	if _, err := ParseAccent("NEON"); err == nil {
		t.Fatal("unknown accent accepted")
	}
}

func TestRedemptionChallengeRejectsLongTTL(t *testing.T) {
	now := time.Now().UTC()
	_, purchase := purchaseFixture(t, now, nil)
	confirmFixture(t, &purchase, now)
	pass, err := NewPurchasedPass(mustID(t), purchase, mustID(t))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewRedemptionChallenge(mustID(t), mustID(t), pass, pass.Snapshot.ProviderID, now.Add(4*time.Minute), time.Hour); err == nil {
		t.Fatal("long-lived challenge accepted")
	}
}

// Luna is the authoritative unit; NIM is what a human and a payment link see.
// A wrong conversion here is a customer paying 100,000x the price, or a Pass
// issued for a hundred-thousandth of it, so both directions are pinned.
func TestLunaNIMConversionIsExactAndReversible(t *testing.T) {
	cases := []struct {
		luna Luna
		nim  string
	}{
		{1, "0.00001"},
		{LunaPerNIM, "1"},
		{150_000, "1.5"},
		{123_456, "1.23456"},
		{25_000_000, "250"},
		// The mission's own example: 1000 NIM is 100,000,000 Luna.
		{100_000_000, "1000"},
		{100_000_001, "1000.00001"},
	}
	for _, c := range cases {
		if got := c.luna.NIM(); got != c.nim {
			t.Fatalf("Luna(%d).NIM() = %q, want %q", c.luna, got, c.nim)
		}
		back, err := ParseNIM(c.nim)
		if err != nil || back != c.luna {
			t.Fatalf("ParseNIM(%q) = %d, %v; want %d", c.nim, back, err, c.luna)
		}
	}
}

// 1000 NIM must never be encodable as anything a wallet would read as 800.
func TestLunaNIMNeverLosesPrecision(t *testing.T) {
	for luna := Luna(1); luna < 300_000; luna += 7 {
		back, err := ParseNIM(luna.NIM())
		if err != nil || back != luna {
			t.Fatalf("round trip broke at %d Luna: %q -> %d (%v)", luna, luna.NIM(), back, err)
		}
	}
}

// The wallet half of ADR-012's rule, restated where an intent is built.
//
// The account half — a provider buying from their own catalogue — is decided
// against `providers.owner_identity_id` and is already an invariant on
// `NewPurchasedPass`. This is the other half: whoever owns the provider
// record, an intent whose payee is the buying wallet would move no value, and
// it cannot be constructed.
func TestAPurchaseThatPaysTheBuyerCannotBeBuilt(t *testing.T) {
	now := time.Now().UTC()
	buyer := mustWallet(t, "C")
	provider, err := NewProvider(mustID(t), mustID(t), "Alex Fitness", now)
	if err != nil {
		t.Fatal(err)
	}
	provider.PayoutWallet = buyer
	provider.PayoutVerifiedAt = &now
	service, err := NewService(mustID(t), provider.ID, "Personal Training", "Training", now)
	if err != nil {
		t.Fatal(err)
	}
	pass, err := NewPass(mustID(t), provider.ID, service.ID, "10 Sessions", "Prepaid", 10, 25_000_000, NewExpirationPolicy(nil), "", now)
	if err != nil {
		t.Fatal(err)
	}
	if err := pass.Publish(now); err != nil {
		t.Fatal(err)
	}
	reference, err := NewPaymentReference()
	if err != nil {
		t.Fatal(err)
	}
	// Spaced and lower-cased, so the comparison is shown to be between
	// canonical forms rather than between spellings.
	spaced := WalletAddress(strings.ToLower(string(buyer[:4]) + " " + string(buyer[4:])))
	if _, err := NewPurchase(mustID(t), mustID(t), spaced, pass, service, provider, NimiqTestnet, reference, now); !errors.Is(err, ErrSelfPurchase) {
		t.Fatalf("an intent paying its own buyer was built: %v", err)
	}
	// A different wallet buying the same pass is an ordinary purchase.
	if _, err := NewPurchase(mustID(t), mustID(t), mustWallet(t, "D"), pass, service, provider, NimiqTestnet, reference, now); err != nil {
		t.Fatalf("ordinary purchase: %v", err)
	}
}
