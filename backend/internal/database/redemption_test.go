package database

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

type redemptionFixture struct {
	Pool       *PaymentRepository
	Customer   application.Identity
	Provider   application.Identity
	ProviderID domain.ID
	PassID     domain.ID
	Wallet     string
	Public     string
	Key        ed25519.PrivateKey
	Now        time.Time
}

func newRedemptionFixture(t *testing.T) redemptionFixture {
	t.Helper()
	pool := missionPool(t)
	customer, _, pkg, _ := paymentOffer(t, pool)
	customerWallet, customerPublic, customerKey := missionKey(t)
	if _, err := pool.Exec(context.Background(), `UPDATE identities SET wallet_address=$2 WHERE id=$1`, customer.ID, customerWallet); err != nil {
		t.Fatal(err)
	}
	customer.Wallet = customerWallet
	var providerID, ownerID string
	if err := pool.QueryRow(context.Background(), `SELECT pr.id,pr.owner_identity_id FROM providers pr JOIN packages pk ON pk.provider_id=pr.id WHERE pk.id=$1`, pkg).Scan(&providerID, &ownerID); err != nil {
		t.Fatal(err)
	}
	var providerWalletStored string
	if err := pool.QueryRow(context.Background(), `SELECT wallet_address FROM identities WHERE id=$1`, ownerID).Scan(&providerWalletStored); err != nil {
		t.Fatal(err)
	}
	provider := application.Identity{ID: domain.ID(ownerID), Wallet: providerWalletStored}
	started := time.Now().UTC().Truncate(time.Microsecond).Add(time.Second)
	chain := &testChain{}
	payments := application.Payments{Store: PaymentRepository{Pool: pool}, Chain: chain, Network: domain.NimiqTestnet, Now: func() time.Time { return started }}
	intent, _, err := payments.Create(context.Background(), customer, pkg, "redemption-fixture")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("9", 64)
	if _, err := payments.Submit(context.Background(), customer, intent.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	chain.set(paymentEvidence(intent, hash, true), nil)
	settled, err := payments.Reconcile(context.Background(), customer, intent.Purchase.ID)
	if err != nil || settled.PassID == "" {
		t.Fatalf("create pass: %+v %v", settled, err)
	}
	return redemptionFixture{Pool: &PaymentRepository{Pool: pool}, Customer: customer, Provider: provider, ProviderID: domain.ID(providerID), PassID: settled.PassID, Wallet: customerWallet, Public: customerPublic, Key: customerKey, Now: started}
}

func (f redemptionFixture) Service() application.Redemptions {
	return application.Redemptions{Store: f.Pool, Passes: f.Pool, Verifier: nimiq.Ed25519Verifier{}, Network: domain.NimiqTestnet, Environment: "test", Now: func() time.Time { return f.Now }}
}

func (f redemptionFixture) authorize(t *testing.T, view application.RedemptionView) application.RedemptionView {
	t.Helper()
	signature := hex.EncodeToString(ed25519.Sign(f.Key, view.Challenge.SigningMessage()))
	result, err := f.Service().Authorize(context.Background(), f.Customer, view.Challenge.ID, f.Public, signature)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestRedemptionLifecycleHistoryAndRotation(t *testing.T) {
	f := newRedemptionFixture(t)
	ctx := context.Background()
	svc := f.Service()
	created, err := svc.CreateChallenge(ctx, f.Customer, f.PassID)
	if err != nil || created.Challenge.Status != domain.RedemptionCreated || created.QRReference != "" || created.Challenge.ExpiresAt.Sub(created.Challenge.CreatedAt) != application.RedemptionChallengeTTL {
		t.Fatalf("challenge creation: %+v %v", created, err)
	}
	if !strings.Contains(string(created.Challenge.SigningMessage()), "Purpose: AUTHORIZE_REDEMPTION") || !strings.Contains(string(created.Challenge.SigningMessage()), "Network: TESTNET") {
		t.Fatal("canonical redemption message missing security context")
	}
	authorized := f.authorize(t, created)
	if authorized.Challenge.Status != domain.RedemptionAuthorized || !strings.HasPrefix(authorized.QRReference, "NR1:") || authorized.QRExpiresAt == nil {
		t.Fatalf("authorization: %+v", authorized)
	}
	rotated, err := svc.CreateChallenge(ctx, f.Customer, f.PassID)
	if err != nil || rotated.QRReference == authorized.QRReference || rotated.Challenge.ID != authorized.Challenge.ID {
		t.Fatalf("token rotation: %+v %v", rotated, err)
	}
	lookup, err := svc.Lookup(ctx, f.Provider, f.ProviderID, rotated.QRReference)
	if err != nil || lookup.ChallengeID != rotated.Challenge.ID || lookup.ServiceName == "" || lookup.PackageTitle == "" || lookup.UsedSessions != 0 || lookup.RemainingSessions != 10 || lookup.NextSessionOrdinal != 1 {
		t.Fatalf("provider lookup: %+v %v", lookup, err)
	}
	var used, remaining int32
	if err := f.Pool.Pool.QueryRow(ctx, `SELECT used_sessions,remaining_sessions FROM passes WHERE id=$1`, f.PassID).Scan(&used, &remaining); err != nil || used != 0 || remaining != 10 {
		t.Fatalf("lookup consumed a session: used=%d remaining=%d err=%v", used, remaining, err)
	}
	if _, err := svc.Confirm(ctx, f.Provider, f.ProviderID, authorized.QRReference); !errors.Is(err, application.ErrInvalidRedemptionToken) {
		t.Fatalf("old QR remained valid: %v", err)
	}
	if _, err := svc.Lookup(ctx, f.Provider, f.ProviderID, authorized.QRReference); !errors.Is(err, application.ErrInvalidRedemptionToken) {
		t.Fatalf("old QR remained discoverable: %v", err)
	}
	if _, err := svc.Confirm(ctx, f.Customer, f.ProviderID, rotated.QRReference); !errors.Is(err, application.ErrInvalidRedemptionToken) {
		t.Fatalf("non-provider session consumed QR: %v", err)
	}
	if _, err := svc.Lookup(ctx, f.Customer, f.ProviderID, rotated.QRReference); !errors.Is(err, application.ErrInvalidRedemptionToken) {
		t.Fatalf("non-provider session looked up QR: %v", err)
	}
	consumed, err := svc.Confirm(ctx, f.Provider, f.ProviderID, rotated.QRReference)
	if err != nil || consumed.Redemption.SessionOrdinal != 1 || consumed.Pass.UsedSessions != 1 || consumed.Pass.RemainingSessions != 9 || consumed.Pass.Status != domain.PassActive {
		t.Fatalf("confirmation: %+v %v", consumed, err)
	}
	if _, err := svc.Confirm(ctx, f.Provider, f.ProviderID, rotated.QRReference); !errors.Is(err, application.ErrRedemptionConsumed) {
		t.Fatalf("QR replay consumed another session: %v", err)
	}
	if _, err := svc.Lookup(ctx, f.Provider, f.ProviderID, rotated.QRReference); !errors.Is(err, application.ErrRedemptionConsumed) {
		t.Fatalf("consumed QR was reported as usable: %v", err)
	}
	history, err := svc.PassHistory(ctx, f.Customer, f.PassID)
	if err != nil || len(history) != 1 || history[0].SessionOrdinal != 1 {
		t.Fatalf("customer history: %+v %v", history, err)
	}
	providerHistory, err := svc.ProviderHistory(ctx, f.Provider, f.ProviderID)
	if err != nil || len(providerHistory) != 1 {
		t.Fatalf("provider history: %+v %v", providerHistory, err)
	}
}

func TestLocalBackendFullLifecycleFromPaymentToRedemption(t *testing.T) {
	f := newRedemptionFixture(t)
	ctx := context.Background()
	svc := f.Service()
	for ordinal := int32(1); ordinal <= 10; ordinal++ {
		challenge, err := svc.CreateChallenge(ctx, f.Customer, f.PassID)
		if err != nil {
			t.Fatalf("session %d challenge: %v", ordinal, err)
		}
		if challenge.Challenge.Nonce == f.PassID {
			t.Fatalf("session %d reused Pass ID as challenge nonce", ordinal)
		}
		authorized := f.authorize(t, challenge)
		lookup, err := svc.Lookup(ctx, f.Provider, f.ProviderID, authorized.QRReference)
		if err != nil || lookup.RemainingSessions != 11-ordinal || lookup.NextSessionOrdinal != domain.SessionCount(ordinal) {
			t.Fatalf("session %d lookup: %+v %v", ordinal, lookup, err)
		}
		confirmed, err := svc.Confirm(ctx, f.Provider, f.ProviderID, authorized.QRReference)
		if err != nil || confirmed.Pass.UsedSessions != ordinal || confirmed.Pass.RemainingSessions != 10-ordinal || confirmed.Redemption.SessionOrdinal != domain.SessionCount(ordinal) {
			t.Fatalf("session %d confirmation: %+v %v", ordinal, confirmed, err)
		}
		if ordinal == 10 && confirmed.Pass.Status != domain.PassCompleted {
			t.Fatalf("final session did not complete Pass: %+v", confirmed.Pass)
		}
	}
	history, err := svc.PassHistory(ctx, f.Customer, f.PassID)
	if err != nil || len(history) != 10 {
		t.Fatalf("complete lifecycle history: %+v %v", history, err)
	}
	seen := make(map[domain.SessionCount]bool, len(history))
	for _, item := range history {
		seen[item.SessionOrdinal] = true
	}
	for ordinal := domain.SessionCount(1); ordinal <= 10; ordinal++ {
		if !seen[ordinal] {
			t.Fatalf("session %d missing from history", ordinal)
		}
	}
	if _, err := svc.CreateChallenge(ctx, f.Customer, f.PassID); !errors.Is(err, application.ErrPassCompleted) {
		t.Fatalf("completed Pass accepted another challenge: %v", err)
	}
}

func TestRedemptionAuthorizationRejectsWrongSignatureAndStaleContext(t *testing.T) {
	f := newRedemptionFixture(t)
	ctx := context.Background()
	svc := f.Service()
	created, err := svc.CreateChallenge(ctx, f.Customer, f.PassID)
	if err != nil {
		t.Fatal(err)
	}
	wrong := strings.Repeat("0", 128)
	if _, err := svc.Authorize(ctx, f.Customer, created.Challenge.ID, f.Public, wrong); !errors.Is(err, application.ErrInvalidRedemptionSignature) {
		t.Fatalf("wrong signature accepted: %v", err)
	}
	authMessage := application.Challenge{Purpose: application.AuthLogin, ID: created.Challenge.ID, Wallet: f.Customer.Wallet, Nonce: string(created.Challenge.Nonce), Network: "TESTNET", Environment: "test", IssuedAt: created.Challenge.CreatedAt, ExpiresAt: created.Challenge.ExpiresAt}.Message()
	if _, err := svc.Authorize(ctx, f.Customer, created.Challenge.ID, f.Public, hex.EncodeToString(ed25519.Sign(f.Key, []byte(authMessage)))); !errors.Is(err, application.ErrInvalidRedemptionSignature) {
		t.Fatalf("AUTH_LOGIN signature accepted for redemption: %v", err)
	}
	authorized := f.authorize(t, created)
	if _, err := f.Pool.Pool.Exec(ctx, `UPDATE passes SET used_sessions=2,remaining_sessions=8 WHERE id=$1`, f.PassID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Confirm(ctx, f.Provider, f.ProviderID, authorized.QRReference); !errors.Is(err, application.ErrStaleRedemptionChallenge) {
		t.Fatalf("stale authorized challenge consumed: %v", err)
	}
	if _, err := svc.Lookup(ctx, f.Provider, f.ProviderID, authorized.QRReference); !errors.Is(err, application.ErrStaleRedemptionChallenge) {
		t.Fatalf("stale authorized challenge was shown as consumable: %v", err)
	}
}

func TestAuthorizedReferenceRotationRequiresItsOwnCurrentPass(t *testing.T) {
	f := newRedemptionFixture(t)
	ctx := context.Background()
	svc := f.Service()
	created, err := svc.CreateChallenge(ctx, f.Customer, f.PassID)
	if err != nil {
		t.Fatal(err)
	}
	authorized := f.authorize(t, created)
	var originalDigest []byte
	if err := f.Pool.Pool.QueryRow(ctx, `SELECT qr_token_digest FROM redemption_challenges WHERE id=$1`, created.Challenge.ID).Scan(&originalDigest); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Pool.Pool.Exec(ctx, `UPDATE passes SET used_sessions=1,remaining_sessions=9 WHERE id=$1`, f.PassID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateChallenge(ctx, f.Customer, f.PassID); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("stale authorized Pass rotated its reference: %v", err)
	}
	if _, err := f.Pool.Pool.Exec(ctx, `UPDATE passes SET used_sessions=0,remaining_sessions=10,expires_at=$2 WHERE id=$1`, f.PassID, f.Now.Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	var packageID domain.ID
	if err := f.Pool.Pool.QueryRow(ctx, `SELECT package_id FROM passes WHERE id=$1`, f.PassID).Scan(&packageID); err != nil {
		t.Fatal(err)
	}
	chain := &testChain{}
	payments := application.Payments{Store: *f.Pool, Chain: chain, Network: domain.NimiqTestnet, Now: func() time.Time { return f.Now }}
	second, _, err := payments.Create(ctx, f.Customer, packageID, "second-active-pass")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("8", 64)
	if _, err := payments.Submit(ctx, f.Customer, second.Purchase.ID, hash); err != nil {
		t.Fatal(err)
	}
	chain.set(paymentEvidence(second, hash, true), nil)
	if settled, err := payments.Reconcile(ctx, f.Customer, second.Purchase.ID); err != nil || settled.PassID == "" {
		t.Fatalf("second active Pass: %+v %v", settled, err)
	}
	if _, err := svc.CreateChallenge(ctx, f.Customer, f.PassID); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("expired Pass rotated using another active Pass: %v", err)
	}
	var currentDigest []byte
	if err := f.Pool.Pool.QueryRow(ctx, `SELECT qr_token_digest FROM redemption_challenges WHERE id=$1`, created.Challenge.ID).Scan(&currentDigest); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(currentDigest, originalDigest) {
		t.Fatal("rejected rotation changed the stored reference digest")
	}
	if _, err := svc.Confirm(ctx, f.Provider, f.ProviderID, authorized.QRReference); !errors.Is(err, application.ErrPassExpired) {
		t.Fatalf("expired original Pass was consumed: %v", err)
	}
}

func TestChallengeInsertRejectsPassChangedAfterSnapshot(t *testing.T) {
	f := newRedemptionFixture(t)
	ctx := context.Background()
	pass, err := f.Pool.GetPass(ctx, f.PassID, f.Customer.ID)
	if err != nil {
		t.Fatal(err)
	}
	id, err := domain.NewID()
	if err != nil {
		t.Fatal(err)
	}
	nonce, err := domain.NewID()
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := domain.NewBoundRedemptionChallenge(id, nonce, pass, f.ProviderID, domain.NimiqTestnet, "test", f.Now, application.RedemptionChallengeTTL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Pool.Pool.Exec(ctx, `UPDATE passes SET used_sessions=1,remaining_sessions=9 WHERE id=$1`, f.PassID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Pool.InsertChallenge(ctx, challenge, f.Customer.ID, domain.WalletAddress(f.Customer.Wallet), f.Now); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("stale challenge insert returned %v instead of conflict", err)
	}
}

func TestRedemptionConfirmationDoesNotMisreportDatabaseOutageAsInvalidReference(t *testing.T) {
	f := newRedemptionFixture(t)
	ctx := context.Background()
	created, err := f.Service().CreateChallenge(ctx, f.Customer, f.PassID)
	if err != nil {
		t.Fatal(err)
	}
	authorized := f.authorize(t, created)
	if _, err := f.Pool.Pool.Exec(ctx, `DROP TABLE redemption_challenges CASCADE`); err != nil {
		t.Fatal(err)
	}
	_, err = f.Service().Confirm(ctx, f.Provider, f.ProviderID, authorized.QRReference)
	if err == nil || errors.Is(err, application.ErrInvalidRedemptionToken) {
		t.Fatalf("database failure was reported as invalid reference: %v", err)
	}
}

func TestConcurrentRedemptionAuthorizationIsSingleUse(t *testing.T) {
	f := newRedemptionFixture(t)
	ctx := context.Background()
	svc := f.Service()
	created, err := svc.CreateChallenge(ctx, f.Customer, f.PassID)
	if err != nil {
		t.Fatal(err)
	}
	signature := hex.EncodeToString(ed25519.Sign(f.Key, created.Challenge.SigningMessage()))
	var wg sync.WaitGroup
	errs := make(chan error, 12)
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.Authorize(ctx, f.Customer, created.Challenge.ID, f.Public, signature)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	successes, conflicts := 0, 0
	for err := range errs {
		if err == nil {
			successes++
		} else if errors.Is(err, application.ErrConflict) {
			conflicts++
		} else {
			t.Fatalf("concurrent authorization: %v", err)
		}
	}
	if successes != 1 || conflicts != 11 {
		t.Fatalf("authorization successes=%d conflicts=%d", successes, conflicts)
	}
	var authorized int
	if err := f.Pool.Pool.QueryRow(ctx, `SELECT count(*) FROM redemption_challenges WHERE id=$1 AND status='AUTHORIZED'`, created.Challenge.ID).Scan(&authorized); err != nil || authorized != 1 {
		t.Fatalf("authorization state count=%d err=%v", authorized, err)
	}
}

func TestConcurrentChallengeCreationHasOneActiveChallenge(t *testing.T) {
	f := newRedemptionFixture(t)
	svc := f.Service()
	var wg sync.WaitGroup
	results := make(chan application.RedemptionView, 12)
	errs := make(chan error, 12)
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			view, err := svc.CreateChallenge(context.Background(), f.Customer, f.PassID)
			results <- view
			errs <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var challengeIDs []domain.ID
	for view := range results {
		challengeIDs = append(challengeIDs, view.Challenge.ID)
	}
	var active int
	if err := f.Pool.Pool.QueryRow(context.Background(), `SELECT count(*) FROM redemption_challenges WHERE pass_id=$1 AND status IN ('CREATED','AUTHORIZED')`, f.PassID).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active != 1 || len(challengeIDs) != 12 {
		t.Fatalf("active challenge count=%d results=%d", active, len(challengeIDs))
	}
}

func TestConcurrentFinalRedemptionConsumesExactlyOneSession(t *testing.T) {
	f := newRedemptionFixture(t)
	ctx := context.Background()
	if _, err := f.Pool.Pool.Exec(ctx, `UPDATE passes SET used_sessions=9,remaining_sessions=1 WHERE id=$1`, f.PassID); err != nil {
		t.Fatal(err)
	}
	svc := f.Service()
	created, err := svc.CreateChallenge(ctx, f.Customer, f.PassID)
	if err != nil {
		t.Fatal(err)
	}
	authorized := f.authorize(t, created)
	var wg sync.WaitGroup
	errs := make(chan error, 12)
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.Confirm(ctx, f.Provider, f.ProviderID, authorized.QRReference)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	successes, consumedErrors := 0, 0
	for err := range errs {
		if err == nil {
			successes++
		} else if errors.Is(err, application.ErrRedemptionConsumed) {
			consumedErrors++
		} else {
			t.Fatalf("concurrent confirmation: %v", err)
		}
	}
	var used, remaining int32
	var status string
	if err := f.Pool.Pool.QueryRow(ctx, `SELECT used_sessions,remaining_sessions,status FROM passes WHERE id=$1`, f.PassID).Scan(&used, &remaining, &status); err != nil {
		t.Fatal(err)
	}
	var redemptions int
	if err := f.Pool.Pool.QueryRow(ctx, `SELECT count(*) FROM redemptions WHERE pass_id=$1`, f.PassID).Scan(&redemptions); err != nil {
		t.Fatal(err)
	}
	if successes != 1 || consumedErrors != 11 || used != 10 || remaining != 0 || status != "COMPLETED" || redemptions != 1 {
		t.Fatalf("success=%d consumedErrors=%d used=%d remaining=%d status=%s redemptions=%d", successes, consumedErrors, used, remaining, status, redemptions)
	}
}

func TestExpiredPassCannotAuthorizeOrConsume(t *testing.T) {
	f := newRedemptionFixture(t)
	ctx := context.Background()
	if _, err := f.Pool.Pool.Exec(ctx, `UPDATE passes SET expires_at=$2 WHERE id=$1`, f.PassID, f.Now.Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Service().CreateChallenge(ctx, f.Customer, f.PassID); !errors.Is(err, application.ErrPassExpired) {
		t.Fatalf("expired pass challenge: %v", err)
	}
	pass, err := f.Pool.GetPass(ctx, f.PassID, f.Customer.ID)
	if err != nil || pass.Status != domain.PassExpired {
		t.Fatalf("expired Pass still appears active: %+v %v", pass, err)
	}
	var persisted string
	if err := f.Pool.Pool.QueryRow(ctx, `SELECT status FROM passes WHERE id=$1`, f.PassID).Scan(&persisted); err != nil || persisted != string(domain.PassExpired) {
		t.Fatalf("Pass expiration was not persisted: %q %v", persisted, err)
	}
}
