package domain

import (
	"errors"
	"strings"
	"time"
)

type Provider struct {
	ID              ID
	OwnerIdentityID ID
	Name            string
	Slug            string
	Headline        string
	Bio             string
	AvatarURL       string
	// Which identicon of the owner wallet this provider shows. 0 is the
	// wallet's own, which is the face ADR-010 gives every provider by default.
	AvatarVariant    int16
	Location         string
	PayoutWallet     WalletAddress
	PayoutVerifiedAt *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func NewProvider(id, ownerIdentityID ID, name string, now time.Time) (Provider, error) {
	if _, err := ParseID(string(id)); err != nil {
		return Provider{}, err
	}
	if _, err := ParseID(string(ownerIdentityID)); err != nil {
		return Provider{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 160 || now.IsZero() {
		return Provider{}, errors.New("provider requires valid name and creation time")
	}
	return Provider{ID: id, OwnerIdentityID: ownerIdentityID, Name: name, CreatedAt: now.UTC(), UpdatedAt: now.UTC()}, nil
}

// AdoptOwnerPayout makes the owner's own wallet the payment recipient.
//
// This is the only way a provider gets a payout wallet in the product. The
// address is not chosen and not typed: it is the wallet that signed the
// AUTH_LOGIN challenge this session was issued for, so control of it is
// already proven and no second signature would establish anything the account
// does not already rest on (docs/DECISIONS.md ADR-025).
//
// The address is still parsed rather than trusted. It arrives from the
// identity record, which cannot hold a malformed one, and validating it here
// keeps the domain the only place that decides what a wallet address is.
func (p *Provider) AdoptOwnerPayout(wallet string, now time.Time) error {
	address, err := NewWalletAddress(wallet)
	if err != nil {
		return err
	}
	verified := now.UTC()
	p.PayoutWallet = address
	p.PayoutVerifiedAt = &verified
	p.UpdatedAt = verified
	return nil
}

func (p Provider) CanReceivePayments() bool {
	if p.PayoutVerifiedAt == nil {
		return false
	}
	_, err := NewWalletAddress(string(p.PayoutWallet))
	return err == nil
}
