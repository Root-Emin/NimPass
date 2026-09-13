package domain

import (
	"errors"
	"time"
)

type Identity struct {
	ID        ID
	Wallet    WalletAddress
	CreatedAt time.Time
}

func NewIdentity(id ID, wallet WalletAddress, now time.Time) (Identity, error) {
	if _, err := ParseID(string(id)); err != nil || now.IsZero() {
		return Identity{}, errors.New("identity requires valid ID, wallet and creation time")
	}
	normalized, err := NewWalletAddress(string(wallet))
	if err != nil {
		return Identity{}, err
	}
	return Identity{ID: id, Wallet: normalized, CreatedAt: now.UTC()}, nil
}
