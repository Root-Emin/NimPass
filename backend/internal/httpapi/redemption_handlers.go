package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"nimpass/backend/internal/application"
)

func redemptionDTO(view application.RedemptionView) map[string]any {
	challenge := view.Challenge
	result := map[string]any{
		"challengeId":  challenge.ID,
		"passId":       challenge.PassID,
		"providerId":   challenge.ProviderID,
		"purpose":      challenge.Purpose,
		"status":       challenge.Status,
		"message":      string(challenge.SigningMessage()),
		"createdAt":    challenge.CreatedAt,
		"expiresAt":    challenge.ExpiresAt,
		"authorizedAt": challenge.AuthorizedAt,
		"consumedAt":   challenge.ConsumedAt,
		"pass": map[string]any{
			"status":            view.Pass.Status,
			"originalSessions":  view.Pass.OriginalSessions,
			"usedSessions":      view.Pass.UsedSessions,
			"remainingSessions": view.Pass.RemainingSessions,
			"expiresAt":         view.Pass.ExpiresAt,
		},
		"redemption": nil,
		// The session this authorization spent, so the screen can say which
		// one moved rather than only that the count went down.
		"session": nil,
	}
	if view.HasRedemption {
		result["redemption"] = map[string]any{
			"id":             view.Redemption.ID,
			"sessionOrdinal": view.Redemption.SessionOrdinal,
			"redeemedAt":     view.Redemption.ConsumedAt,
		}
	}
	if view.HasSession {
		result["session"] = passSessionDTO(view.Session)
	}
	return result
}

func historyDTO(items []application.RedemptionHistoryItem) []any {
	out := make([]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"redemptionId":   item.RedemptionID,
			"challengeId":    item.ChallengeID,
			"passId":         item.PassID,
			"providerId":     item.ProviderID,
			"serviceId":      item.ServiceID,
			"sourcePassId":   item.SourcePassID,
			"sessionOrdinal": item.SessionOrdinal,
			"ownerWallet":    item.OwnerWallet,
			"redeemedAt":     item.ConsumedAt,
			"status":         "CONSUMED",
		})
	}
	return out
}

func (h *handler) createRedemptionChallenge(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	if !h.allow(r, "redemption-create:"+string(s.Identity.ID), 10, 5*time.Minute) {
		apiFailure(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Too many redemption challenges")
		return
	}
	passID, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	view, err := h.redemptions.CreateChallenge(r.Context(), s.Identity, passID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, http.StatusOK, redemptionDTO(view))
}

func (h *handler) currentRedemptionChallenge(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	passID, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	view, err := h.redemptions.CurrentChallenge(r.Context(), s.Identity, passID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, http.StatusOK, redemptionDTO(view))
}

func (h *handler) getRedemptionChallenge(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	id, ok := parsedID(w, r, chi.URLParam(r, "challengeID"))
	if !ok {
		return
	}
	view, err := h.redemptions.GetChallenge(r.Context(), s.Identity, id)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, http.StatusOK, redemptionDTO(view))
}

func (h *handler) authorizeRedemption(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	if !h.allow(r, "redemption-authorize:"+string(s.Identity.ID), 20, 5*time.Minute) {
		apiFailure(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Too many redemption authorization attempts")
		return
	}
	id, ok := parsedID(w, r, chi.URLParam(r, "challengeID"))
	if !ok {
		return
	}
	var req struct {
		PublicKey string `json:"publicKey"`
		Signature string `json:"signature"`
		// Which documented preprocessing produced the signature, or empty for
		// the deployment's configured scheme. Named per authorization rather
		// than per challenge: a challenge created inside Nimiq Pay can be
		// signed in a browser after a reload, and the scheme belongs to the
		// wallet that produced the bytes.
		SigningScheme string `json:"signingScheme,omitempty"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.PublicKey) != 64 || len(req.Signature) != 128 || strings.ContainsAny(req.PublicKey+req.Signature, " \r\n\t") {
		apiFailure(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid redemption signature fields")
		return
	}
	if !validSigningScheme(req.SigningScheme) {
		apiFailure(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Unsupported signing scheme")
		return
	}
	view, err := h.redemptions.Authorize(r.Context(), s.Identity, id, req.PublicKey, req.Signature, req.SigningScheme)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, http.StatusOK, redemptionDTO(view))
}

func (h *handler) listPassRedemptions(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	passID, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	items, err := h.redemptions.PassHistory(r.Context(), s.Identity, passID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{"items": historyDTO(items)})
}

func (h *handler) listProviderRedemptions(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	providerID, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	items, err := h.redemptions.ProviderHistory(r.Context(), s.Identity, providerID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{"items": historyDTO(items)})
}
