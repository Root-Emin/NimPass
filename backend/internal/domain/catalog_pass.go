package domain

import (
	"errors"
	"strings"
	"time"
)

type PassStatus string

const (
	PassDraft       PassStatus = "DRAFT"
	PassActive      PassStatus = "ACTIVE"
	PassUnavailable PassStatus = "UNAVAILABLE"
	PassArchived    PassStatus = "ARCHIVED"
)

// ExpirationPolicy currently represents an optional fixed UTC expiration date.
// A relative-duration policy needs a separate product decision before use.
type ExpirationPolicy struct {
	ExpiresAt *time.Time
}

func NewExpirationPolicy(at *time.Time) ExpirationPolicy {
	if at == nil {
		return ExpirationPolicy{}
	}
	copy := at.UTC()
	return ExpirationPolicy{ExpiresAt: &copy}
}

func (p ExpirationPolicy) Resolve(at time.Time) (*time.Time, error) {
	if p.ExpiresAt == nil {
		return nil, nil
	}
	if !p.ExpiresAt.After(at) {
		return nil, errors.New("pass expiration must be after purchase confirmation")
	}
	copy := p.ExpiresAt.UTC()
	return &copy, nil
}

type Pass struct {
	ID          ID
	ProviderID  ID
	ServiceID   ID
	Title       string
	Description string
	Sessions    SessionCount
	PriceLuna   Luna
	Expiration  ExpirationPolicy
	// Empty until the provider picks one. Display falls back to a derived tone.
	Accent Accent
	// Empty until the provider uploads a cover. Display falls back to the accent field.
	CoverMediaID ID
	Status       PassStatus
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func NewPass(id, providerID, serviceID ID, title, description string, sessions SessionCount, price Luna, expiration ExpirationPolicy, accent Accent, now time.Time) (Pass, error) {
	for _, value := range []ID{id, providerID, serviceID} {
		if _, err := ParseID(string(value)); err != nil {
			return Pass{}, err
		}
	}
	title = strings.TrimSpace(title)
	if title == "" || len(title) > 160 || len(description) > 2000 || sessions <= 0 || price <= 0 || now.IsZero() {
		return Pass{}, errors.New("pass requires valid title, positive sessions and Luna price")
	}
	if _, err := expiration.Resolve(now); err != nil {
		return Pass{}, err
	}
	parsed, err := ParseAccent(string(accent))
	if err != nil {
		return Pass{}, err
	}
	return Pass{ID: id, ProviderID: providerID, ServiceID: serviceID, Title: title, Description: strings.TrimSpace(description), Sessions: sessions, PriceLuna: price, Expiration: NewExpirationPolicy(expiration.ExpiresAt), Accent: parsed, Status: PassDraft, CreatedAt: now.UTC(), UpdatedAt: now.UTC()}, nil
}

func (p *Pass) Publish(now time.Time) error {
	if p.Status != PassDraft && p.Status != PassUnavailable {
		return errors.New("pass cannot be published from current state")
	}
	if _, err := p.Expiration.Resolve(now); err != nil {
		return err
	}
	p.Status = PassActive
	p.UpdatedAt = now.UTC()
	return nil
}

func (p Pass) CanPurchase(at time.Time) bool {
	if p.Status != PassActive || p.Sessions <= 0 || p.PriceLuna <= 0 || at.IsZero() {
		return false
	}
	_, err := p.Expiration.Resolve(at)
	return err == nil
}

// Archive withdraws a Pass from sale for good.
//
// This is what "delete this Pass" means in Nimpass. The row is never removed,
// because `purchased_passes`, `purchases`, `verified_payments` and the
// redemption trail all point at it through composite foreign keys, and a real
// delete would either fail against those constraints or take a customer's
// paid-for pass with it. `08-ARCHITECTURE.md` §135 says as much — public
// availability is disabled without destroying the historical record — and §136
// spells out the two halves: new purchases are blocked, existing passes carry
// on under their own validity.
//
// Terminal in both directions. `Publish` refuses anything that is not DRAFT or
// UNAVAILABLE, so an archived Pass can never return to sale; that is
// deliberate, because a link a customer holds would otherwise change what it
// sells underneath them. A provider who wants to sell it again creates it
// again.
func (p *Pass) Archive(now time.Time) error {
	if p.Status == PassArchived {
		return errors.New("pass is already archived")
	}
	if now.IsZero() {
		return errors.New("invalid archive time")
	}
	p.Status = PassArchived
	p.UpdatedAt = now.UTC()
	return nil
}

// Unpublish takes a Pass off the shelf without ending it.
//
// The distinction from Archive is the whole point. Archiving is what "delete"
// means here and it is terminal in both directions; this is reversible, and
// `Publish` already accepts UNAVAILABLE as a source state, so the lifecycle is
// ACTIVE -> UNAVAILABLE -> ACTIVE on the same row, with the same id.
//
// `08-ARCHITECTURE.md` §34 defines exactly what the status may decide:
// availability for *new* purchases, and nothing else. Nothing a customer holds
// is reachable from here — `purchased_passes`, their sessions, the purchases
// and verified payments behind them are separate records carrying their own
// snapshots, and none of them consults this field.
//
// Only an ACTIVE Pass can be withdrawn. A DRAFT was never on sale and an
// ARCHIVED one is finished; moving either here would overwrite a distinct fact
// with a weaker one. Re-withdrawing an already UNAVAILABLE Pass is handled a
// layer out, where a repeated request can be answered without a write.
func (p *Pass) Unpublish(now time.Time) error {
	if p.Status != PassActive {
		return errors.New("only a published pass can be removed from the listing")
	}
	if now.IsZero() {
		return errors.New("invalid unpublish time")
	}
	p.Status = PassUnavailable
	p.UpdatedAt = now.UTC()
	return nil
}
