package application

import (
	"bytes"
	"context"
	"errors"
	"math"
	"strings"
	"sync"
	"time"

	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

type PurchaseRecord struct {
	Purchase            domain.Purchase
	CandidateHash       string
	SubmittedAt         *time.Time
	BroadcastObservedAt *time.Time
	CandidateStatus     string
	FailureCategory     string
	PassID              domain.ID
	CompensationStatus  string
	CompensationReason  string
	CompensationAt      *time.Time
}

type PaymentStore interface {
	Create(context.Context, domain.ID, domain.WalletAddress, domain.ID, domain.NimiqNetwork, string, time.Time) (PurchaseRecord, bool, error)
	Get(context.Context, domain.ID, domain.ID) (PurchaseRecord, error)
	List(context.Context, domain.ID) ([]PurchaseRecord, error)
	Submit(context.Context, domain.ID, domain.ID, string, time.Time) (PurchaseRecord, error)
	Mark(context.Context, domain.ID, domain.ID, string, string, string, *domain.VerifiedPayment, time.Time) error
	Confirm(context.Context, domain.ID, domain.ID, domain.VerifiedPayment, time.Time, time.Time) (PurchaseRecord, error)
	Cancel(context.Context, domain.ID, domain.ID, time.Time) (PurchaseRecord, error)
	GetPass(context.Context, domain.ID, domain.ID) (domain.Pass, error)
	Due(context.Context, time.Time, int) ([]DuePurchase, error)
}

type DuePurchase struct {
	ID       domain.ID
	Customer Identity
}

type ChainInspector interface {
	Inspect(context.Context, string, string) (nimiq.ChainEvidence, error)
}

type Payments struct {
	Store   PaymentStore
	Chain   ChainInspector
	Network domain.NimiqNetwork
	Now     func() time.Time
}

func (s Payments) Create(ctx context.Context, identity Identity, packageID domain.ID, key string) (PurchaseRecord, bool, error) {
	return s.Store.Create(ctx, identity.ID, domain.WalletAddress(identity.Wallet), packageID, s.Network, key, s.Now().UTC())
}

func (s Payments) Submit(ctx context.Context, identity Identity, id domain.ID, hash string) (PurchaseRecord, error) {
	hash = strings.ToLower(hash)
	if len(hash) != 64 {
		return PurchaseRecord{}, ErrValidation
	}
	for _, c := range hash {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return PurchaseRecord{}, ErrValidation
		}
	}
	return s.Store.Submit(ctx, id, identity.ID, hash, s.Now().UTC())
}

func (s Payments) Reconcile(ctx context.Context, identity Identity, id domain.ID) (PurchaseRecord, error) {
	p, err := s.Store.Get(ctx, id, identity.ID)
	if err != nil {
		return p, err
	}
	if p.Purchase.Status == domain.PurchaseConfirmed || p.Purchase.Status == domain.PurchaseCompensationRequired || p.Purchase.Status == domain.PurchaseCancelled {
		return p, nil
	}
	if p.CandidateHash == "" {
		return p, nil
	}
	if p.CandidateStatus == "MISMATCH" {
		return p, nil
	}
	now := s.Now().UTC()
	evidence, err := s.Chain.Inspect(ctx, p.CandidateHash, string(p.Purchase.Snapshot.Network))
	if err != nil {
		status := "UNCERTAIN"
		if errors.Is(err, nimiq.ErrRPCNotFound) {
			status = "NOT_FOUND"
		}
		if markErr := s.Store.Mark(ctx, id, identity.ID, p.CandidateHash, status, "", nil, now); markErr != nil {
			return p, markErr
		}
		return s.Store.Get(ctx, id, identity.ID)
	}
	verified, category := validateEvidence(p, evidence, now)
	if category != "" {
		if err := s.Store.Mark(ctx, id, identity.ID, p.CandidateHash, "MISMATCH", category, nil, now); err != nil {
			return p, err
		}
		return s.Store.Get(ctx, id, identity.ID)
	}
	if evidence.Transaction.BlockNumber == nil {
		if err := s.Store.Mark(ctx, id, identity.ID, p.CandidateHash, "SUBMITTED", "", &verified, now); err != nil {
			return p, err
		}
		return s.Store.Get(ctx, id, identity.ID)
	}
	if !evidence.Finalized {
		if err := s.Store.Mark(ctx, id, identity.ID, p.CandidateHash, "AWAITING_FINALITY", "", &verified, now); err != nil {
			return p, err
		}
		return s.Store.Get(ctx, id, identity.ID)
	}
	return s.Store.Confirm(ctx, id, identity.ID, verified, evidence.FinalizedAt, now)
}

// ReconcileDue is safe to invoke on multiple replicas. Database row locks and
// unique verified-payment/pass constraints remain the business authority.
func (s Payments) ReconcileDue(ctx context.Context) error {
	due, err := s.Store.Due(ctx, s.Now().UTC(), 20)
	if err != nil {
		return err
	}
	var wg sync.WaitGroup
	var firstErr error
	var errMu sync.Mutex
	sem := make(chan struct{}, 4)
loop:
	for _, item := range due {
		select {
		case <-ctx.Done():
			break loop
		case sem <- struct{}{}:
		}
		wg.Add(1)
		go func(item DuePurchase) {
			defer wg.Done()
			defer func() { <-sem }()
			checkCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
			defer cancel()
			if _, err := s.Reconcile(checkCtx, item.Customer, item.ID); err != nil {
				errMu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				errMu.Unlock()
			}
		}(item)
	}
	wg.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return firstErr
}

func validateEvidence(p PurchaseRecord, e nimiq.ChainEvidence, now time.Time) (domain.VerifiedPayment, string) {
	tx := e.Transaction
	if !strings.EqualFold(tx.Hash, p.CandidateHash) {
		return domain.VerifiedPayment{}, "HASH"
	}
	_, expectedID, _ := nimiq.ExpectedNetworkID(string(p.Purchase.Snapshot.Network))
	if tx.NetworkID == nil || *tx.NetworkID != expectedID {
		return domain.VerifiedPayment{}, "NETWORK"
	}
	if (e.InclusionBlock > 0 && (tx.ExecutionResult == nil || !*tx.ExecutionResult)) || tx.FromType == nil || *tx.FromType != 0 || tx.ToType == nil || *tx.ToType != 0 || tx.Flags == nil || *tx.Flags != 0 || tx.Proof == "" {
		return domain.VerifiedPayment{}, "EXECUTION"
	}
	sender, err := nimiq.ValidateAddress(tx.From)
	if err != nil || sender != string(p.Purchase.ExpectedWallet) {
		return domain.VerifiedPayment{}, "SENDER"
	}
	recipient, err := nimiq.ValidateAddress(tx.To)
	if err != nil || recipient != string(p.Purchase.Snapshot.Recipient) {
		return domain.VerifiedPayment{}, "RECIPIENT"
	}
	if tx.Value == nil || *tx.Value > math.MaxInt64 || int64(*tx.Value) != int64(p.Purchase.Snapshot.PriceLuna) {
		return domain.VerifiedPayment{}, "AMOUNT"
	}
	data, err := nimiq.DecodeRecipientData(tx.RecipientData)
	if err != nil || !bytes.Equal(data, []byte(p.Purchase.PaymentReference)) {
		return domain.VerifiedPayment{}, "DATA"
	}
	if p.SubmittedAt == nil || !p.SubmittedAt.Before(p.Purchase.ExpiresAt) {
		return domain.VerifiedPayment{}, "TIMING"
	}
	verified := domain.VerifiedPayment{Hash: p.CandidateHash, Sender: domain.WalletAddress(sender), Recipient: domain.WalletAddress(recipient), AmountLuna: domain.Luna(*tx.Value), Reference: p.Purchase.PaymentReference, Network: p.Purchase.Snapshot.Network, Included: e.InclusionBlock > 0, IncludedAt: e.IncludedAt, InclusionBlock: e.InclusionBlock, FinalityBlock: e.FinalityBlock, Finalized: e.Finalized}
	if e.InclusionBlock > 0 && (e.IncludedAt.Before(p.Purchase.CreatedAt) || e.IncludedAt.After(p.Purchase.ExpiresAt.Add(5*time.Minute)) || e.IncludedAt.After(now) || (e.IncludedAt.After(p.Purchase.ExpiresAt) && (p.BroadcastObservedAt == nil || !p.BroadcastObservedAt.Before(p.Purchase.ExpiresAt)))) {
		return domain.VerifiedPayment{}, "TIMING"
	}
	return verified, ""
}
