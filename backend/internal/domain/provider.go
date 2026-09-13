package domain

import (
	"errors"
	"strings"
	"time"
)

type Provider struct {
	ID               ID
	OwnerIdentityID  ID
	Name             string
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

func (p Provider) CanReceivePayments() bool {
	if p.PayoutVerifiedAt == nil {
		return false
	}
	_, err := NewWalletAddress(string(p.PayoutWallet))
	return err == nil
}
