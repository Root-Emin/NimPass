package domain

import (
	"errors"
	"time"
)

type PurchasedPassStatus string

const (
	PurchasedPassActive    PurchasedPassStatus = "ACTIVE"
	PurchasedPassCompleted PurchasedPassStatus = "COMPLETED"
	PurchasedPassExpired   PurchasedPassStatus = "EXPIRED"
	PurchasedPassCancelled PurchasedPassStatus = "CANCELLED"
)

type PurchasedPass struct {
	ID         ID
	PurchaseID ID
	// OwnerIdentityID is the buyer's account: the answer to "whose pass is
	// this?" without joining back through the purchase. OwnerWallet stays
	// beside it because the redemption signature is checked against an
	// address, not an account.
	OwnerIdentityID ID
	// ProviderIdentityID is the account behind the provider record, captured
	// when the pass is created. Session authorisation reads it, so it is
	// deliberately a snapshot rather than a live lookup through `providers`.
	ProviderIdentityID ID
	OwnerWallet        WalletAddress
	Snapshot           PurchaseSnapshot
	OriginalSessions   SessionCount
	UsedSessions       int32
	RemainingSessions  int32
	Status             PurchasedPassStatus
	CreatedAt          time.Time
	ExpiresAt          *time.Time
	CompletedAt        *time.Time
}

// NewPurchasedPass creates the buyer's owned pass from a confirmed purchase.
//
// `providerIdentityID` is the only value that does not come from the purchase
// itself, because the purchase snapshot records the provider *record*, not the
// account behind it. The caller reads it under the same lock as the pass.
func NewPurchasedPass(id ID, purchase Purchase, providerIdentityID ID) (PurchasedPass, error) {
	for _, value := range []ID{id, purchase.CustomerContextID, providerIdentityID} {
		if _, err := ParseID(string(value)); err != nil {
			return PurchasedPass{}, err
		}
	}
	if purchase.Status != PurchaseConfirmed || purchase.VerifiedSender == "" || purchase.ConfirmedAt == nil {
		return PurchasedPass{}, errors.New("purchased pass requires a confirmed verified purchase")
	}
	// The invariant the whole ownership story rests on: a purchased pass
	// belongs to the authenticated buyer who created the intent, and to the
	// provider whose product it is. Neither is taken from a request body.
	if purchase.CustomerContextID == providerIdentityID {
		return PurchasedPass{}, errors.New("a provider cannot own a pass bought from itself")
	}
	expiresAt, err := purchase.Snapshot.Expiration.Resolve(*purchase.ConfirmedAt)
	if err != nil {
		return PurchasedPass{}, err
	}
	// The owner is the authenticated buyer, not whichever address paid.
	//
	// These are usually the same address and were previously assumed to be:
	// `OwnerWallet` was the on-chain sender. Nimiq Pay pays from whichever
	// account the user approves and its provider API exposes no sender
	// parameter, so a customer with two accounts in one wallet could pay
	// correctly and end up holding a pass their logged-in identity could not
	// redeem — the redemption challenge is issued against `OwnerWallet`.
	//
	// The buyer's own wallet is the right answer: it is the address they
	// proved control of to create this intent. The address that actually paid
	// is kept as `purchase.VerifiedSender` and written to
	// `verified_sender_wallet`, where it belongs — an audit fact, not an
	// ownership claim.
	owner := purchase.ExpectedWallet
	if owner == "" {
		owner = purchase.VerifiedSender
	}
	pass := PurchasedPass{
		ID: id, PurchaseID: purchase.ID, OwnerWallet: owner,
		OwnerIdentityID: purchase.CustomerContextID, ProviderIdentityID: providerIdentityID,
		Snapshot: purchase.Snapshot.clone(), OriginalSessions: purchase.Snapshot.Sessions,
		RemainingSessions: int32(purchase.Snapshot.Sessions), Status: PurchasedPassActive,
		CreatedAt: purchase.ConfirmedAt.UTC(), ExpiresAt: expiresAt,
	}
	return pass, pass.Validate()
}

func (p PurchasedPass) Validate() error {
	switch p.Status {
	case PurchasedPassActive, PurchasedPassCompleted, PurchasedPassExpired, PurchasedPassCancelled:
	default:
		return errors.New("invalid pass status")
	}
	if p.OriginalSessions <= 0 || p.UsedSessions < 0 || p.RemainingSessions < 0 ||
		p.UsedSessions+p.RemainingSessions != int32(p.OriginalSessions) {
		return errors.New("pass session invariant violated")
	}
	if p.Status == PurchasedPassCompleted && p.RemainingSessions != 0 {
		return errors.New("completed pass must have zero remaining sessions")
	}
	if p.Status == PurchasedPassActive && p.RemainingSessions == 0 {
		return errors.New("active pass must have remaining sessions")
	}
	if p.Status == PurchasedPassExpired && p.ExpiresAt == nil {
		return errors.New("expired pass requires expiration date")
	}
	if p.OwnerIdentityID != "" && p.OwnerIdentityID == p.ProviderIdentityID {
		return errors.New("a pass cannot be owned and provided by the same account")
	}
	return nil
}

// ViewerRole is what one authenticated account is to a purchased pass.
//
// Both parties read the same record and the same sessions; what differs is
// which writes each may make. Anyone who is neither sees nothing at all — the
// repository refuses to return the row rather than returning it read-only.
type ViewerRole string

const (
	ViewerOwner    ViewerRole = "OWNER"
	ViewerProvider ViewerRole = "PROVIDER"
)

// RoleOf names the actor's relationship to this pass, or false for a stranger.
func (p PurchasedPass) RoleOf(identityID ID) (ViewerRole, bool) {
	switch identityID {
	case "":
		return "", false
	case p.OwnerIdentityID:
		return ViewerOwner, true
	case p.ProviderIdentityID:
		return ViewerProvider, true
	}
	return "", false
}

func (p *PurchasedPass) ConsumeSession(now time.Time) error {
	if err := p.Validate(); err != nil {
		return err
	}
	if p.Status != PurchasedPassActive || p.RemainingSessions == 0 {
		return errors.New("pass is not redeemable")
	}
	if p.ExpiresAt != nil && !now.Before(*p.ExpiresAt) {
		return errors.New("pass has expired")
	}
	if now.IsZero() || now.Before(p.CreatedAt) {
		return errors.New("invalid redemption time")
	}
	p.UsedSessions++
	p.RemainingSessions--
	if p.RemainingSessions == 0 {
		p.Status = PurchasedPassCompleted
		completed := now.UTC()
		p.CompletedAt = &completed
	}
	return p.Validate()
}

func (p *PurchasedPass) ExpireIfDue(now time.Time) bool {
	if p.Status != PurchasedPassActive || p.ExpiresAt == nil || now.Before(*p.ExpiresAt) {
		return false
	}
	p.Status = PurchasedPassExpired
	return true
}
