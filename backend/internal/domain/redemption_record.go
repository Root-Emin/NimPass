package domain

import (
	"errors"
	"time"
)

// Redemption is the immutable audit fact produced after one authorized session
// consumption. The application layer must persist it with the pass/challenge
// changes in the same PostgreSQL transaction.
type Redemption struct {
	ID             ID
	ChallengeID    ID
	PassID         ID
	ProviderID     ID
	OwnerWallet    WalletAddress
	SessionOrdinal SessionCount
	ConsumedAt     time.Time
}

func NewRedemption(id ID, challenge RedemptionChallenge, pass Pass) (Redemption, error) {
	if _, err := ParseID(string(id)); err != nil {
		return Redemption{}, err
	}
	if challenge.Status != RedemptionConsumed || challenge.ConsumedAt == nil ||
		challenge.PassID != pass.ID || challenge.ProviderID != pass.Snapshot.ProviderID ||
		challenge.OwnerWallet != pass.OwnerWallet || pass.UsedSessions <= 0 {
		return Redemption{}, errors.New("redemption requires matching consumed challenge and pass")
	}
	return Redemption{
		ID: id, ChallengeID: challenge.ID, PassID: pass.ID,
		ProviderID: challenge.ProviderID, OwnerWallet: challenge.OwnerWallet,
		SessionOrdinal: SessionCount(pass.UsedSessions), ConsumedAt: challenge.ConsumedAt.UTC(),
	}, nil
}
