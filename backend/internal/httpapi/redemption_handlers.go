package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

func redemptionDTO(view application.RedemptionView, includeQR bool) map[string]any {
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
		"redemption":          nil,
		"redemptionReference": nil,
		"qrExpiresAt":         nil,
	}
	if includeQR && view.QRReference != "" && challenge.Status == domain.RedemptionAuthorized {
		result["redemptionReference"] = view.QRReference
		result["qrExpiresAt"] = view.QRExpiresAt
	}
	if view.HasRedemption {
		result["redemption"] = map[string]any{
			"id":             view.Redemption.ID,
			"sessionOrdinal": view.Redemption.SessionOrdinal,
			"redeemedAt":     view.Redemption.ConsumedAt,
		}
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
			"packageId":      item.PackageID,
			"sessionOrdinal": item.SessionOrdinal,
			"ownerWallet":    item.OwnerWallet,
			"redeemedAt":     item.ConsumedAt,
			"status":         "CONSUMED",
		})
	}
	return out
}

func redemptionLookupDTO(lookup application.RedemptionLookup) map[string]any {
	return map[string]any{
		"challengeId":         lookup.ChallengeID,
		"passId":              lookup.PassID,
		"providerId":          lookup.ProviderID,
		"serviceName":         lookup.ServiceName,
		"packageTitle":        lookup.PackageTitle,
		"challengeStatus":     lookup.ChallengeStatus,
		"authorizationStatus": lookup.AuthorizationStatus,
		"passStatus":          lookup.PassStatus,
		"usedSessions":        lookup.UsedSessions,
		"remainingSessions":   lookup.RemainingSessions,
		"nextSessionOrdinal":  lookup.NextSessionOrdinal,
		"passExpiresAt":       lookup.PassExpiresAt,
		"challengeExpiresAt":  lookup.ChallengeExpiresAt,
		"referenceExpiresAt":  lookup.ReferenceExpiresAt,
	}
}

func (h *handler) createRedemptionChallenge(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	if !h.limits.Allow("redemption-create:"+string(s.Identity.ID), 10, 5*time.Minute) {
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
	respond(w, http.StatusOK, redemptionDTO(view, true))
}

func (h *handler) currentRedemptionChallenge(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	passID, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	view, err := h.redemptions.Store.CurrentChallenge(r.Context(), passID, s.Identity.ID, domain.WalletAddress(s.Identity.Wallet), time.Now().UTC())
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, http.StatusOK, redemptionDTO(view, false))
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
	respond(w, http.StatusOK, redemptionDTO(view, false))
}

func (h *handler) authorizeRedemption(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	if !h.limits.Allow("redemption-authorize:"+string(s.Identity.ID), 20, 5*time.Minute) {
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
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.PublicKey) != 64 || len(req.Signature) != 128 || strings.ContainsAny(req.PublicKey+req.Signature, " \r\n\t") {
		apiFailure(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid redemption signature fields")
		return
	}
	view, err := h.redemptions.Authorize(r.Context(), s.Identity, id, req.PublicKey, req.Signature)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, http.StatusOK, redemptionDTO(view, true))
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

func (h *handler) confirmRedemption(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	if !h.limits.Allow("redemption-confirm:"+string(s.Identity.ID), 30, 5*time.Minute) {
		apiFailure(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Too many redemption confirmations")
		return
	}
	providerID, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	var req struct {
		RedemptionReference string `json:"redemptionReference"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	view, err := h.redemptions.Confirm(r.Context(), s.Identity, providerID, req.RedemptionReference)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{
		"redemptionId":      view.Redemption.ID,
		"passId":            view.Pass.ID,
		"redeemedAt":        view.Redemption.ConsumedAt,
		"usedSessions":      view.Pass.UsedSessions,
		"remainingSessions": view.Pass.RemainingSessions,
		"passStatus":        view.Pass.Status,
		"completed":         view.Pass.Status == domain.PassCompleted,
	})
}

func (h *handler) lookupRedemption(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	if !h.limits.Allow("redemption-lookup:"+string(s.Identity.ID), 30, 5*time.Minute) {
		apiFailure(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Too many redemption lookups")
		return
	}
	providerID, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	var req struct {
		RedemptionReference string `json:"redemptionReference"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	lookup, err := h.redemptions.Lookup(r.Context(), s.Identity, providerID, req.RedemptionReference)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, http.StatusOK, redemptionLookupDTO(lookup))
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
