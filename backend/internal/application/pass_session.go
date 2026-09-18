package application

import (
	"context"
	"errors"
	"time"

	"nimpass/backend/internal/domain"
)

// PassSessionStore is the persistence boundary for one pass's sessions.
//
// Every method takes the acting identity and resolves authorisation itself,
// inside the same statement that reads or locks the row. That is deliberate:
// an interface that returned a session and left the caller to decide whether
// the caller may touch it would make every future call site a new chance to
// forget (docs/09-SECURITY.md §37).
type PassSessionStore interface {
	GetPassForActor(context.Context, domain.ID, domain.ID) (domain.PurchasedPass, domain.ViewerRole, error)
	ListPassSessions(context.Context, domain.ID, domain.ID) ([]domain.PassSession, error)
	ListProviderPasses(context.Context, domain.ID, domain.ID, int) ([]domain.PurchasedPass, error)
	ScheduleSession(context.Context, domain.ID, domain.ID, *time.Time, time.Time) (domain.PassSession, error)
	CompleteSession(context.Context, domain.ID, domain.ID, time.Time) (domain.PassSession, domain.PurchasedPass, error)
}

// PassSessionView is one pass with its sessions, as one party sees it.
//
// Both parties get the same pass and the same sessions; `Role` says which
// party is looking, and is the backend's answer rather than something the
// screen works out for itself.
type PassSessionView struct {
	Pass     domain.PurchasedPass
	Role     domain.ViewerRole
	Sessions []domain.PassSession
}

// PassSessions is the shared session surface for a purchased pass.
//
// "Shared" is the whole point of the service. There is one set of session
// records per pass; the buyer and the provider read the same rows and write to
// the same rows, so a session the provider marks delivered is the same session
// the buyer sees as Completed on their next read. No local copy of session
// state exists on either side to drift (docs/01-PRODUCT.md §33 "Shared
// State").
type PassSessions struct {
	Store PassSessionStore
	Now   func() time.Time
}

// View reads a pass and its sessions for whichever party is asking.
func (s PassSessions) View(ctx context.Context, actor Identity, passID domain.ID) (PassSessionView, error) {
	pass, role, err := s.Store.GetPassForActor(ctx, passID, actor.ID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return PassSessionView{}, ErrPassNotFound
		}
		return PassSessionView{}, err
	}
	sessions, err := s.Store.ListPassSessions(ctx, passID, actor.ID)
	if err != nil {
		return PassSessionView{}, err
	}
	return PassSessionView{Pass: pass, Role: role, Sessions: sessions}, nil
}

// ProviderPasses lists the passes sold from one provider's catalogue.
func (s PassSessions) ProviderPasses(ctx context.Context, actor Identity, providerID domain.ID, limit int) ([]domain.PurchasedPass, error) {
	if limit <= 0 {
		limit = 50
	}
	return s.Store.ListProviderPasses(ctx, providerID, actor.ID, limit)
}

// Schedule sets or clears one session's date. `at` nil clears it.
func (s PassSessions) Schedule(ctx context.Context, actor Identity, sessionID domain.ID, at *time.Time) (domain.PassSession, error) {
	session, err := s.Store.ScheduleSession(ctx, sessionID, actor.ID, at, s.Now().UTC())
	if errors.Is(err, ErrNotFound) {
		// A session belonging to somebody else's pass is not a session this
		// account may learn about. Same answer as one that does not exist.
		return session, ErrPassNotFound
	}
	return session, err
}

// Complete records one delivered session.
//
// Reserved to the provider. The owner's route to spending a session is the
// wallet-signed redemption, where the signature is the proof that the person
// holding the pass meant to use it (DECISIONS.md ADR-007); both paths end in
// the same transactional write, so the counter and the records agree whoever
// started it.
func (s PassSessions) Complete(ctx context.Context, actor Identity, sessionID domain.ID) (domain.PassSession, domain.PurchasedPass, error) {
	session, pass, err := s.Store.CompleteSession(ctx, sessionID, actor.ID, s.Now().UTC())
	if errors.Is(err, ErrNotFound) {
		return session, pass, ErrPassNotFound
	}
	return session, pass, err
}
