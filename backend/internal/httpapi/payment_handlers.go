package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

func purchaseDTO(r application.PurchaseRecord, now time.Time) map[string]any {
	p := r.Purchase
	status := "awaiting_payment"
	switch {
	case p.Status == domain.PurchaseConfirmed && r.PassID != "":
		status = "completed"
	case p.Status == domain.PurchaseConfirmed:
		status = "pass_provisioning"
	case p.Status == domain.PurchaseCompensationRequired:
		status = "compensation_required"
	case p.Status == domain.PurchaseCancelled:
		status = "cancelled"
	case p.Status == domain.PurchaseFailed || r.CandidateStatus == "MISMATCH":
		status = "permanently_failed"
	case r.CandidateHash == "" && !now.Before(p.ExpiresAt):
		status = "expired"
	case r.CandidateStatus == "UNCERTAIN" || r.CandidateStatus == "NOT_FOUND":
		status = "uncertain_retryable"
	case r.CandidateStatus == "AWAITING_FINALITY" || p.Status == domain.PurchaseAwaitingFinality:
		status = "awaiting_finality"
	case p.Status == domain.PurchaseVerifying && r.CandidateStatus == "SUBMITTED":
		status = "verifying"
	case r.CandidateHash != "":
		status = "transaction_submitted"
	}
	result := map[string]any{"purchaseIntentId": p.ID, "status": status, "purchaseStatus": p.Status, "packageId": p.Snapshot.PackageID, "packageTitle": p.Snapshot.PackageTitle, "serviceId": p.Snapshot.ServiceID, "providerId": p.Snapshot.ProviderID, "sessions": p.Snapshot.Sessions, "priceLuna": p.Snapshot.PriceLuna, "customerWallet": p.ExpectedWallet, "createdAt": p.CreatedAt, "expiresAt": p.ExpiresAt, "transactionHash": nullableJSON(r.CandidateHash), "broadcastObservedAt": r.BroadcastObservedAt, "paymentVerification": nullableJSON(r.CandidateStatus), "failureCategory": nullableJSON(r.FailureCategory), "passId": nullableJSON(string(r.PassID)), "compensation": nil}
	if p.Status == domain.PurchaseCompensationRequired {
		result["compensation"] = map[string]any{"status": r.CompensationStatus, "reason": r.CompensationReason, "createdAt": r.CompensationAt, "message": "Payment received, but this package expired before the pass could be activated. Do not pay again.", "doNotPayAgain": true, "automatedRefund": false}
	}
	if status == "awaiting_payment" {
		result["paymentRequest"] = map[string]any{"recipient": p.Snapshot.Recipient, "valueLuna": p.Snapshot.PriceLuna, "data": p.PaymentReference, "network": p.Snapshot.Network, "expiresAt": p.ExpiresAt}
	} else {
		result["paymentRequest"] = nil
	}
	return result
}

func nullableJSON(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (h *handler) paymentError(w http.ResponseWriter, r *http.Request, err error) {
	switch err {
	case application.ErrValidation:
		apiFailure(w, r, 400, "VALIDATION_ERROR", "Invalid payment request")
	case application.ErrExpired:
		apiFailure(w, r, 410, "INTENT_EXPIRED", "Purchase intent expired")
	case application.ErrConflict:
		apiFailure(w, r, 409, "PAYMENT_CONFLICT", "Payment state conflict")
	case application.ErrPurchaseCutoff:
		apiFailure(w, r, 409, "PACKAGE_PURCHASE_CUTOFF", "This package is too close to expiration for a new purchase")
	default:
		mappedError(w, r, err)
	}
}

func (h *handler) createPurchase(w http.ResponseWriter, r *http.Request) {
	if !h.limits.Allow("purchase-create:"+string(sessionFrom(r).Identity.ID), 20, time.Minute) {
		apiFailure(w, r, 429, "RATE_LIMITED", "Too many purchase requests")
		return
	}
	var req struct {
		PackageID string `json:"packageId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	packageID, ok := parsedID(w, r, req.PackageID)
	if !ok {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) > 128 || strings.TrimSpace(key) != key || strings.ContainsAny(key, "\r\n\t ") {
		apiFailure(w, r, 400, "VALIDATION_ERROR", "Invalid idempotency key")
		return
	}
	p, reused, err := h.payments.Create(r.Context(), sessionFrom(r).Identity, packageID, key)
	if err != nil {
		h.paymentError(w, r, err)
		return
	}
	status := http.StatusCreated
	if reused {
		status = http.StatusOK
	}
	respond(w, status, purchaseDTO(p, time.Now().UTC()))
}

func (h *handler) listPurchases(w http.ResponseWriter, r *http.Request) {
	items, err := h.payments.Store.List(r.Context(), sessionFrom(r).Identity.ID)
	if err != nil {
		h.paymentError(w, r, err)
		return
	}
	out := make([]any, 0, len(items))
	now := time.Now().UTC()
	for _, item := range items {
		out = append(out, purchaseDTO(item, now))
	}
	respond(w, 200, map[string]any{"items": out})
}

func (h *handler) purchaseID(w http.ResponseWriter, r *http.Request) (domain.ID, bool) {
	return parsedID(w, r, chi.URLParam(r, "purchaseID"))
}

func (h *handler) getPurchase(w http.ResponseWriter, r *http.Request) {
	id, ok := h.purchaseID(w, r)
	if !ok {
		return
	}
	p, err := h.payments.Store.Get(r.Context(), id, sessionFrom(r).Identity.ID)
	if err != nil {
		h.paymentError(w, r, err)
		return
	}
	respond(w, 200, purchaseDTO(p, time.Now().UTC()))
}

func (h *handler) submitTransaction(w http.ResponseWriter, r *http.Request) {
	if !h.limits.Allow("payment-submit:"+string(sessionFrom(r).Identity.ID), 30, time.Minute) {
		apiFailure(w, r, 429, "RATE_LIMITED", "Too many payment submissions")
		return
	}
	id, ok := h.purchaseID(w, r)
	if !ok {
		return
	}
	var req struct {
		TxHash string `json:"txHash"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	p, err := h.payments.Submit(r.Context(), sessionFrom(r).Identity, id, req.TxHash)
	if err != nil {
		h.paymentError(w, r, err)
		return
	}
	respond(w, 202, purchaseDTO(p, time.Now().UTC()))
}

func (h *handler) reconcilePurchase(w http.ResponseWriter, r *http.Request) {
	if !h.limits.Allow("payment-reconcile:"+string(sessionFrom(r).Identity.ID), 30, time.Minute) {
		apiFailure(w, r, 429, "RATE_LIMITED", "Too many reconciliation requests")
		return
	}
	id, ok := h.purchaseID(w, r)
	if !ok {
		return
	}
	p, err := h.payments.Reconcile(r.Context(), sessionFrom(r).Identity, id)
	if err != nil {
		h.paymentError(w, r, err)
		return
	}
	respond(w, 200, purchaseDTO(p, time.Now().UTC()))
}

func (h *handler) cancelPurchase(w http.ResponseWriter, r *http.Request) {
	id, ok := h.purchaseID(w, r)
	if !ok {
		return
	}
	p, err := h.payments.Store.Cancel(r.Context(), id, sessionFrom(r).Identity.ID, time.Now().UTC())
	if err != nil {
		h.paymentError(w, r, err)
		return
	}
	respond(w, 200, purchaseDTO(p, time.Now().UTC()))
}

func (h *handler) getPass(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	p, err := h.payments.Store.GetPass(r.Context(), id, sessionFrom(r).Identity.ID)
	if err != nil {
		h.paymentError(w, r, err)
		return
	}
	respond(w, 200, map[string]any{"id": p.ID, "purchaseId": p.PurchaseID, "ownerWallet": p.OwnerWallet, "packageId": p.Snapshot.PackageID, "packageTitle": p.Snapshot.PackageTitle, "serviceId": p.Snapshot.ServiceID, "providerId": p.Snapshot.ProviderID, "originalSessions": p.OriginalSessions, "usedSessions": p.UsedSessions, "remainingSessions": p.RemainingSessions, "status": p.Status, "createdAt": p.CreatedAt, "expiresAt": p.ExpiresAt})
}
