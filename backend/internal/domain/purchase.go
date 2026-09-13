package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type NimiqNetwork string

const (
	NimiqTestnet NimiqNetwork = "TESTNET"
	NimiqMainnet NimiqNetwork = "MAINNET"
)

type PurchaseStatus string

const (
	PurchaseIntentTTL       = 30 * time.Minute
	PurchaseSettlementGrace = 5 * time.Minute
	PurchaseCutoffBuffer    = PurchaseIntentTTL + PurchaseSettlementGrace
)

var ErrPurchaseCutoff = errors.New("fixed-expiration package purchase cutoff reached")

const (
	PurchaseCreated              PurchaseStatus = "CREATED"
	PurchasePaymentPending       PurchaseStatus = "PAYMENT_PENDING"
	PurchaseTransactionSubmitted PurchaseStatus = "TRANSACTION_SUBMITTED"
	PurchaseVerifying            PurchaseStatus = "VERIFYING"
	PurchaseAwaitingFinality     PurchaseStatus = "AWAITING_FINALITY"
	PurchaseConfirmed            PurchaseStatus = "CONFIRMED"
	PurchaseCompensationRequired PurchaseStatus = "COMPENSATION_REQUIRED"
	PurchaseFailed               PurchaseStatus = "FAILED"
	PurchaseCancelled            PurchaseStatus = "CANCELLED"
	PurchaseExpired              PurchaseStatus = "EXPIRED"
)

type PurchaseSnapshot struct {
	PackageID    ID
	ProviderID   ID
	ServiceID    ID
	PackageTitle string
	ServiceName  string
	ProviderName string
	Sessions     SessionCount
	PriceLuna    Luna
	Recipient    WalletAddress
	Network      NimiqNetwork
	Expiration   ExpirationPolicy
}

func (s PurchaseSnapshot) clone() PurchaseSnapshot {
	s.Expiration = NewExpirationPolicy(s.Expiration.ExpiresAt)
	return s
}

type Purchase struct {
	ID                ID
	CustomerContextID ID
	ExpectedWallet    WalletAddress
	Snapshot          PurchaseSnapshot
	PaymentReference  PaymentReference
	Status            PurchaseStatus
	TransactionHash   string
	VerifiedSender    WalletAddress
	CreatedAt         time.Time
	ExpiresAt         time.Time
	ConfirmedAt       *time.Time
}

// NewPurchase captures trusted package and payout data. The application layer
// must load them from authorized repositories, never from client price fields.
func NewPurchase(id, customerContextID ID, expectedWallet WalletAddress, pkg Package, service Service, provider Provider, network NimiqNetwork, reference PaymentReference, now time.Time) (Purchase, error) {
	for _, value := range []ID{id, customerContextID} {
		if _, err := ParseID(string(value)); err != nil {
			return Purchase{}, err
		}
	}
	if pkg.ProviderID != provider.ID || pkg.ServiceID != service.ID || service.ProviderID != provider.ID {
		return Purchase{}, errors.New("package, service and provider do not match")
	}
	if !pkg.CanPurchase(now) || pkg.PriceLuna > MaxSafeLuna || !provider.CanReceivePayments() {
		return Purchase{}, errors.New("package or verified provider payout is unavailable")
	}
	if pkg.Expiration.ExpiresAt != nil && !now.Before(pkg.Expiration.ExpiresAt.Add(-PurchaseCutoffBuffer)) {
		return Purchase{}, ErrPurchaseCutoff
	}
	if network != NimiqMainnet && network != NimiqTestnet {
		return Purchase{}, errors.New("unsupported Nimiq network")
	}
	if _, err := ParsePaymentReference(string(reference)); err != nil {
		return Purchase{}, err
	}
	if expectedWallet != "" {
		normalized, err := NewWalletAddress(string(expectedWallet))
		if err != nil {
			return Purchase{}, err
		}
		expectedWallet = normalized
	}
	recipient, err := NewWalletAddress(string(provider.PayoutWallet))
	if err != nil {
		return Purchase{}, err
	}
	snapshot := PurchaseSnapshot{
		PackageID: pkg.ID, ProviderID: provider.ID, ServiceID: service.ID,
		PackageTitle: pkg.Title, ServiceName: service.Name, ProviderName: provider.Name,
		Sessions: pkg.Sessions, PriceLuna: pkg.PriceLuna, Recipient: recipient,
		Network: network, Expiration: NewExpirationPolicy(pkg.Expiration.ExpiresAt),
	}
	return Purchase{
		ID: id, CustomerContextID: customerContextID, ExpectedWallet: expectedWallet,
		Snapshot: snapshot, PaymentReference: reference, Status: PurchaseCreated,
		CreatedAt: now.UTC(), ExpiresAt: now.UTC().Add(PurchaseIntentTTL),
	}, nil
}

func (p *Purchase) AwaitPayment(now time.Time) error {
	return p.transition(PurchasePaymentPending, now)
}

func (p *Purchase) RecordSubmission(txHash string, now time.Time) error {
	if p.Status != PurchasePaymentPending || !now.Before(p.ExpiresAt) {
		return errors.New("purchase cannot accept a transaction submission")
	}
	if len(txHash) != 64 {
		return errors.New("invalid transaction hash")
	}
	for _, c := range txHash {
		if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return errors.New("invalid transaction hash")
		}
	}
	p.TransactionHash = strings.ToLower(txHash)
	return p.transition(PurchaseTransactionSubmitted, now)
}

func (p *Purchase) BeginVerification(now time.Time) error {
	return p.transition(PurchaseVerifying, now)
}

// VerifiedPayment is populated only from server-side Nimiq chain evidence.
// There is no HTTP endpoint that can mark a purchase confirmed directly.
type VerifiedPayment struct {
	Hash           string
	Sender         WalletAddress
	Recipient      WalletAddress
	AmountLuna     Luna
	Reference      PaymentReference
	Network        NimiqNetwork
	Included       bool
	IncludedAt     time.Time
	Finalized      bool
	FinalityBlock  uint32
	InclusionBlock uint32
}

func (p *Purchase) ConfirmVerified(payment VerifiedPayment, now time.Time) error {
	if p.Status != PurchaseVerifying {
		return errors.New("purchase is not verifying")
	}
	if err := p.validateVerifiedPayment(payment, now); err != nil {
		return err
	}
	if _, err := p.Snapshot.Expiration.Resolve(now); err != nil {
		return err
	}
	if err := p.transition(PurchaseConfirmed, now); err != nil {
		return err
	}
	p.storeConfirmation(payment, now)
	return nil
}

// ReconcileVerified permits recovery of an expired intent only when a server
// blockchain verifier supplies matching, finalized transaction evidence within
// the bounded settlement window. It never authorizes a new wallet submission.
func (p *Purchase) ReconcileVerified(payment VerifiedPayment, now time.Time) error {
	if p.Status != PurchaseExpired && p.Status != PurchasePaymentPending &&
		p.Status != PurchaseTransactionSubmitted && p.Status != PurchaseVerifying && p.Status != PurchaseAwaitingFinality {
		return errors.New("purchase cannot be reconciled from current state")
	}
	if err := p.validateVerifiedPayment(payment, now); err != nil {
		return err
	}
	if _, err := p.Snapshot.Expiration.Resolve(now); err != nil {
		return err
	}
	p.Status = PurchaseConfirmed
	p.storeConfirmation(payment, now)
	return nil
}

// ReconcileCompensationRequired records a real finalized payment that cannot
// provision the fixed-expiration pass. It does not authorize a second payment.
func (p *Purchase) ReconcileCompensationRequired(payment VerifiedPayment, now time.Time) error {
	if p.Status != PurchaseExpired && p.Status != PurchasePaymentPending &&
		p.Status != PurchaseTransactionSubmitted && p.Status != PurchaseVerifying && p.Status != PurchaseAwaitingFinality {
		return errors.New("purchase cannot be reconciled from current state")
	}
	if p.Snapshot.Expiration.ExpiresAt == nil || now.Before(*p.Snapshot.Expiration.ExpiresAt) {
		return errors.New("compensation requires an expired fixed package")
	}
	if err := p.validateVerifiedPayment(payment, now); err != nil {
		return err
	}
	p.Status = PurchaseCompensationRequired
	p.storeConfirmation(payment, now)
	return nil
}

func (p *Purchase) validateVerifiedPayment(payment VerifiedPayment, now time.Time) error {
	if now.IsZero() || now.Before(p.CreatedAt) || !payment.Included || !payment.Finalized || payment.FinalityBlock <= payment.InclusionBlock || payment.IncludedAt.IsZero() || payment.IncludedAt.After(now) ||
		payment.IncludedAt.Before(p.CreatedAt) || payment.IncludedAt.After(p.ExpiresAt.Add(PurchaseSettlementGrace)) ||
		len(payment.Hash) != 64 || (p.TransactionHash != "" && payment.Hash != p.TransactionHash) || payment.Sender == "" ||
		payment.Recipient != p.Snapshot.Recipient || payment.AmountLuna != p.Snapshot.PriceLuna ||
		payment.Reference != p.PaymentReference || payment.Network != p.Snapshot.Network {
		return errors.New("verified transaction does not match purchase intent")
	}
	for _, c := range payment.Hash {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return errors.New("verified transaction hash is not canonical lowercase hex")
		}
	}
	if p.ExpectedWallet != "" && payment.Sender != p.ExpectedWallet {
		return errors.New("transaction sender differs from expected wallet")
	}
	return nil
}

func (p *Purchase) storeConfirmation(payment VerifiedPayment, now time.Time) {
	p.TransactionHash = payment.Hash
	p.VerifiedSender = payment.Sender
	confirmed := now.UTC()
	p.ConfirmedAt = &confirmed
}

func (p *Purchase) Fail(now time.Time) error   { return p.transition(PurchaseFailed, now) }
func (p *Purchase) Cancel(now time.Time) error { return p.transition(PurchaseCancelled, now) }
func (p *Purchase) Expire(now time.Time) error { return p.transition(PurchaseExpired, now) }

func (p *Purchase) transition(next PurchaseStatus, now time.Time) error {
	if now.IsZero() || now.Before(p.CreatedAt) {
		return errors.New("invalid transition time")
	}
	allowed := map[PurchaseStatus]map[PurchaseStatus]bool{
		PurchaseCreated:              {PurchasePaymentPending: true, PurchaseCancelled: true, PurchaseExpired: true},
		PurchasePaymentPending:       {PurchaseTransactionSubmitted: true, PurchaseCancelled: true, PurchaseExpired: true},
		PurchaseTransactionSubmitted: {PurchaseVerifying: true, PurchaseFailed: true},
		PurchaseVerifying:            {PurchaseConfirmed: true, PurchaseAwaitingFinality: true, PurchaseFailed: true},
		PurchaseAwaitingFinality:     {PurchaseConfirmed: true, PurchaseFailed: true},
	}
	if !allowed[p.Status][next] {
		return fmt.Errorf("invalid purchase transition %s -> %s", p.Status, next)
	}
	if next == PurchaseExpired && now.Before(p.ExpiresAt) {
		return errors.New("purchase intent has not expired")
	}
	if (next == PurchasePaymentPending || next == PurchaseTransactionSubmitted) && !now.Before(p.ExpiresAt) {
		return errors.New("purchase intent has expired")
	}
	p.Status = next
	return nil
}
