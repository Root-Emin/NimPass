package domain

import (
	"errors"
	"fmt"
	"time"
)

// ConfirmationPolicy is the deployment's answer to one question: how much of
// the chain's own certainty a payment must have accumulated before Nimpass
// treats the purchase as bought and issues the Pass.
//
// It exists because the two honest answers have different costs and the right
// one is a risk decision, not an engineering one:
//
//	inclusion  the transaction is in a canonical micro block and every
//	           economic check has passed. Albatross produces a micro block
//	           roughly every second, so this is reached almost immediately.
//	finality   additionally, the macro block that makes that micro block
//	           irreversible has been produced. That is up to a batch away —
//	           roughly a minute on Mainnet, depending where in the batch the
//	           transaction landed.
//
// What the policy governs is the *wait*, never the *validation*. Both values
// require the whole verifier to pass first; neither can admit a transaction
// that is absent, unincluded, mispriced, misdirected, misreferenced, on the
// wrong chain, already spent or outside the intent's window. See
// `validateVerifiedPayment` and `application.validateEvidence`.
//
// There is deliberately no third value and no fallback between the two. An
// unparseable value fails configuration validation rather than resolving to
// something, and `Satisfies` refuses everything for a policy it does not
// recognise — so the failure direction of a mistake here is "nothing settles",
// never "everything settles".
type ConfirmationPolicy string

const (
	// ConfirmOnInclusion issues the Pass once the payment is canonically
	// included and fully validated, and keeps tracking finality in the
	// background.
	ConfirmOnInclusion ConfirmationPolicy = "inclusion"
	// ConfirmOnFinality withholds the Pass until the macro block. The original
	// Nimpass behaviour, kept so a deployment can choose it without a fork.
	ConfirmOnFinality ConfirmationPolicy = "finality"
)

// ParseConfirmationPolicy accepts exactly the two documented values.
func ParseConfirmationPolicy(value string) (ConfirmationPolicy, error) {
	switch ConfirmationPolicy(value) {
	case ConfirmOnInclusion:
		return ConfirmOnInclusion, nil
	case ConfirmOnFinality:
		return ConfirmOnFinality, nil
	}
	return "", fmt.Errorf("confirmation policy must be %q or %q", ConfirmOnInclusion, ConfirmOnFinality)
}

// SettlementStatus is how far the chain has carried a payment Nimpass has
// already accepted.
//
// It is a property of the *receipt*, not of the purchase, and that separation
// is the whole point of it. A purchase can be complete — money validated, Pass
// issued, customer done — while the transaction behind it is still one macro
// block away from being irreversible. Folding the two together is what forced
// the customer to wait for the macro block, because there was no way to write
// down "accepted, not yet permanent".
type SettlementStatus string

const (
	// SettlementIncluded is a provisional receipt: canonically included and
	// fully validated, finality still being tracked.
	SettlementIncluded SettlementStatus = "INCLUDED"
	// SettlementFinalized is a receipt the macro block has made permanent.
	SettlementFinalized SettlementStatus = "FINALIZED"
	// SettlementContested is a receipt whose transaction stopped being part of
	// the canonical chain. The receipt is kept — it is the evidence of what was
	// accepted and why — and a recovery case is opened against it.
	SettlementContested SettlementStatus = "CONTESTED"
)

// SettlementReversed is the compensation reason recorded when a provisionally
// settled payment turns out not to be canonical.
//
// It is the mirror image of PassExpiredBeforeActivation: there, real money
// arrived and no Pass could be issued; here, a Pass was issued and the money
// turns out never to have arrived. Both are cases where the receipt and the
// entitlement disagree and a human has to close the loop, which is why they
// live in the same ledger rather than in a second recovery subsystem.
const SettlementReversed = "PAYMENT_SETTLEMENT_REVERSED"

// PassExpiredBeforeActivation is the pre-existing compensation reason.
const PassExpiredBeforeActivation = "PASS_EXPIRED_BEFORE_ACTIVATION"

// Settlement reports which state this evidence describes.
//
// Only two of the three are derivable. CONTESTED is a decision the reconciler
// recorded after watching the chain fail to produce the transaction, so it
// exists in storage and not in evidence — which is why every function below
// that must not act on a contested receipt is called by the repository from
// inside the transaction that read its `settlement_status` column, under the
// purchase's row lock, rather than trusting this to tell them.
func (v VerifiedPayment) Settlement() SettlementStatus {
	if v.IsFinalized() {
		return SettlementFinalized
	}
	return SettlementIncluded
}

// IsIncluded reports whether the evidence places the transaction in a block.
//
// All three parts are required. `Included` is the verifier's conclusion, the
// block number is what a reorg check later compares against, and the block
// timestamp is what the intent's timing window is measured with — evidence
// missing any of them describes a transaction nobody has actually located.
func (v VerifiedPayment) IsIncluded() bool {
	return v.Included && v.InclusionBlock > 0 && !v.IncludedAt.IsZero()
}

// IsFinalized reports whether a macro block has made the inclusion permanent.
//
// Every clause is a consistency requirement rather than a preference: a
// finalised payment must name the macro block that finalised it, that block
// must sit above the inclusion block, and it cannot have been produced before
// the block it finalises. Evidence that claims finality without them is
// refused rather than believed, which is what stops a provisional receipt from
// being promoted by an incomplete answer.
func (v VerifiedPayment) IsFinalized() bool {
	return v.IsIncluded() && v.Finalized &&
		v.FinalityBlock > v.InclusionBlock &&
		!v.FinalizedAt.IsZero() && !v.FinalizedAt.Before(v.IncludedAt)
}

// Satisfies answers whether this evidence meets the configured settlement rule.
//
// This is the single place the policy is allowed to change an outcome, and it
// is deliberately the *last* question asked: everything economic has already
// been established by the time a caller gets here. An unrecognised policy
// satisfies nothing.
func (v VerifiedPayment) Satisfies(policy ConfirmationPolicy) bool {
	switch policy {
	case ConfirmOnInclusion:
		// The extra clause is the price of settling early. Accepting an
		// inclusion is a promise to carry it to finality, and a receipt that
		// does not know which macro block it is waiting for cannot be carried
		// anywhere — it would be a provisional payment nobody could ever
		// promote or contest. `Inspect` reports that height from the moment
		// the transaction is in a block, so requiring it costs nothing and
		// closes the one way a receipt could be written as permanently
		// unresolvable.
		return v.IsIncluded() && v.FinalityBlock > v.InclusionBlock
	case ConfirmOnFinality:
		return v.IsFinalized()
	}
	return false
}

// SameInclusion reports whether two readings of the chain agree about where
// the transaction is.
//
// The anti-reorg comparison. A promotion is only allowed to finalise the
// inclusion that was originally accepted, so the block height and the block's
// own timestamp must both still match; a transaction that reappeared in a
// different block is a different fact and takes the re-anchoring path instead.
func (v VerifiedPayment) SameInclusion(other VerifiedPayment) bool {
	return v.InclusionBlock == other.InclusionBlock && v.IncludedAt.Equal(other.IncludedAt)
}

// sameTransaction reports whether two receipts describe one payment, ignoring
// where the chain currently says it sits.
func (v VerifiedPayment) sameTransaction(other VerifiedPayment) bool {
	return v.Hash == other.Hash && v.Recipient == other.Recipient &&
		v.AmountLuna == other.AmountLuna && v.Reference == other.Reference &&
		v.Network == other.Network
}

// PromoteSettlement turns a provisional receipt into a finalised one.
//
// The rule it enforces is the one that makes fast settlement safe to reverse
// the wait on: finality is only ever granted to *the inclusion that was
// accepted*. Fresh evidence has to describe the same transaction, in the same
// block, produced at the same moment, and now covered by a macro block. A
// re-read that disagrees about any of that is not a promotion — it is either a
// re-inclusion (ReanchorSettlement) or a canonicality failure — and is refused
// here rather than resolved by preferring the newer answer.
//
// Idempotent by omission rather than by special case: an already-finalised
// receipt is not provisional, so a second promotion of one is refused — and
// `PaymentRepository.FinalizeSettlement` short-circuits before reaching here
// when the locked row already says FINALIZED, so a promotion that runs twice
// writes once.
func PromoteSettlement(stored, evidence VerifiedPayment) (VerifiedPayment, error) {
	if stored.Settlement() != SettlementIncluded {
		return VerifiedPayment{}, errors.New("only a provisional receipt can be promoted")
	}
	if !stored.sameTransaction(evidence) {
		return VerifiedPayment{}, errors.New("finality evidence describes a different payment")
	}
	if !stored.SameInclusion(evidence) {
		return VerifiedPayment{}, errors.New("finality evidence names a different inclusion block")
	}
	if !evidence.IsFinalized() {
		return VerifiedPayment{}, errors.New("evidence does not establish macro-block finality")
	}
	return evidence, nil
}

// ReanchorSettlement moves a provisional receipt onto a new canonical
// inclusion of the same transaction.
//
// Case B of the reorg model: the block the payment was accepted in stopped
// being canonical, but the payment itself survived into the winning chain.
// Nothing economic changed — same hash, same provider, same Luna, same
// reference, same network — so the purchase and its Pass stand and only the
// inclusion evidence is corrected. Creating a second purchase or a second Pass
// here would be inventing economic state out of a chain reorganisation.
//
// The transaction identity is required to match exactly, which is what stops
// this from becoming a way to attach different evidence to a settled purchase.
func ReanchorSettlement(stored, evidence VerifiedPayment) (VerifiedPayment, error) {
	if stored.Settlement() != SettlementIncluded {
		return VerifiedPayment{}, errors.New("only a provisional receipt can be re-anchored")
	}
	if !stored.sameTransaction(evidence) {
		return VerifiedPayment{}, errors.New("re-anchoring evidence describes a different payment")
	}
	if !evidence.IsIncluded() {
		return VerifiedPayment{}, errors.New("re-anchoring requires a canonical inclusion")
	}
	if stored.SameInclusion(evidence) {
		return VerifiedPayment{}, errors.New("inclusion is unchanged; nothing to re-anchor")
	}
	return evidence, nil
}

// ValidateContest checks that a receipt may be recorded as contested.
//
// Only a provisional receipt can be: a finalised payment is by definition
// beyond reorganisation, so a reading that claims otherwise is a defect in the
// reader rather than a fact about the chain, and acting on it would withdraw a
// Pass that was genuinely paid for.
func ValidateContest(stored VerifiedPayment, at time.Time) error {
	if stored.Settlement() != SettlementIncluded {
		return errors.New("only a provisional receipt can be contested")
	}
	if at.IsZero() || at.Before(stored.IncludedAt) {
		return errors.New("invalid contest time")
	}
	return nil
}
