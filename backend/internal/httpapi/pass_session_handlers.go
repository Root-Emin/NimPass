package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

// The session surface: one pass's sessions, shared by its two parties.
//
// Every route here resolves the acting identity against the pass itself, in
// the application/repository layer, and answers 404 for an account that is
// neither the owner nor the provider. Knowing a session id grants nothing
// (docs/09-SECURITY.md §37).

func passSessionDTO(s domain.PassSession) map[string]any {
	return map[string]any{
		"id":             s.ID,
		"passId":         s.PurchasedPassID,
		"sequenceNumber": s.SequenceNumber,
		"status":         s.Status,
		"scheduledAt":    s.ScheduledAt,
		"completedAt":    s.CompletedAt,
		"completedBy":    nullableJSON(string(s.CompletedBy)),
		"redemptionId":   nullableJSON(string(s.RedemptionID)),
		"createdAt":      s.CreatedAt,
		"updatedAt":      s.UpdatedAt,
	}
}

func passSessionsDTO(sessions []domain.PassSession) []any {
	out := make([]any, 0, len(sessions))
	for _, s := range sessions {
		out = append(out, passSessionDTO(s))
	}
	return out
}

func (h *handler) sessionError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case err == application.ErrValidation:
		apiFailure(w, r, 400, "VALIDATION_ERROR", "Invalid session request")
	default:
		mappedError(w, r, err)
	}
}

// listPassSessions serves the timeline both parties read.
func (h *handler) listPassSessions(w http.ResponseWriter, r *http.Request) {
	passID, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	view, err := h.passSessions.View(r.Context(), sessionFrom(r).Identity, passID)
	if err != nil {
		h.sessionError(w, r, err)
		return
	}
	respond(w, 200, map[string]any{
		"passId":            view.Pass.ID,
		"role":              view.Role,
		"pass":              passDTO(view.Pass, view.Role),
		"items":             passSessionsDTO(view.Sessions),
		"totalSessions":     view.Pass.OriginalSessions,
		"completedSessions": view.Pass.UsedSessions,
		"remainingSessions": view.Pass.RemainingSessions,
	})
}

// listProviderPurchasedPasses is the provider's side of the same data: which
// customers hold a pass bought from this provider's catalogue.
func (h *handler) listProviderPurchasedPasses(w http.ResponseWriter, r *http.Request) {
	providerID, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			apiFailure(w, r, 400, "VALIDATION_ERROR", "Invalid limit")
			return
		}
		limit = parsed
	}
	items, err := h.passSessions.ProviderPasses(r.Context(), sessionFrom(r).Identity, providerID, limit)
	if err != nil {
		h.sessionError(w, r, err)
		return
	}
	out := make([]any, 0, len(items))
	for _, pass := range items {
		out = append(out, passDTO(pass, domain.ViewerProvider))
	}
	respond(w, 200, map[string]any{"items": out})
}

// scheduleSession sets or clears one session's date.
//
// `scheduledAt: null` is a real instruction — "this no longer has a date" —
// and is why the body uses an explicit pointer rather than treating an absent
// field as a clear. A request that omits the field entirely is a malformed
// request, not a silent unschedule.
func (h *handler) scheduleSession(w http.ResponseWriter, r *http.Request) {
	sessionID, ok := parsedID(w, r, chi.URLParam(r, "sessionID"))
	if !ok {
		return
	}
	if !h.allow(r, "session-schedule:"+string(sessionFrom(r).Identity.ID), 60, time.Minute) {
		apiFailure(w, r, 429, "RATE_LIMITED", "Too many scheduling requests")
		return
	}
	var req struct {
		ScheduledAt *string `json:"scheduledAt"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	var at *time.Time
	if req.ScheduledAt != nil {
		parsed, err := time.Parse(time.RFC3339, *req.ScheduledAt)
		if err != nil {
			apiFailure(w, r, 400, "VALIDATION_ERROR", "scheduledAt must be an RFC 3339 timestamp or null")
			return
		}
		utc := parsed.UTC()
		at = &utc
	}
	session, err := h.passSessions.Schedule(r.Context(), sessionFrom(r).Identity, sessionID, at)
	if err != nil {
		h.sessionError(w, r, err)
		return
	}
	respond(w, 200, passSessionDTO(session))
}

// completeSession records that one session was delivered.
//
// Provider-only, and refused with 403 for the owner: an owner spends a session
// by signing it in their wallet, which is the proof ADR-007 is built on. The
// response carries the pass as well as the session, because the number the
// customer cares about — how many are left — changed in the same transaction
// and must not be recomputed by the caller.
func (h *handler) completeSession(w http.ResponseWriter, r *http.Request) {
	sessionID, ok := parsedID(w, r, chi.URLParam(r, "sessionID"))
	if !ok {
		return
	}
	if !h.allow(r, "session-complete:"+string(sessionFrom(r).Identity.ID), 60, time.Minute) {
		apiFailure(w, r, 429, "RATE_LIMITED", "Too many session completions")
		return
	}
	session, pass, err := h.passSessions.Complete(r.Context(), sessionFrom(r).Identity, sessionID)
	if err != nil {
		h.sessionError(w, r, err)
		return
	}
	respond(w, 200, map[string]any{"session": passSessionDTO(session), "pass": passDTO(pass, domain.ViewerProvider)})
}
