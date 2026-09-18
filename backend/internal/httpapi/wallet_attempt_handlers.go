package httpapi

import (
	"github.com/go-chi/chi/v5"
	"net/http"
	"time"
)

func (h *handler) beginWalletAttempt(w http.ResponseWriter, r *http.Request) {
	id, ok := h.purchaseID(w, r)
	if !ok {
		return
	}
	if !h.allow(r, "wallet-attempt:"+string(sessionFrom(r).Identity.ID), 20, time.Minute) {
		apiFailure(w, r, 429, "RATE_LIMITED", "Too many wallet attempts")
		return
	}
	var req struct {
		AttemptID string `json:"attemptId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	attempt, ok := parsedID(w, r, req.AttemptID)
	if !ok {
		return
	}
	p, err := h.payments.Store.BeginWalletAttempt(r.Context(), id, sessionFrom(r).Identity.ID, attempt, time.Now().UTC())
	if err != nil {
		h.paymentError(w, r, err)
		return
	}
	respond(w, 201, purchaseDTO(p, time.Now().UTC()))
}

func (h *handler) releaseWalletAttempt(w http.ResponseWriter, r *http.Request) {
	id, ok := h.purchaseID(w, r)
	if !ok {
		return
	}
	attempt, ok := parsedID(w, r, chi.URLParam(r, "attemptID"))
	if !ok {
		return
	}
	if err := h.payments.Store.ReleaseWalletAttempt(r.Context(), id, sessionFrom(r).Identity.ID, attempt); err != nil {
		h.paymentError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
