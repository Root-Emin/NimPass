package domain

import (
	"errors"
	"time"
)

// PassSessionStatus is the standing of one session on a purchased pass.
//
// The lifecycle is deliberately not a straight line. A session may be
// scheduled and unscheduled any number of times while it is open, because
// people move appointments; it may be completed from either open state,
// because a session can happen without ever being put in the app. Only
// COMPLETED and CANCELLED are terminal, and only COMPLETED spends a session.
type PassSessionStatus string

const (
	PassSessionUnscheduled PassSessionStatus = "UNSCHEDULED"
	PassSessionScheduled   PassSessionStatus = "SCHEDULED"
	PassSessionCompleted   PassSessionStatus = "COMPLETED"
	PassSessionCancelled   PassSessionStatus = "CANCELLED"
)

// PassSessionActor records who marked a session delivered.
//
// It is an audit fact, never a permission: whether an actor *may* complete a
// session is decided against the pass's owner and provider identities before
// this value is written.
type PassSessionActor string

const (
	PassSessionByOwner    PassSessionActor = "OWNER"
	PassSessionByProvider PassSessionActor = "PROVIDER"
)

// MaxSessionSchedulingHorizon bounds how far ahead a session may be placed.
//
// Not a product rule so much as an input bound: a date ten thousand years out
// is not a plan, and rejecting it here keeps an obviously wrong value from
// being persisted and rendered as if it meant something.
const MaxSessionSchedulingHorizon = 5 * 365 * 24 * time.Hour

var (
	ErrSessionNotOpen       = errors.New("session is already completed or cancelled")
	ErrSessionScheduleRange = errors.New("session date is outside the accepted range")
	// ErrTooManySessions refuses to build a session list larger than a Pass may
	// be sold with. See MaxSessionsPerPass.
	ErrTooManySessions = errors.New("pass has more sessions than the maximum")
)

// PassSession is one session of a purchased pass.
//
// Sessions are created with the pass, all of them, numbered 1..N. They are
// never added and never removed: N is the number the customer paid for, and
// the pass's own `used + remaining = original` invariant is stated against it.
type PassSession struct {
	ID              ID
	PurchasedPassID ID
	SequenceNumber  int32
	Status          PassSessionStatus
	ScheduledAt     *time.Time
	CompletedAt     *time.Time
	CompletedBy     PassSessionActor
	RedemptionID    ID
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// NewPassSessions builds the full set of sessions a purchased pass starts with.
//
// Called from the same transaction that creates the pass, so a pass can never
// exist with a partial or absent session set.
func NewPassSessions(passID ID, count SessionCount, now time.Time, newID func() (ID, error)) ([]PassSession, error) {
	if _, err := ParseID(string(passID)); err != nil {
		return nil, err
	}
	if count <= 0 || now.IsZero() {
		return nil, errors.New("pass sessions require a positive count and a creation time")
	}
	// Checked here as well as at the Pass form, and checked *before* the
	// allocation below rather than after it.
	//
	// `NewSessionCount` is the gate a catalogue Pass passes through, but this
	// function takes a `SessionCount` and a SessionCount can also be read off
	// a row or built by a struct literal. The value that reaches `make` is
	// therefore not always one this process validated, and `make` is the
	// expensive step: a count in the billions is hundreds of gigabytes of
	// capacity and a fatal out-of-memory before a single row is written.
	// Refusing first costs one comparison and makes the allocation unreachable.
	if count > MaxSessionsPerPass {
		return nil, ErrTooManySessions
	}
	sessions := make([]PassSession, 0, int(count))
	for n := int32(1); n <= int32(count); n++ {
		id, err := newID()
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, PassSession{
			ID: id, PurchasedPassID: passID, SequenceNumber: n,
			Status: PassSessionUnscheduled, CreatedAt: now.UTC(), UpdatedAt: now.UTC(),
		})
	}
	return sessions, nil
}

func (s PassSession) IsOpen() bool {
	return s.Status == PassSessionUnscheduled || s.Status == PassSessionScheduled
}

// Schedule places an open session at a date, or clears it with a nil date.
//
// Clearing is a first-class operation rather than an omission: a session whose
// date was removed reads "Not scheduled", which is the honest answer and the
// one the customer needs when a provider cancels a slot.
func (s *PassSession) Schedule(at *time.Time, now time.Time) error {
	if now.IsZero() {
		return errors.New("invalid scheduling time")
	}
	if !s.IsOpen() {
		return ErrSessionNotOpen
	}
	if at == nil {
		s.Status = PassSessionUnscheduled
		s.ScheduledAt = nil
		s.UpdatedAt = now.UTC()
		return nil
	}
	when := at.UTC()
	// Past dates are accepted — a session is often recorded after it happened —
	// but not ones outside any plausible pass lifetime in either direction.
	if when.Before(now.UTC().Add(-MaxSessionSchedulingHorizon)) || when.After(now.UTC().Add(MaxSessionSchedulingHorizon)) {
		return ErrSessionScheduleRange
	}
	s.Status = PassSessionScheduled
	s.ScheduledAt = &when
	s.UpdatedAt = now.UTC()
	return nil
}

// Complete marks one session delivered.
//
// It refuses a session that is not open, which is the in-memory half of
// "one session cannot be completed twice". The other half — the half that
// actually holds under concurrency — is the conditional UPDATE and the row
// lock in the repository; this method never claims to provide it.
func (s *PassSession) Complete(by PassSessionActor, redemptionID ID, now time.Time) error {
	if now.IsZero() {
		return errors.New("invalid completion time")
	}
	if by != PassSessionByOwner && by != PassSessionByProvider {
		return errors.New("unknown session completion actor")
	}
	if !s.IsOpen() {
		return ErrSessionNotOpen
	}
	completed := now.UTC()
	s.Status = PassSessionCompleted
	s.CompletedAt = &completed
	s.CompletedBy = by
	s.RedemptionID = redemptionID
	s.UpdatedAt = completed
	return nil
}

// NextOpenSession is the session a signed redemption spends.
//
// Lowest sequence number first, so a pass is used in the order it was sold.
// Scheduled and unscheduled compete on the same footing: the customer signing
// right now is using *a* session, and the earliest open one is the one the
// timeline will read most sensibly.
func NextOpenSession(sessions []PassSession) (PassSession, bool) {
	var best PassSession
	found := false
	for _, session := range sessions {
		if !session.IsOpen() {
			continue
		}
		if !found || session.SequenceNumber < best.SequenceNumber {
			best, found = session, true
		}
	}
	return best, found
}

// CountCompleted is the number of sessions the records say were delivered.
//
// The purchased pass carries its own `UsedSessions` counter, written under the
// same lock; this exists so a caller can assert the two agree rather than
// assume it.
func CountCompleted(sessions []PassSession) int32 {
	var total int32
	for _, session := range sessions {
		if session.Status == PassSessionCompleted {
			total++
		}
	}
	return total
}
