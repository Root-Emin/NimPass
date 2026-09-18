package application

import (
	"context"
	"testing"
	"time"

	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// A store that records whether verification wrote anything at all.
type throttleStore struct {
	PaymentStore
	record PurchaseRecord
	marks  []string
}

func (s *throttleStore) Get(context.Context, domain.ID, domain.ID) (PurchaseRecord, error) {
	return s.record, nil
}

func (s *throttleStore) Mark(_ context.Context, _, _ domain.ID, _, status, _ string, _ *domain.VerifiedPayment, _ time.Time) error {
	s.marks = append(s.marks, status)
	return nil
}

type throttledChain struct{ calls int }

func (c *throttledChain) Inspect(context.Context, string, string) (nimiq.ChainEvidence, error) {
	c.calls++
	return nimiq.ChainEvidence{}, nimiq.ErrRPCRateLimited
}

// Nimpass exceeding a shared gateway's budget is not a fact about the payment,
// and must not be written down as one.
//
// The coupling this guards is indirect enough to have survived a long time. A
// throttled look used to be recorded as UNCERTAIN, which is the one candidate
// status that increments `retry_count`, which under ADR-019 pushes the next
// look out 30 s, 60 s … 8 min. So the busier the reconciler got, the longer a
// customer whose payment was already on chain watched a spinner — the system
// slowed down precisely when it was trying hardest (ADR-022).
//
// Writing nothing keeps the candidate immediately due, and the retry is free:
// the adapter refuses a call it knows the window cannot serve without sending
// it.
func TestVerificationRecordsNothingWhenThrottled(t *testing.T) {
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	submitted := now.Add(-time.Minute)
	store := &throttleStore{record: PurchaseRecord{
		Purchase: domain.Purchase{
			ID:        domain.ID("11111111-1111-4111-8111-111111111111"),
			Status:    domain.PurchaseAwaitingFinality,
			CreatedAt: now.Add(-2 * time.Minute),
			ExpiresAt: now.Add(28 * time.Minute),
			Snapshot:  domain.PurchaseSnapshot{Network: domain.NimiqTestnet},
		},
		CandidateHash:   "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		CandidateStatus: "AWAITING_FINALITY",
		SubmittedAt:     &submitted,
	}}
	chain := &throttledChain{}
	payments := Payments{
		Store:   store,
		Chain:   chain,
		Network: domain.NimiqTestnet,
		Now:     func() time.Time { return now },
	}

	got, err := payments.Reconcile(context.Background(), Identity{ID: domain.ID("22222222-2222-4222-8222-222222222222")}, store.record.Purchase.ID)
	if err != nil {
		t.Fatalf("a throttled look must not fail the purchase: %v", err)
	}
	if chain.calls != 1 {
		t.Fatalf("expected one inspect attempt, got %d", chain.calls)
	}
	if len(store.marks) != 0 {
		t.Fatalf("a throttled look wrote %v; it must write nothing", store.marks)
	}
	// The purchase comes back exactly as it was — still settling, still due.
	if got.Purchase.Status != domain.PurchaseAwaitingFinality || got.CandidateStatus != "AWAITING_FINALITY" {
		t.Fatalf("throttling changed the purchase: %+v", got)
	}
}
