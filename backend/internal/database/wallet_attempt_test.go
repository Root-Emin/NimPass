package database

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

func TestWalletAttemptSerializesDevicesAndPreservesUncertainty(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, other, product, _ := paymentOffer(t, pool)
	repo := PaymentRepository{Pool: pool}
	now := time.Now().UTC()
	svc := application.Payments{Store: repo, Network: domain.NimiqTestnet, Now: func() time.Time { return now }}
	purchase, _, err := svc.Create(ctx, customer, product, "handoff")
	if err != nil {
		t.Fatal(err)
	}
	id := purchase.Purchase.ID
	if _, err = repo.BeginWalletAttempt(ctx, id, other.ID, paymentID(t), now); !errors.Is(err, application.ErrNotFound) {
		t.Fatalf("wrong wallet: %v", err)
	}
	var wins atomic.Int32
	var winner domain.ID
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		attempt := paymentID(t)
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, e := repo.BeginWalletAttempt(ctx, id, customer.ID, attempt, now)
			if e == nil {
				wins.Add(1)
				mu.Lock()
				winner = attempt
				mu.Unlock()
				if result.WalletAttemptPending {
					t.Error("dispatch winner needs the pre-lock instruction")
				}
			} else if !errors.Is(e, application.ErrConflict) {
				t.Errorf("begin: %v", e)
			}
		}()
	}
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatalf("dispatches=%d", wins.Load())
	}
	if _, err = repo.BeginWalletAttempt(ctx, id, customer.ID, winner, now); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("replay: %v", err)
	}
	locked, err := repo.Get(ctx, id, customer.ID)
	if err != nil || !locked.WalletAttemptPending {
		t.Fatalf("lost lock: %+v %v", locked, err)
	}
	if _, err = repo.Cancel(ctx, id, customer.ID, now); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("cancel possibly paid: %v", err)
	}
	if err = repo.ReleaseWalletAttempt(ctx, id, customer.ID, paymentID(t)); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("wrong attempt released: %v", err)
	}
	now = now.Add(time.Hour)
	reused, wasReused, err := svc.Create(ctx, customer, product, "another-browser")
	if err != nil || !wasReused || reused.Purchase.ID != id {
		t.Fatalf("expired ambiguity created a second intent: %+v %v %v", reused, wasReused, err)
	}
	if err = repo.ReleaseWalletAttempt(ctx, id, customer.ID, winner); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.BeginWalletAttempt(ctx, id, customer.ID, paymentID(t), now); !errors.Is(err, application.ErrExpired) {
		t.Fatalf("expired dispatch: %v", err)
	}
}

func TestWalletAttemptReleaseCannotEraseSubmittedEvidence(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	customer, _, product, _ := paymentOffer(t, pool)
	repo := PaymentRepository{Pool: pool}
	svc := application.Payments{Store: repo, Network: domain.NimiqTestnet, Now: time.Now}
	p, _, err := svc.Create(ctx, customer, product, "")
	if err != nil {
		t.Fatal(err)
	}
	attempt := paymentID(t)
	if _, err = repo.BeginWalletAttempt(ctx, p.Purchase.ID, customer.ID, attempt, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Submit(ctx, customer, p.Purchase.ID, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); err != nil {
		t.Fatal(err)
	}
	if err = repo.ReleaseWalletAttempt(ctx, p.Purchase.ID, customer.ID, attempt); !errors.Is(err, application.ErrConflict) {
		t.Fatalf("submitted lock released: %v", err)
	}
}
