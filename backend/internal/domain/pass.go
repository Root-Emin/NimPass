package domain

import (
	"errors"
	"time"
)

type PassStatus string

const (
	PassActive    PassStatus = "ACTIVE"
	PassCompleted PassStatus = "COMPLETED"
	PassExpired   PassStatus = "EXPIRED"
	PassCancelled PassStatus = "CANCELLED"
)

type Pass struct {
	ID                ID
	PurchaseID        ID
	OwnerWallet       WalletAddress
	Snapshot          PurchaseSnapshot
	OriginalSessions  SessionCount
	UsedSessions      int32
	RemainingSessions int32
	Status            PassStatus
	CreatedAt         time.Time
	ExpiresAt         *time.Time
	CompletedAt       *time.Time
}

func NewPass(id ID, purchase Purchase) (Pass, error) {
	if _, err := ParseID(string(id)); err != nil {
		return Pass{}, err
	}
	if purchase.Status != PurchaseConfirmed || purchase.VerifiedSender == "" || purchase.ConfirmedAt == nil {
		return Pass{}, errors.New("pass requires a confirmed verified purchase")
	}
	expiresAt, err := purchase.Snapshot.Expiration.Resolve(*purchase.ConfirmedAt)
	if err != nil {
		return Pass{}, err
	}
	pass := Pass{
		ID: id, PurchaseID: purchase.ID, OwnerWallet: purchase.VerifiedSender,
		Snapshot: purchase.Snapshot.clone(), OriginalSessions: purchase.Snapshot.Sessions,
		RemainingSessions: int32(purchase.Snapshot.Sessions), Status: PassActive,
		CreatedAt: purchase.ConfirmedAt.UTC(), ExpiresAt: expiresAt,
	}
	return pass, pass.Validate()
}

func (p Pass) Validate() error {
	switch p.Status {
	case PassActive, PassCompleted, PassExpired, PassCancelled:
	default:
		return errors.New("invalid pass status")
	}
	if p.OriginalSessions <= 0 || p.UsedSessions < 0 || p.RemainingSessions < 0 ||
		p.UsedSessions+p.RemainingSessions != int32(p.OriginalSessions) {
		return errors.New("pass session invariant violated")
	}
	if p.Status == PassCompleted && p.RemainingSessions != 0 {
		return errors.New("completed pass must have zero remaining sessions")
	}
	if p.Status == PassActive && p.RemainingSessions == 0 {
		return errors.New("active pass must have remaining sessions")
	}
	if p.Status == PassExpired && p.ExpiresAt == nil {
		return errors.New("expired pass requires expiration date")
	}
	return nil
}

func (p *Pass) ConsumeSession(now time.Time) error {
	if err := p.Validate(); err != nil {
		return err
	}
	if p.Status != PassActive || p.RemainingSessions == 0 {
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
		p.Status = PassCompleted
		completed := now.UTC()
		p.CompletedAt = &completed
	}
	return p.Validate()
}

func (p *Pass) ExpireIfDue(now time.Time) bool {
	if p.Status != PassActive || p.ExpiresAt == nil || now.Before(*p.ExpiresAt) {
		return false
	}
	p.Status = PassExpired
	return true
}
