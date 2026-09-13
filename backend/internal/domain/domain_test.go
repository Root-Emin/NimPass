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

func purchaseFixture(t *testing.T, now time.Time, expiration *time.Time) (Package, Purchase) {
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
	pkg, err := NewPackage(mustID(t), provider.ID, service.ID, "10 Sessions", "Prepaid", 10, 25_000_000, NewExpirationPolicy(expiration), now)
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
		Network: purchase.Snapshot.Network, Included: true, IncludedAt: now.Add(2 * time.Minute), Finalized: true, InclusionBlock: 1, FinalityBlock: 2,
	}, now.Add(3*time.Minute)); err != nil {
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

func TestPackageRejectsZeroSessionsAndPrice(t *testing.T) {
	now := time.Now().UTC()
	providerID, serviceID := mustID(t), mustID(t)
	if _, err := NewPackage(mustID(t), providerID, serviceID, "Package", "", 0, 100, ExpirationPolicy{}, now); err == nil {
		t.Fatal("zero sessions accepted")
	}
	if _, err := NewPackage(mustID(t), providerID, serviceID, "Package", "", 1, 0, ExpirationPolicy{}, now); err == nil {
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
	pkg.Title = "Changed Package"
	pkg.PriceLuna = 1
	pkg.Sessions = 2
	expiry = expiry.Add(24 * time.Hour)
	if purchase.Snapshot.PackageTitle != "10 Sessions" || purchase.Snapshot.PriceLuna != 25_000_000 || purchase.Snapshot.Sessions != 10 {
		t.Fatal("purchase snapshot changed with package")
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
	wrong := VerifiedPayment{Hash: purchase.TransactionHash, Sender: purchase.ExpectedWallet, Recipient: purchase.Snapshot.Recipient, AmountLuna: 1, Reference: purchase.PaymentReference, Network: NimiqTestnet, Included: true, IncludedAt: now.Add(2 * time.Minute), Finalized: true, InclusionBlock: 1, FinalityBlock: 2}
	if err := purchase.ConfirmVerified(wrong, now.Add(3*time.Minute)); err == nil {
		t.Fatal("wrong amount confirmed")
	}
	if purchase.Status != PurchaseVerifying {
		t.Fatal("failed match mutated purchase")
	}
	wrong.AmountLuna = purchase.Snapshot.PriceLuna
	if err := purchase.ConfirmVerified(wrong, now.Add(3*time.Minute)); err != nil {
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
	pkg, err := NewPackage(mustID(t), provider.ID, service.ID, "10 Sessions", "Prepaid", 10, 25_000_000, NewExpirationPolicy(&expires), now)
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
		t.Fatal("cutoff mutated package expiration")
	}
}

func TestOpenEndedPackageIgnoresPurchaseCutoff(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	if _, purchase := purchaseFixture(t, now, nil); purchase.Snapshot.Expiration.ExpiresAt != nil {
		t.Fatal("open-ended package snapshotted an expiration")
	}
}

func TestFinalizedPaymentAfterPackageExpiryRequiresCompensationNotPass(t *testing.T) {
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
		Finalized: true, InclusionBlock: 1, FinalityBlock: 2,
	}
	later := expires.Add(time.Minute)
	if err := purchase.ConfirmVerified(payment, later); err == nil {
		t.Fatal("expired package confirmed into a pass-capable purchase")
	}
	if err := purchase.ReconcileVerified(payment, later); err == nil {
		t.Fatal("expired package silently confirmed")
	}
	if purchase.Status != PurchaseVerifying {
		t.Fatal("rejected confirmation mutated purchase")
	}
	if err := purchase.ReconcileCompensationRequired(payment, now.Add(3*time.Minute)); err == nil {
		t.Fatal("compensation accepted before package expiry")
	}
	if err := purchase.ReconcileCompensationRequired(payment, later); err != nil {
		t.Fatal(err)
	}
	if purchase.Status != PurchaseCompensationRequired || purchase.TransactionHash != hash || purchase.ConfirmedAt == nil {
		t.Fatal("compensation did not preserve verified payment")
	}
	if _, err := NewPass(mustID(t), purchase); err == nil {
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
		Included: true, IncludedAt: purchase.ExpiresAt.Add(4 * time.Minute), Finalized: true, InclusionBlock: 1, FinalityBlock: 2,
	}
	late := evidence
	late.IncludedAt = purchase.ExpiresAt.Add(6 * time.Minute)
	if err := purchase.ReconcileVerified(late, now.Add(40*time.Minute)); err == nil {
		t.Fatal("settlement outside grace accepted")
	}
	if purchase.Status != PurchaseExpired {
		t.Fatal("rejected settlement mutated intent")
	}
	if err := purchase.ReconcileVerified(evidence, now.Add(40*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if purchase.Status != PurchaseConfirmed || purchase.TransactionHash != evidence.Hash {
		t.Fatal("verified settlement did not recover expired intent")
	}
	if err := purchase.ReconcileVerified(evidence, now.Add(41*time.Minute)); err == nil {
		t.Fatal("confirmed payment reconciled twice")
	}
}

func TestPassConsumesExactlyOneAndCompletes(t *testing.T) {
	now := time.Now().UTC()
	_, purchase := purchaseFixture(t, now, nil)
	confirmFixture(t, &purchase, now)
	pass, err := NewPass(mustID(t), purchase)
	if err != nil {
		t.Fatal(err)
	}
	if pass.OriginalSessions != 10 || pass.UsedSessions != 0 || pass.RemainingSessions != 10 || pass.Status != PassActive {
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
	if pass.Status != PassCompleted || pass.CompletedAt == nil {
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
	pass, err := NewPass(mustID(t), purchase)
	if err != nil {
		t.Fatal(err)
	}
	if pass.ExpiresAt == nil || !pass.ExpiresAt.Equal(expiry) {
		t.Fatal("expiration snapshot lost")
	}
	if err := pass.ConsumeSession(expiry); err == nil {
		t.Fatal("expired pass consumed")
	}
	if !pass.ExpireIfDue(expiry) || pass.Status != PassExpired {
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
	pass, err := NewPass(mustID(t), purchase)
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
	pass, err := NewPass(mustID(t), purchase)
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

func TestRedemptionChallengeRejectsLongTTL(t *testing.T) {
	now := time.Now().UTC()
	_, purchase := purchaseFixture(t, now, nil)
	confirmFixture(t, &purchase, now)
	pass, err := NewPass(mustID(t), purchase)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewRedemptionChallenge(mustID(t), mustID(t), pass, pass.Snapshot.ProviderID, now.Add(4*time.Minute), time.Hour); err == nil {
		t.Fatal("long-lived challenge accepted")
	}
}
