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

var ErrPurchaseCutoff = errors.New("fixed-expiration pass purchase cutoff reached")

// ErrSelfPurchase refuses an intent whose buyer and payee are the same wallet.
//
// ADR-012 stated the rule as "a provider cannot buy from their own catalogue"
// and decided it against `providers.owner_identity_id`. That is the account
// question, and it stays where it is. This is the *wallet* question, which the
// account check cannot answer: a payout wallet may be an address other than the
// owner's login address (migration 000018 keeps the VERIFY_PROVIDER_WALLET
// ceremony for exactly that), so a buyer whose own address is the payee passes
// the account check and would then pay themselves — a transaction that moves
// no value but settles a Pass.
//
// Restated here as a domain invariant for the same reason ADR-012 restated the
// account rule in NewPurchasedPass: an intent in which the money would go back
// where it came from cannot be constructed, whatever the caller believes.
var ErrSelfPurchase = errors.New("the payout wallet is the buying wallet")

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
	PassID       ID
	ProviderID   ID
	ServiceID    ID
	PassTitle    string
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

// NewPurchase captures trusted pass and payout data. The application layer
// must load them from authorized repositories, never from client price fields.
func NewPurchase(id, customerContextID ID, expectedWallet WalletAddress, listing Pass, service Service, provider Provider, network NimiqNetwork, reference PaymentReference, now time.Time) (Purchase, error) {
	for _, value := range []ID{id, customerContextID} {
		if _, err := ParseID(string(value)); err != nil {
			return Purchase{}, err
		}
	}
	if listing.ProviderID != provider.ID || listing.ServiceID != service.ID || service.ProviderID != provider.ID {
		return Purchase{}, errors.New("pass, service and provider do not match")
	}
	if !listing.CanPurchase(now) || listing.PriceLuna > MaxSafeLuna || !provider.CanReceivePayments() {
		return Purchase{}, errors.New("pass or verified provider payout is unavailable")
	}
	if listing.Expiration.ExpiresAt != nil && !now.Before(listing.Expiration.ExpiresAt.Add(-PurchaseCutoffBuffer)) {
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
	// Both addresses are normalized by now, so this compares two canonical
	// forms rather than two spellings of one address.
	if expectedWallet != "" && expectedWallet == recipient {
		return Purchase{}, ErrSelfPurchase
	}
	snapshot := PurchaseSnapshot{
		PassID: listing.ID, ProviderID: provider.ID, ServiceID: service.ID,
		PassTitle: listing.Title, ServiceName: service.Name, ProviderName: provider.Name,
		Sessions: listing.Sessions, PriceLuna: listing.PriceLuna, Recipient: recipient,
		Network: network, Expiration: NewExpirationPolicy(listing.Expiration.ExpiresAt),
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
	Hash       string
	Sender     WalletAddress
	Recipient  WalletAddress
	AmountLuna Luna
	Reference  PaymentReference
	Network    NimiqNetwork
	// ReferenceOnChain is true when the transaction itself carried this
	// intent's payment reference in its data field.
	//
	// It is what lets a payment approved from a different account in the
	// customer's wallet still settle. The reference is 16 random bytes the
	// server generated for this one intent and told nobody else; a
	// transaction carrying it was made by somebody holding this intent's
	// payment instruction. That is a stronger binding than the sender
	// address, which Nimiq Pay chooses at approval time and which the
	// provider API gives the mini app no way to pin.
	//
	// When it is false the correlation falls back to the sender, and the
	// sender rule is enforced exactly as before — recipient and amount alone
	// would match any stranger's payment to the same provider.
	ReferenceOnChain bool
	Included         bool
	IncludedAt       time.Time
	InclusionBlock   uint32
	// Finalized is true only once the macro block covering InclusionBlock has
	// been produced *and* the inclusion block was re-read and still matched.
	Finalized bool
	// FinalityBlock is the macro block that finalises this inclusion.
	//
	// It is reported before that block exists, because knowing *which* height
	// to wait for is what lets the finality worker ask one cheap question
	// ("has the chain passed it?") instead of re-running the whole
	// verification pipeline to be told no. It is therefore a prediction until
	// `Finalized` is true, and `IsFinalized` is what distinguishes the two —
	// no caller may read a height as a settlement.
	FinalityBlock uint32
	// FinalizedAt is the macro block's own timestamp, zero until finality.
	FinalizedAt time.Time
}

func (p *Purchase) ConfirmVerified(payment VerifiedPayment, policy ConfirmationPolicy, now time.Time) error {
	if p.Status != PurchaseVerifying {
		return errors.New("purchase is not verifying")
	}
	if err := p.validateVerifiedPayment(payment, policy, now); err != nil {
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
// blockchain verifier supplies matching transaction evidence that satisfies the
// configured confirmation policy, within the bounded settlement window. It
// never authorizes a new wallet submission.
func (p *Purchase) ReconcileVerified(payment VerifiedPayment, policy ConfirmationPolicy, now time.Time) error {
	if p.Status != PurchaseExpired && p.Status != PurchasePaymentPending &&
		p.Status != PurchaseTransactionSubmitted && p.Status != PurchaseVerifying && p.Status != PurchaseAwaitingFinality {
		return errors.New("purchase cannot be reconciled from current state")
	}
	if err := p.validateVerifiedPayment(payment, policy, now); err != nil {
		return err
	}
	if _, err := p.Snapshot.Expiration.Resolve(now); err != nil {
		return err
	}
	p.Status = PurchaseConfirmed
	p.storeConfirmation(payment, now)
	return nil
}

// ReconcileCompensationRequired records a real payment that cannot provision
// the fixed-expiration pass. It does not authorize a second payment.
func (p *Purchase) ReconcileCompensationRequired(payment VerifiedPayment, policy ConfirmationPolicy, now time.Time) error {
	if p.Status != PurchaseExpired && p.Status != PurchasePaymentPending &&
		p.Status != PurchaseTransactionSubmitted && p.Status != PurchaseVerifying && p.Status != PurchaseAwaitingFinality {
		return errors.New("purchase cannot be reconciled from current state")
	}
	if p.Snapshot.Expiration.ExpiresAt == nil || now.Before(*p.Snapshot.Expiration.ExpiresAt) {
		return errors.New("compensation requires an expired fixed pass")
	}
	if err := p.validateVerifiedPayment(payment, policy, now); err != nil {
		return err
	}
	p.Status = PurchaseCompensationRequired
	p.storeConfirmation(payment, now)
	return nil
}

// ReverseSettlement records that a purchase's accepted payment stopped being
// part of the canonical chain.
//
// The exceptional state Case C of the reorg model needs, and the reason it is
// a transition rather than a deletion: the purchase keeps its receipt, its
// transaction hash and its confirmation time, because those are the evidence
// of what was accepted and on what basis. What changes is that the purchase
// stops claiming to be a completed sale and becomes a recovery case.
//
// Only a confirmed purchase can be reversed. An unconfirmed one has no
// provisional receipt to lose, and a purchase already in compensation is
// already the thing this produces.
func (p *Purchase) ReverseSettlement(now time.Time) error {
	if p.Status != PurchaseConfirmed {
		return errors.New("only a confirmed purchase can have its settlement reversed")
	}
	if p.ConfirmedAt == nil || p.TransactionHash == "" {
		return errors.New("a confirmed purchase must carry its receipt")
	}
	if now.IsZero() || now.Before(*p.ConfirmedAt) {
		return errors.New("invalid reversal time")
	}
	p.Status = PurchaseCompensationRequired
	return nil
}

// validateVerifiedPayment is the domain's own restatement of every economic
// condition a settlement rests on, applied to the evidence a verifier produced.
//
// It is the second of two independent checks. `application.validateEvidence`
// reads the chain's answer and decides whether it matches this intent; this
// re-derives the same conclusions from the resulting receipt, so a bug or an
// edit on the application side cannot settle a purchase the domain would
// refuse. Nothing here trusts a caller's word for anything.
//
// The policy parameter changes exactly one of these conditions: how much chain
// certainty the payment needs. It cannot relax any other clause, and
// `Satisfies` refuses an unrecognised policy outright, so forgetting to pass
// one settles nothing rather than settling everything.
//
// What it no longer does is require `payment.Finalized` unconditionally. That
// single clause was the macro-block wait: it meant a payment which was
// canonically included and correct in every economic respect could not be
// written down at all until the batch closed, which is why the customer stood
// on a spinner for up to a minute. Inclusion is still mandatory — a mempool
// transaction has `Included` false and fails here as it always did.
func (p *Purchase) validateVerifiedPayment(payment VerifiedPayment, policy ConfirmationPolicy, now time.Time) error {
	if now.IsZero() || now.Before(p.CreatedAt) || !payment.IsIncluded() || !payment.Satisfies(policy) ||
		payment.IncludedAt.After(now) ||
		payment.IncludedAt.Before(p.CreatedAt) || payment.IncludedAt.After(p.ExpiresAt.Add(PurchaseSettlementGrace)) ||
		len(payment.Hash) != 64 || (p.TransactionHash != "" && payment.Hash != p.TransactionHash) || payment.Sender == "" ||
		payment.Recipient != p.Snapshot.Recipient || payment.AmountLuna != p.Snapshot.PriceLuna ||
		payment.Reference != p.PaymentReference || payment.Network != p.Snapshot.Network {
		return errors.New("verified transaction does not match purchase intent")
	}
	// Note what is *not* checked here: that `FinalizedAt` precedes the server
	// clock. Block timestamps come from validators and can sit a little ahead
	// of ours, and refusing a settled payment over a few hundred milliseconds
	// of clock skew would fail a purchase whose money has already moved. The
	// consistency that does matter is clock-free and lives in `IsFinalized`:
	// the macro block must be above the inclusion block and cannot have been
	// produced before it.
	for _, c := range payment.Hash {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return errors.New("verified transaction hash is not canonical lowercase hex")
		}
	}
	// The sender gate, and the one case that lifts it.
	//
	// Without the reference on chain, this is the only thing separating the
	// customer's payment from anyone else's transfer of the same amount to
	// the same provider, so it stays mandatory.
	//
	// With the reference on chain it is redundant *for correlation* and
	// actively harmful in practice: Nimiq Pay pays from whichever account the
	// user approves, so a customer with two accounts could pay correctly and
	// never be matched. The sender is still recorded — `VerifiedSender` keeps
	// it as an audit fact — it just no longer decides whether the payment
	// belongs to this purchase. Who *owns* the resulting pass is a separate
	// question, and it is answered by the authenticated buyer, never by the
	// paying address.
	if !payment.ReferenceOnChain && p.ExpectedWallet != "" && payment.Sender != p.ExpectedWallet {
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
		// A confirmed purchase is normally terminal. The one thing that can
		// still move it is the discovery that its provisionally settled
		// payment never became canonical, and that is `ReverseSettlement`'s
		// job — it is not reachable through `transition`, because every other
		// caller of this map would then be one typo away from withdrawing a
		// paid Pass.
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
