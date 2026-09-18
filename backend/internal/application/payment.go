package application

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

type PurchaseRecord struct {
	WalletAttemptPending bool
	Purchase             domain.Purchase
	CandidateHash        string
	SubmittedAt          *time.Time
	BroadcastObservedAt  *time.Time
	CandidateStatus      string
	FailureCategory      string
	PassID               domain.ID
	CompensationStatus   string
	CompensationReason   string
	CompensationAt       *time.Time
	// Settlement is the receipt's own state, present once a payment has been
	// accepted. Nil before that.
	//
	// It is deliberately separate from `Purchase.Status`. The purchase answers
	// "did this customer buy the thing?" and the settlement answers "how
	// permanent is the payment behind it?", and under the inclusion policy
	// those two have different answers for up to a batch. Merging them is what
	// made the customer wait for the macro block.
	Settlement *Settlement
}

// Settlement is the stored state of one accepted payment.
type Settlement struct {
	Status         domain.SettlementStatus
	Hash           string
	InclusionBlock uint32
	IncludedAt     time.Time
	// ExpectedFinalityBlock is the macro block this inclusion is waiting for.
	// Known from acceptance; never a claim that it has been produced.
	ExpectedFinalityBlock uint32
	// FinalityBlock and FinalizedAt are set only in FINALIZED.
	FinalityBlock uint32
	FinalizedAt   *time.Time
	// ContestedAt and ContestReason are set only in CONTESTED.
	ContestedAt   *time.Time
	ContestReason string
}

// Provisional reports whether the payment is accepted but not yet irreversible.
func (s *Settlement) Provisional() bool {
	return s != nil && s.Status == domain.SettlementIncluded
}

type PaymentStore interface {
	BeginWalletAttempt(context.Context, domain.ID, domain.ID, domain.ID, time.Time) (PurchaseRecord, error)
	ReleaseWalletAttempt(context.Context, domain.ID, domain.ID, domain.ID) error
	Create(context.Context, domain.ID, domain.WalletAddress, domain.ID, domain.NimiqNetwork, string, time.Time) (PurchaseRecord, bool, error)
	Get(context.Context, domain.ID, domain.ID) (PurchaseRecord, error)
	List(context.Context, domain.ID) ([]PurchaseRecord, error)
	Submit(context.Context, domain.ID, domain.ID, string, time.Time) (PurchaseRecord, error)
	Mark(context.Context, domain.ID, domain.ID, string, string, string, *domain.VerifiedPayment, time.Time) error
	Confirm(context.Context, domain.ID, domain.ID, domain.VerifiedPayment, domain.ConfirmationPolicy, time.Time) (PurchaseRecord, error)
	Cancel(context.Context, domain.ID, domain.ID, time.Time) (PurchaseRecord, error)
	GetPass(context.Context, domain.ID, domain.ID) (domain.PurchasedPass, error)
	ListPasses(context.Context, domain.ID, PurchasedPassFilter) (PurchasedPassPage, error)
	Due(context.Context, time.Time, int) ([]DuePurchase, error)
	DueDiscoveryAddresses(context.Context, time.Time, int) ([]DiscoveryAddress, error)
	NoteDiscoveryScan(context.Context, domain.WalletAddress, domain.NimiqNetwork, string, time.Time) error
	NoteDiscoveryFailure(context.Context, domain.WalletAddress, domain.NimiqNetwork, time.Time) error
	HasLiveIntents(context.Context, time.Time) (bool, error)
	Discover(context.Context, domain.ID, domain.ID, string, time.Time) (PurchaseRecord, error)
	DueSettlements(context.Context, time.Time, int) ([]DueSettlement, error)
	NoteSettlementCheck(context.Context, string, time.Time) error
	NoteSettlementFailure(context.Context, string, time.Time) error
	FinalizeSettlement(context.Context, DueSettlement, domain.VerifiedPayment, time.Time) error
	ReanchorSettlement(context.Context, DueSettlement, domain.VerifiedPayment, time.Time) error
	ReverseSettlement(context.Context, DueSettlement, string, time.Time) error
}

type DuePurchase struct {
	ID       domain.ID
	Customer Identity
}

// DueSettlement is one provisionally settled payment whose finality is still
// being tracked, with everything needed to decide its next state.
//
// The stored receipt travels whole rather than as a hash, because promotion
// and re-anchoring are both comparisons against what was originally accepted:
// same transaction, same provider, same Luna, same reference, same network,
// and — for a promotion — the same inclusion block. A worker holding only the
// hash would have to trust the fresh chain read about all of it.
type DueSettlement struct {
	PurchaseID domain.ID
	Customer   Identity
	Network    domain.NimiqNetwork
	// Receipt is the accepted evidence as stored, never a fresh read.
	Receipt domain.VerifiedPayment
	// ExpectedFinalityBlock is the macro height that would finalise it.
	ExpectedFinalityBlock uint32
	// Attempts counts consecutive answers the node could not give. It never
	// counts a macro block that has simply not happened yet.
	Attempts int
}

// PendingIntent names one live purchase and the customer it belongs to.
type PendingIntent struct {
	PurchaseID domain.ID
	Customer   Identity
}

// DiscoveryAddress is one provider payout address with live intents waiting on
// it, and the cursor marking how far the chain has already been read.
//
// The unit of discovery is the address rather than the purchase: every intent
// in `Purchases` is waiting on the same list of transactions, so they are
// fetched once and matched many times.
type DiscoveryAddress struct {
	Recipient domain.WalletAddress
	Network   domain.NimiqNetwork
	// Cursor is the newest transaction hash this address was known to have.
	// Empty on the first sweep.
	Cursor    string
	Purchases []PendingIntent
}

type ChainInspector interface {
	Inspect(context.Context, string, string) (nimiq.ChainEvidence, error)
}

// ChainDiscoverer finds transactions the application was never told about.
//
// Separate from ChainInspector because it answers a different question and
// carries a different weight: Inspect examines a hash somebody nominated,
// while this searches an address and nominates one. Nothing it returns is
// evidence — a discovered hash re-enters the ordinary Inspect path and is
// verified there exactly as a client-reported hash is.
type ChainDiscoverer interface {
	TransactionsByAddress(context.Context, string, string) ([]nimiq.ChainTransaction, error)
}

// ChainHeadReader reports the current height of the proven network.
//
// Separate from ChainInspector because it carries no evidence at all: a height
// can decide whether asking a real question is worth a request, and it can
// establish that time has passed on chain, but it can never settle or unsettle
// a payment on its own.
type ChainHeadReader interface {
	Head(context.Context, string) (nimiq.ChainHead, error)
}

type Payments struct {
	Store PaymentStore
	Chain ChainInspector
	// Discovery is optional. Where it is nil — a deployment without an
	// address-indexing (history) node — the mini-app checkout is unaffected and
	// the QR checkout simply has no server-side settlement path, which is a
	// missing feature rather than an unsafe one.
	Discovery ChainDiscoverer
	// Head reads the chain height. Optional and nil-safe.
	//
	// The finality worker uses it for two things it cannot do otherwise:
	// skipping a receipt whose macro block demonstrably has not been produced
	// yet (one cached read for a whole sweep, instead of a full verification
	// per receipt), and establishing that the chain has moved *past* that
	// height before a missing transaction may be treated as gone rather than
	// as not-found-yet. Without it, promotion still works and a transaction is
	// never contested — the conservative direction.
	Head    ChainHeadReader
	Network domain.NimiqNetwork
	// Confirmation is the settlement rule this deployment runs under.
	//
	// Set from NIMIQ_CONFIRMATION_POLICY, which refuses anything that is not
	// one of the two documented values. An unset value here is read as
	// `finality` by `policy()` — the slower, stricter of the two — so a
	// programming omission can only ever make settlement more cautious.
	Confirmation domain.ConfirmationPolicy
	Now          func() time.Time
	// Log records how long each leg of a settlement took. Optional and
	// nil-safe: a deployment without one behaves exactly as before.
	//
	// It exists because "the purchase sat on a spinner for a minute" was, for a
	// long time, impossible to attribute from the outside — the purchase_events
	// table says which transitions happened but a reader has to reconstruct the
	// gaps by hand, and the gap that mattered was between the reconciler
	// deciding a purchase was not due yet and the next time it looked. Every
	// line below carries the elapsed time from intent creation, so a slow
	// settlement names its own slow leg. No wallet address, hash-derived secret
	// or session value is logged (docs/09-SECURITY.md §88).
	Log *slog.Logger
}

// note records one settlement milestone with the age of the intent behind it.
func (s Payments) note(p domain.Purchase, event string, attrs ...any) {
	if s.Log == nil {
		return
	}
	s.Log.Info("payment "+event,
		append([]any{
			"purchase_id", string(p.ID),
			"purchase_status", string(p.Status),
			"intent_age_ms", s.Now().UTC().Sub(p.CreatedAt).Milliseconds(),
		}, attrs...)...)
}

func (s Payments) Create(ctx context.Context, identity Identity, passID domain.ID, key string) (PurchaseRecord, bool, error) {
	return s.Store.Create(ctx, identity.ID, domain.WalletAddress(identity.Wallet), passID, s.Network, key, s.Now().UTC())
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
	if p.Purchase.Snapshot.Network != s.Network {
		return p, ErrConflict
	}
	now := s.Now().UTC()
	inspectStarted := time.Now()
	evidence, err := s.Chain.Inspect(ctx, p.CandidateHash, string(p.Purchase.Snapshot.Network))
	s.note(p.Purchase, "inspected", "rpc_ms", time.Since(inspectStarted).Milliseconds(), "rpc_error", err != nil)
	if errors.Is(err, nimiq.ErrRPCRateLimited) {
		// We did not look. Nothing is recorded — not even the check time —
		// because every field this would touch is an assertion about the
		// payment and we learned nothing about the payment.
		//
		// The distinction is worth a branch of its own because of what the
		// alternative costs. A throttle used to land in UNCERTAIN below, which
		// is the one status that increments `retry_count`, which pushes the
		// next look out 30 s, 60 s … 8 min (ADR-019). Nimpass exceeding a
		// shared gateway's budget was therefore paid for in half-minute steps
		// of spinner, on a payment that was already on chain — the system got
		// slower the harder it tried (ADR-022).
		//
		// Leaving the row untouched keeps the candidate immediately due, and
		// retrying costs nothing: the adapter refuses a call it knows the
		// window cannot serve without sending it.
		s.note(p.Purchase, "throttled")
		return p, nil
	}
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
		s.note(p.Purchase, "mismatch", "category", category)
		if err := s.Store.Mark(ctx, id, identity.ID, p.CandidateHash, "MISMATCH", category, nil, now); err != nil {
			return p, err
		}
		return s.Store.Get(ctx, id, identity.ID)
	}
	// Mempool only. The transaction exists and every economic check above
	// passed, but no block contains it — so there is nothing to settle and the
	// UI may say no more than "payment detected". This boundary is the one
	// thing fast settlement does not move: inclusion remains mandatory under
	// both policies (docs/05 §47).
	if evidence.Transaction.BlockNumber == nil {
		if err := s.Store.Mark(ctx, id, identity.ID, p.CandidateHash, "SUBMITTED", "", &verified, now); err != nil {
			return p, err
		}
		return s.Store.Get(ctx, id, identity.ID)
	}
	// Included and fully validated. Whether that is enough is the one question
	// the confirmation policy answers, and it is asked here — once, explicitly,
	// against the evidence — rather than through a special case anywhere else.
	//
	// Under `inclusion` this is where the wait used to be and no longer is.
	// Under `finality` the branch below is the original behaviour, unchanged.
	if !verified.Satisfies(s.policy()) {
		s.note(p.Purchase, "awaiting finality",
			"inclusion_block", evidence.InclusionBlock,
			"finality_block", evidence.FinalityBlock)
		if err := s.Store.Mark(ctx, id, identity.ID, p.CandidateHash, "AWAITING_FINALITY", "", &verified, now); err != nil {
			return p, err
		}
		return s.Store.Get(ctx, id, identity.ID)
	}
	confirmed, err := s.Store.Confirm(ctx, id, identity.ID, verified, s.policy(), now)
	if err == nil {
		// The number that answers "why did that take so long?": wall-clock from
		// the customer pressing Buy to the Pass existing.
		s.note(p.Purchase, "settled",
			"submitted_to_settled_ms", submissionGap(p.SubmittedAt, now),
			"settlement", string(verified.Settlement()),
			"inclusion_block", verified.InclusionBlock,
			"finality_block", verified.FinalityBlock)
	}
	return confirmed, err
}

// policy is the settlement rule in force, with the conservative reading of an
// unset one.
//
// Configuration validates the value and refuses anything but the two
// documented policies, so in a running deployment this is simply what was
// configured. The fallback exists for a `Payments` assembled in code without
// one, and it resolves to `finality` on purpose: the failure mode of forgetting
// to set a risk policy must be the slow, strict behaviour, never the fast one.
func (s Payments) policy() domain.ConfirmationPolicy {
	if s.Confirmation == domain.ConfirmOnInclusion || s.Confirmation == domain.ConfirmOnFinality {
		return s.Confirmation
	}
	return domain.ConfirmOnFinality
}

// HasLiveWork reports whether any purchase is still waiting on a payment.
//
// The reconciler asks this to choose its own tempo: seconds while somebody is
// standing in front of a QR code, and a slow idle beat otherwise. Getting that
// wrong in the quiet direction is what made a real payment take minutes to be
// noticed.
func (s Payments) HasLiveWork(ctx context.Context) bool {
	live, err := s.Store.HasLiveIntents(ctx, s.Now().UTC())
	// An unreadable database is not evidence that nothing is happening, and
	// the fast tempo is the safe guess: it costs one query.
	return err != nil || live
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

// settlementContestThreshold is how many times the chain must fail to show a
// transaction, after the height by which it had to reappear, before its
// settlement is treated as reversed.
//
// Contesting a settlement withdraws a Pass the customer has already been shown,
// so the bar is deliberately not "one node said no once". Each attempt is
// spaced by the settlement backoff (30s, then 60s), which puts a real reversal
// a couple of minutes after the macro block — long enough that a node catching
// up, a brief fork, or a slow re-inclusion resolves itself first, and short
// enough that a genuinely dropped payment does not sit paid-looking forever.
const settlementContestThreshold = 3

// PromoteDue carries provisional settlements the rest of the way to finality.
//
// This is the half of the fast path that makes the fast path honest. Under
// `inclusion` the customer stops waiting at a validated micro-block inclusion,
// which is not yet irreversible — so the macro block is not skipped, it is
// merely moved off the checkout path and into here (ADR-021).
//
// Each due receipt gets one of four answers:
//
//   - the macro block has not been produced → nothing, come back later;
//   - produced, and the same transaction is still in the same canonical
//     inclusion block → FINALIZED (Case A);
//   - the same transaction is canonical in a *different* block → re-anchor the
//     evidence to that block and keep tracking (Case B);
//   - the chain has moved past the point where it had to be there and it is
//     repeatedly absent → the settlement is contested and compensation opens
//     (Case C).
//
// Nothing here can be decided from a height. A promotion always re-reads the
// inclusion block and compares it against what was originally accepted, which
// is the anti-reorg check that existed before this change and still exists.
//
// Safe on multiple replicas and across restarts: the work list is a database
// query over stored receipts, and every write locks its purchase and re-reads
// the receipt inside the transaction, so a promotion that runs twice writes
// once.
func (s Payments) PromoteDue(ctx context.Context) error {
	if s.Chain == nil {
		return nil
	}
	now := s.Now().UTC()
	due, err := s.Store.DueSettlements(ctx, now, 20)
	if err != nil || len(due) == 0 {
		return err
	}
	// One head read for the whole sweep, before any of the expensive
	// questions. Most due receipts are waiting for a macro block that simply
	// has not happened yet, and this is what lets us know that for free
	// instead of paying a full verification each to be told no.
	head, headKnown := s.chainHead(ctx)
	var firstErr error
	for _, item := range due {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if item.Network != s.Network {
			continue
		}
		if headKnown && head.Number < item.ExpectedFinalityBlock {
			if err := s.Store.NoteSettlementCheck(ctx, item.Receipt.Hash, now); err != nil && firstErr == nil {
				firstErr = err
			}
			continue
		}
		if err := s.promote(ctx, item, head, headKnown, now); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// chainHead reads the height, reporting whether it is known rather than
// failing.
//
// Every decision that leans on the head becomes *more* cautious without it: a
// receipt is checked in full rather than skipped, and an absent transaction is
// treated as unverifiable rather than as gone. So an unreadable or unconfigured
// head costs requests, never correctness.
func (s Payments) chainHead(ctx context.Context) (nimiq.ChainHead, bool) {
	if s.Head == nil {
		return nimiq.ChainHead{}, false
	}
	headCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	head, err := s.Head.Head(headCtx, string(s.Network))
	if err != nil {
		return nimiq.ChainHead{}, false
	}
	return head, true
}

// promote decides one provisional receipt against a fresh chain read.
func (s Payments) promote(ctx context.Context, item DueSettlement, head nimiq.ChainHead, headKnown bool, now time.Time) error {
	checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	evidence, err := s.Chain.Inspect(checkCtx, item.Receipt.Hash, string(item.Network))
	if err != nil {
		// "The node could not answer" and "the transaction is not there" are
		// different facts and only the second one is about the payment
		// (docs/05 §97). Everything except an outright not-found — timeouts,
		// 429s, a resyncing node, a malformed reply, and the deliberate
		// ErrRPCUnavailable that Inspect raises when a block no longer
		// contains the transaction it should — is uncertainty, and uncertainty
		// retries.
		if errors.Is(err, nimiq.ErrRPCNotFound) {
			return s.contest(ctx, item, head, headKnown, now)
		}
		if errors.Is(err, nimiq.ErrRPCRateLimited) {
			// Nothing is recorded, and here that is a safety property rather
			// than a tempo one. `settlement_attempts` is what `contest`
			// counts toward taking a Pass away, so letting our own throttling
			// inflate it would mean a later genuine absence could withdraw a
			// Pass after fewer real absences than the threshold names.
			return nil
		}
		return s.Store.NoteSettlementFailure(ctx, item.Receipt.Hash, now)
	}

	// The economic facts are not re-derived here, and cannot have changed: a
	// transaction hash commits to its sender, recipient, value, data and
	// network, all of which were validated in full before this receipt existed
	// and travel with it. What a fresh read can change is only *where* the
	// transaction sits and whether that is permanent — so that is all this
	// reads, on top of a sanity check that the node is describing the same
	// transaction at all.
	if !sameTransactionAs(evidence, item.Receipt) {
		return s.Store.NoteSettlementFailure(ctx, item.Receipt.Hash, now)
	}
	fresh := item.Receipt
	fresh.Included = evidence.Transaction.BlockNumber != nil
	fresh.IncludedAt = evidence.IncludedAt
	fresh.InclusionBlock = evidence.InclusionBlock
	fresh.FinalityBlock = evidence.FinalityBlock
	fresh.FinalizedAt = evidence.FinalizedAt
	fresh.Finalized = evidence.Finalized

	if !fresh.IsIncluded() {
		// Back in the mempool after having been in a block: the inclusion was
		// undone. Real, but indistinguishable from a node that has not caught
		// up, so it goes through the same patient path as an absence.
		return s.contest(ctx, item, head, headKnown, now)
	}
	if !fresh.SameInclusion(item.Receipt) {
		// Case B. The same valid transaction, canonically included somewhere
		// else. The money arrived; only the block it arrived in changed, so
		// the evidence is re-anchored and finality is tracked from the new
		// height. No second purchase, no second Pass — this receipt is keyed
		// by the transaction hash, which has not changed.
		//
		// Deliberately not re-checked against the intent's settlement window:
		// that window exists to stop an unrelated older transaction being
		// claimed for a new intent, and this transaction was bound to this
		// purchase before the reorg. Punishing the customer for how long the
		// chain took to re-include their payment would be the wrong reading
		// of it.
		if err := s.Store.ReanchorSettlement(ctx, item, fresh, now); err != nil {
			return err
		}
		item.Receipt = fresh
		item.ExpectedFinalityBlock = fresh.FinalityBlock
		item.Attempts = 0
	}
	if !fresh.IsFinalized() {
		// Case A, not yet. Inspect re-reads the inclusion block once the macro
		// block exists and refuses to call it final unless it still matches,
		// so arriving here means the macro block is still pending.
		return s.Store.NoteSettlementCheck(ctx, item.Receipt.Hash, now)
	}
	return s.Store.FinalizeSettlement(ctx, item, fresh, now)
}

// contest is the path for a payment the chain will not show us any more.
//
// Case C, and the one place in this file that can take a Pass away, so it is
// written to refuse until it is sure. Two conditions must both hold: the chain
// must be demonstrably past the height by which the transaction had to
// reappear — absence before that proves nothing, it may simply not be back yet
// — and the node must have said so `settlementContestThreshold` times, spaced
// by the settlement backoff.
//
// Until both hold, this records a failed check. The receipt stays INCLUDED and
// the purchase stays confirmed, which is the correct state for "we do not
// know": the customer's money may well be exactly where they sent it.
func (s Payments) contest(ctx context.Context, item DueSettlement, head nimiq.ChainHead, headKnown bool, now time.Time) error {
	if !headKnown || head.Number <= item.ExpectedFinalityBlock {
		return s.Store.NoteSettlementFailure(ctx, item.Receipt.Hash, now)
	}
	if item.Attempts+1 < settlementContestThreshold {
		return s.Store.NoteSettlementFailure(ctx, item.Receipt.Hash, now)
	}
	// The original receipt is not deleted. It moves to CONTESTED alongside the
	// inclusion block it was accepted in, the reason, and a compensation case,
	// because the audit trail of a payment that looked good and then vanished
	// is the whole record of why a Pass was withdrawn (docs/09 §Compensation).
	return s.Store.ReverseSettlement(ctx, item, domain.SettlementReversed, now)
}

// sameTransactionAs checks a fresh read is describing the transaction we
// accepted, not merely answering about the hash we asked for.
//
// A hash commits to all of these, so a disagreement is not a reorg — it is a
// node that is confused or lying, and the right response is to distrust the
// read rather than the payment.
func sameTransactionAs(evidence nimiq.ChainEvidence, receipt domain.VerifiedPayment) bool {
	tx := evidence.Transaction
	if !strings.EqualFold(tx.Hash, receipt.Hash) {
		return false
	}
	if tx.Value == nil || *tx.Value > math.MaxInt64 || domain.Luna(*tx.Value) != receipt.AmountLuna {
		return false
	}
	recipient, err := nimiq.ValidateAddress(tx.To)
	if err != nil || recipient != string(receipt.Recipient) {
		return false
	}
	sender, err := nimiq.ValidateAddress(tx.From)
	return err == nil && sender == string(receipt.Sender)
}

// DiscoverDue finds the payments nobody reported, one address at a time.
//
// This is the path a desktop QR purchase settles on, and for most customers it
// is the *only* path: the payment happens in Nimiq Pay, on a phone, while the
// browser holding the intent is a different device with no way to learn the
// transaction hash. Nothing on that route can call
// `POST /purchases/{id}/transactions`, so if the server does not go and look,
// a paid purchase waits forever. It used to.
//
// Three things about the shape, all of them corrections:
//
//   - **Grouped by address, not by purchase.** One provider with fifty live
//     intents is one query, not fifty. The address query is the expensive
//     call — `getTransactionsByAddress` costs a token per hundred items on the
//     public gateway — and every one of those fifty intents is waiting on the
//     same list of transactions.
//   - **Incremental.** Each address carries a cursor, so a sweep walks only the
//     transactions that appeared since the last one.
//   - **Backoff counts failures, not quiet.** A scan that finds nothing is the
//     normal state of a customer who has not paid yet, and must never slow the
//     next look down. Only an unreachable or throttled endpoint does.
//
// Discovery still decides nothing. It nominates a hash, which then goes
// through the unchanged Inspect → validateEvidence → finality → Confirm path.
func (s Payments) DiscoverDue(ctx context.Context) error {
	if s.Discovery == nil {
		return nil
	}
	now := s.Now().UTC()
	targets, err := s.Store.DueDiscoveryAddresses(ctx, now, 10)
	if err != nil {
		return err
	}
	var firstErr error
	for _, target := range targets {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if err := s.discoverAddress(ctx, target, now); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// discoverAddress sweeps one provider payout address and settles whatever
// pending intent each new transaction belongs to.
func (s Payments) discoverAddress(ctx context.Context, target DiscoveryAddress, now time.Time) error {
	if target.Network != s.Network {
		return nil
	}
	sweepCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	candidates, err := s.Discovery.TransactionsByAddress(sweepCtx, string(target.Recipient), string(target.Network))
	if errors.Is(err, nimiq.ErrRPCRateLimited) {
		// Not a failure of this address, and backing it off as one is what
		// delays the QR checkout: the cursor and the failure count both
		// describe the endpoint's answers, and we did not get one (ADR-022).
		return nil
	}
	if err != nil {
		// Rate limited, timed out, node resyncing: all of these mean "we did
		// not look", never "there is no payment". The intents stay pending and
		// the address backs off until the endpoint answers again
		// (docs/05 §95, §97, §158).
		return s.Store.NoteDiscoveryFailure(ctx, target.Recipient, target.Network, now)
	}

	// Everything above the cursor is new. The cursor is the newest hash this
	// address was known to have, and the list arrives newest-first, so the
	// walk simply stops when it meets it.
	fresh := newTransactionsSince(candidates, target.Cursor)

	// Advance the cursor to the head of what was actually returned, whatever
	// the matching below concludes. A transaction that belongs to no pending
	// intent has been examined once and never needs examining again.
	head := ""
	if len(candidates) > 0 {
		head = strings.ToLower(candidates[0].Hash)
	}
	if err := s.Store.NoteDiscoveryScan(ctx, target.Recipient, target.Network, head, now); err != nil {
		return err
	}
	if len(fresh) == 0 {
		return nil
	}

	var firstErr error
	for _, id := range target.Purchases {
		p, err := s.Store.Get(ctx, id.PurchaseID, id.Customer.ID)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		// Re-read under the current record: the purchase may have been paid,
		// cancelled or reported by a client since the sweep listed it.
		if p.CandidateHash != "" || p.Purchase.Status != domain.PurchasePaymentPending {
			continue
		}
		hash := matchDiscovered(p.Purchase, fresh, now)
		if hash == "" {
			continue
		}
		if _, err := s.Store.Discover(ctx, id.PurchaseID, id.Customer.ID, hash, now); err != nil {
			// A conflict means another sweep or a client got there first, or
			// the transaction is already spoken for. Both are correct.
			if errors.Is(err, ErrConflict) {
				continue
			}
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		s.note(p.Purchase, "discovered", "origin", "DISCOVERY")
		if _, err := s.Reconcile(ctx, id.Customer, id.PurchaseID); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// newTransactionsSince trims an address listing down to what arrived after the
// cursor.
//
// `getTransactionsByAddress` returns newest-first, so the cursor — the newest
// hash seen on the previous sweep — appears partway down and everything above
// it is new. A cursor that is absent from the page means the address moved
// further than one page since the last look, and the whole page is treated as
// new: re-examining a transaction is harmless (it either matches a pending
// intent or it does not), while missing one would strand a payment.
// submissionGap is how long a candidate took from being reported or discovered
// to reaching a decision, in milliseconds. -1 when there is no submission time
// to measure from.
func submissionGap(submittedAt *time.Time, now time.Time) int64 {
	if submittedAt == nil {
		return -1
	}
	return now.Sub(*submittedAt).Milliseconds()
}

func newTransactionsSince(candidates []nimiq.ChainTransaction, cursor string) []nimiq.ChainTransaction {
	if cursor == "" {
		return candidates
	}
	for i, tx := range candidates {
		if strings.EqualFold(tx.Hash, cursor) {
			return candidates[:i]
		}
	}
	return candidates
}

// matchDiscovered picks the one transaction that can belong to this purchase,
// or nothing at all.
//
// Every clause below is a rejection rule; there is no scoring and no
// best-effort. A transaction is a candidate only if it is indistinguishable
// from the payment this intent asked for:
//
//	recipient  == the intent's snapshotted provider wallet
//	sender     == the wallet the intent was issued to
//	value      == the snapshotted price, to the Luna
//	network    == the intent's network
//	timing     inside the intent's own lifetime plus the settlement grace
//	reference  this purchase's NP1 bytes, or no Nimpass reference at all
//
// The reference clause is the subtle one, and it is deliberately asymmetric.
// A transaction carrying *another* purchase's reference is refused outright,
// which is the rule docs/05 §142 states and which stops one customer's payment
// being harvested for a different purchase. A transaction carrying **no** data
// falls back to the tuple above — because the Nimiq Pay payment scanner is
// closed-source, no official source says a scanned request link's `message`
// reaches `recipientData`, and a scan that drops it would otherwise take real
// money for a Pass that could never be issued (ADR-006 gate G1).
//
// That fallback is a correlation rule, not a weakened check. The economic
// guarantees are untouched: the sender must still be this customer, the
// recipient this provider, the amount exact, and the transaction still has to
// survive the whole verification path afterwards — including global hash
// uniqueness, so one transaction can never pay for two Passes.
//
// Ambiguity is resolved by refusing to resolve it. If more than one
// transaction matches, none is adopted: two indistinguishable payments are a
// reconciliation question for a human, not a coin flip between them.
func matchDiscovered(p domain.Purchase, candidates []nimiq.ChainTransaction, now time.Time) string {
	_, expectedID, err := nimiq.ExpectedNetworkID(string(p.Snapshot.Network))
	if err != nil {
		return ""
	}
	earliest := p.CreatedAt
	latest := p.ExpiresAt.Add(domain.PurchaseSettlementGrace)
	matched := ""
	for _, tx := range candidates {
		if tx.NetworkID == nil || *tx.NetworkID != expectedID {
			continue
		}
		if tx.Value == nil || *tx.Value > math.MaxInt64 || int64(*tx.Value) != int64(p.Snapshot.PriceLuna) {
			continue
		}
		recipient, err := nimiq.ValidateAddress(tx.To)
		if err != nil || recipient != string(p.Snapshot.Recipient) {
			continue
		}
		// Reference first, sender second — and which one applies is decided
		// by the transaction, not by policy.
		//
		// A transaction carrying this intent's NP1 bytes is bound to it by 16
		// random bytes the server issued for this one purchase. Nothing else
		// is needed: no third party can produce that reference, and no other
		// intent will ever be issued it. The sender is then recorded rather
		// than required, because Nimiq Pay pays from whichever account the
		// customer approves and its provider API offers no way to pin one —
		// requiring it is precisely what left a correctly-paid purchase
		// unmatchable.
		//
		// Without the reference there is nothing purchase-specific on chain,
		// so the sender rule stands exactly as it did: recipient and amount
		// alone would match any stranger's transfer to the same provider.
		carriesReference, referenceOK := referenceState(tx.RecipientData, p.PaymentReference)
		if !referenceOK {
			continue
		}
		if !carriesReference {
			sender, err := nimiq.ValidateAddress(tx.From)
			if err != nil || p.ExpectedWallet == "" || sender != string(p.ExpectedWallet) {
				continue
			}
		}
		// A transaction still in the mempool has no timestamp yet; its timing is
		// checked against the block once validateEvidence sees it included.
		if tx.Timestamp != nil {
			at := time.UnixMilli(int64(*tx.Timestamp)).UTC()
			if at.Before(earliest) || at.After(latest) || at.After(now) {
				continue
			}
		}
		if matched != "" && !strings.EqualFold(matched, tx.Hash) {
			return ""
		}
		matched = strings.ToLower(tx.Hash)
	}
	return matched
}

// referenceState reads a transaction's data field against this purchase.
//
//	exact NP1 match      -> present, allowed. The strongest correlation there is.
//	empty data           -> absent, allowed. Falls back to the sender tuple.
//	another NP reference -> refused outright (docs/05 §142)
//	unrelated data       -> refused; an unexplained payload is not our payment
//
// The first return value is the one that changed the product: callers use it
// to decide whether the sender still has to match. It is never a reason to
// accept a transaction on its own — everything else in the verifier still
// applies to a referenced payment.
func referenceState(recipientData string, reference domain.PaymentReference) (present, allowed bool) {
	data, err := nimiq.DecodeRecipientData(recipientData)
	if err != nil {
		return false, false
	}
	if len(data) == 0 {
		return false, true
	}
	if bytes.Equal(data, []byte(reference)) {
		return true, true
	}
	return false, false
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
	// The sender's *account type* is deliberately not constrained.
	//
	// Measured on a real device, 2026-09-17: a Nimiq Pay payment arrived with
	// `fromType: 2`. That account's spendable balance sits in an HTLC and the
	// app pays by early-resolving it, so the transaction's `from` is the
	// contract rather than the user's basic address. Requiring
	// `*tx.FromType == 0` refused two real Testnet payments that were correct
	// in every other respect — the provider's address, the exact Luna, this
	// intent's own NP1 bytes, `executionResult` true — recorded them as
	// MISMATCH and failed both purchases permanently, after the money had
	// already moved.
	//
	// Dropping it weakens nothing, because the sender's account type never
	// carried an economic guarantee. What settles a payment is that the value
	// arrived at the provider and cannot be taken back, and that is asserted
	// entirely by the clauses kept here and below: `toType == 0` (the
	// recipient is a plain account, so the value is credited rather than
	// handed to contract logic), `flags == 0` (no contract creation, no
	// signalling transaction), a non-empty proof, `executionResult` true once
	// included, and macro-block finality. An outgoing HTLC or vesting
	// transfer satisfying those credits the recipient exactly as a basic
	// transfer does.
	//
	// Who owns the resulting Pass is a separate question, already answered by
	// the authenticated buyer rather than by the paying address (ADR-013), so
	// a contract sender cannot become a Pass owner.
	//
	// The presence check stays: a transaction the node did not fully describe
	// is still refused.
	if (e.InclusionBlock > 0 && (tx.ExecutionResult == nil || !*tx.ExecutionResult)) || tx.FromType == nil || tx.ToType == nil || *tx.ToType != 0 || tx.Flags == nil || *tx.Flags != 0 || tx.Proof == "" {
		return domain.VerifiedPayment{}, "EXECUTION"
	}
	sender, err := nimiq.ValidateAddress(tx.From)
	if err != nil {
		return domain.VerifiedPayment{}, "SENDER"
	}
	recipient, err := nimiq.ValidateAddress(tx.To)
	if err != nil || recipient != string(p.Purchase.Snapshot.Recipient) {
		return domain.VerifiedPayment{}, "RECIPIENT"
	}
	// A transfer to itself pays nobody.
	//
	// This is not the sender gate ADR-013 removed — it does not ask which
	// account paid, and it never compares the sender to the intent's wallet.
	// It asks whether any value moved at all, and where the payee is also the
	// payer the answer is no: the balance is unchanged but for the fee, and a
	// Pass issued against it would be free.
	//
	// The intent-time check in `PaymentRepository.Create` refuses this pair
	// before a payment exists, but only for the wallet the session proved.
	// Nimiq Pay pays from whichever account the customer approves, so the one
	// address the intent could not have known is exactly the one that matters
	// here.
	if sender == recipient {
		return domain.VerifiedPayment{}, "SELF_TRANSFER"
	}
	if tx.Value == nil || *tx.Value > math.MaxInt64 || int64(*tx.Value) != int64(p.Purchase.Snapshot.PriceLuna) {
		return domain.VerifiedPayment{}, "AMOUNT"
	}
	// The same asymmetric reference rule discovery uses, for the same reason:
	// a transaction bearing another purchase's NP1 can never settle this one
	// (docs/05 §142), while a transaction bearing no data at all is correlated
	// by the sender/recipient/exact-value/window tuple every line above and
	// below this one has already established. That fallback exists because a
	// payment scanned into Nimiq Pay may arrive without a data field, and
	// refusing it would mean real money moved for a Pass that can never issue.
	//
	// Replay is not what this opens. A transaction that already settled
	// anything is refused by the verified_payments primary key, and the timing
	// clause below confines a settlement to the intent's own lifetime, so an
	// older transaction of the customer's own cannot be presented for a new
	// purchase.
	carriesReference, referenceOK := referenceState(tx.RecipientData, p.Purchase.PaymentReference)
	if !referenceOK {
		return domain.VerifiedPayment{}, "DATA"
	}
	// The sender gate, applied here for the same reason and under the same
	// condition as in discovery: mandatory when the chain carries nothing
	// purchase-specific, lifted when it carries this intent's own reference.
	// `domain.Purchase.validateVerifiedPayment` re-applies it independently on
	// the evidence below, so this is a check in two places rather than a
	// check moved out of one.
	if !carriesReference && sender != string(p.Purchase.ExpectedWallet) {
		return domain.VerifiedPayment{}, "SENDER"
	}
	// When we were *told* about the transaction, which is a different question
	// from when the payment happened — and the softer of the two.
	//
	// This used to require a report strictly inside the intent's own lifetime,
	// which quietly broke the path it matters most on. Server-side discovery
	// adopts a hash at the moment it finds one, and it is allowed to look
	// until `ExpiresAt + PurchaseSettlementGrace`; a payment discovered in
	// that window therefore carried a submission time after `ExpiresAt` and
	// was rejected here as TIMING → MISMATCH → permanently failed. Real money,
	// on chain, inside the intent's window, reported a minute late, and the
	// purchase ended as a failure.
	//
	// Nothing is loosened by widening it to the same grace. Replay protection
	// does not live in this clause: it lives in the inclusion window below
	// (the transaction must have been *included* inside the intent's
	// lifetime), in the sender/recipient/exact-value match above, and in the
	// `verified_payments` primary key, which lets one transaction settle
	// exactly one purchase ever.
	if p.SubmittedAt == nil || !p.SubmittedAt.Before(p.Purchase.ExpiresAt.Add(domain.PurchaseSettlementGrace)) {
		return domain.VerifiedPayment{}, "TIMING"
	}
	// FinalizedAt travels on the receipt now rather than beside it. It used to
	// be a separate argument to `Confirm`, which meant the evidence object
	// could say `Finalized: true` while carrying no moment of finality — and
	// `IsFinalized` has to be able to tell a real macro block from a flag
	// somebody set.
	verified := domain.VerifiedPayment{Hash: p.CandidateHash, Sender: domain.WalletAddress(sender), Recipient: domain.WalletAddress(recipient), AmountLuna: domain.Luna(*tx.Value), Reference: p.Purchase.PaymentReference, Network: p.Purchase.Snapshot.Network, ReferenceOnChain: carriesReference, Included: e.InclusionBlock > 0, IncludedAt: e.IncludedAt, InclusionBlock: e.InclusionBlock, FinalityBlock: e.FinalityBlock, Finalized: e.Finalized, FinalizedAt: e.FinalizedAt}
	if e.InclusionBlock > 0 && (e.IncludedAt.Before(p.Purchase.CreatedAt) || e.IncludedAt.After(p.Purchase.ExpiresAt.Add(5*time.Minute)) || e.IncludedAt.After(now) || (e.IncludedAt.After(p.Purchase.ExpiresAt) && (p.BroadcastObservedAt == nil || !p.BroadcastObservedAt.Before(p.Purchase.ExpiresAt)))) {
		return domain.VerifiedPayment{}, "TIMING"
	}
	return verified, ""
}
