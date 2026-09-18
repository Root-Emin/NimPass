package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// settlementDTO exposes how permanent the payment behind a purchase is.
//
// Separate from `status` on purpose, and the separation is the API's half of
// this whole change. `status` answers the customer's question — did I buy it,
// can I use it — and under the inclusion policy that reaches `completed` while
// the transaction is still a macro block away from irreversible. Folding the
// two into one field is what would produce the ambiguity the mission warns
// about, a purchase that says complete with a payment in an unknown state.
//
// Null before a payment has been accepted. There is no settlement to describe
// until there is a receipt.
func settlementDTO(s *application.Settlement) any {
	if s == nil {
		return nil
	}
	return map[string]any{
		"status":         s.Status,
		"provisional":    s.Provisional(),
		"inclusionBlock": s.InclusionBlock,
		"includedAt":     s.IncludedAt,
		// The macro height being waited for, which is knowable the moment the
		// payment is accepted and is never a claim that it has been produced.
		// `finalityBlock` below is the observed one and stays null until it is.
		"expectedFinalityBlock": s.ExpectedFinalityBlock,
		"finalityBlock":         nullableBlock(s.FinalityBlock),
		"finalizedAt":           s.FinalizedAt,
		"contestedAt":           s.ContestedAt,
		"contestReason":         nullableJSON(s.ContestReason),
	}
}

func nullableBlock(height uint32) any {
	if height == 0 {
		return nil
	}
	return height
}

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
	case r.CandidateHash == "" && r.WalletAttemptPending:
		status = "uncertain_retryable"
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
	result := map[string]any{"purchaseIntentId": p.ID, "status": status, "purchaseStatus": p.Status, "passId": p.Snapshot.PassID, "passTitle": p.Snapshot.PassTitle, "serviceId": p.Snapshot.ServiceID, "providerId": p.Snapshot.ProviderID, "sessions": p.Snapshot.Sessions, "priceLuna": p.Snapshot.PriceLuna, "customerWallet": p.ExpectedWallet, "createdAt": p.CreatedAt, "expiresAt": p.ExpiresAt, "transactionHash": nullableJSON(r.CandidateHash), "broadcastObservedAt": r.BroadcastObservedAt, "paymentVerification": nullableJSON(r.CandidateStatus), "failureCategory": nullableJSON(r.FailureCategory), "purchasedPassId": nullableJSON(string(r.PassID)), "compensation": nil, "settlement": settlementDTO(r.Settlement)}
	if p.Status == domain.PurchaseCompensationRequired {
		message := "Payment received, but this pass expired before it could be activated. Do not pay again."
		if r.CompensationReason == domain.SettlementReversed {
			// The mirror case, and it needs its own words: nothing is owed
			// back, because the payment the Pass was issued against never
			// became part of the chain. Telling this customer "payment
			// received, do not pay again" would be both wrong and the reason
			// they never buy anything.
			message = "This payment did not stay on the Nimiq chain, so the pass was withdrawn. No NIM left your wallet for it — you can buy the pass again."
		}
		result["compensation"] = map[string]any{"status": r.CompensationStatus, "reason": r.CompensationReason, "createdAt": r.CompensationAt, "message": message, "doNotPayAgain": r.CompensationReason != domain.SettlementReversed, "automatedRefund": false}
	}
	if status == "awaiting_payment" {
		request := map[string]any{"recipient": p.Snapshot.Recipient, "valueLuna": p.Snapshot.PriceLuna, "valueNim": p.Snapshot.PriceLuna.NIM(), "data": p.PaymentReference, "network": p.Snapshot.Network, "expiresAt": p.ExpiresAt}
		// The scannable payment request is built here, from the intent's
		// immutable snapshot, and never in the browser. A QR assembled from
		// client state is a QR a client can retarget: encoding it server-side
		// means the address and amount the customer's wallet prepares come from
		// the same row the verifier later compares the chain against
		// (docs/05 §13, §14, §85).
		//
		// Null rather than a guess when the address cannot be encoded. A
		// payment instruction is not a field to improvise.
		if uri, err := nimiq.PaymentRequestURI(string(p.Snapshot.Recipient), p.Snapshot.PriceLuna.NIM(), string(p.PaymentReference)); err == nil {
			request["uri"] = uri
		} else {
			request["uri"] = nil
		}
		result["paymentRequest"] = request
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
	// Checked before the switch below, because it wraps ErrConflict: the status
	// is the same 409 a payment-state conflict gets, but the reason is one the
	// customer can act on — the pass is not for sale, so there is nothing to
	// retry and nothing to pay.
	if errors.Is(err, application.ErrPassUnavailable) {
		apiFailure(w, r, 409, "PASS_UNAVAILABLE", "This pass is no longer available for purchase")
		return
	}
	// Also a wrapped ErrConflict, and also checked before the switch. 409 is
	// right — the customer's own state is what conflicts — and naming it lets
	// the screen send them to the pass they already have instead of showing
	// them a payment error for a payment that was never started.
	if errors.Is(err, application.ErrPassAlreadyOwned) {
		apiFailure(w, r, 409, "PASS_ALREADY_OWNED", "You already own this pass")
		return
	}
	// Also a wrapped ErrConflict, and also ahead of the generic branch. The
	// distinction matters more here than anywhere: this customer may be about
	// to pay for something they have already paid for, and the one thing the
	// screen must not say is "try again".
	if errors.Is(err, application.ErrPurchaseInSettlement) {
		apiFailure(w, r, 409, "PURCHASE_IN_SETTLEMENT", "Your last payment for this pass is still being checked")
		return
	}
	switch err {
	case application.ErrValidation:
		apiFailure(w, r, 400, "VALIDATION_ERROR", "Invalid payment request")
	case application.ErrExpired:
		apiFailure(w, r, 410, "INTENT_EXPIRED", "Purchase intent expired")
	case application.ErrConflict:
		apiFailure(w, r, 409, "PAYMENT_CONFLICT", "Payment state conflict")
	case application.ErrPurchaseCutoff:
		apiFailure(w, r, 409, "PASS_PURCHASE_CUTOFF", "This pass is too close to expiration for a new purchase")
	case application.ErrSelfPurchase:
		// 403 rather than 409: nothing about the pass's state is wrong, and
		// no retry will change the outcome. It is this account that may not
		// make this purchase.
		apiFailure(w, r, 403, "SELF_PURCHASE_NOT_ALLOWED", "You cannot buy a pass you created")
	default:
		mappedError(w, r, err)
	}
}

func (h *handler) createPurchase(w http.ResponseWriter, r *http.Request) {
	if !h.allow(r, "purchase-create:"+string(sessionFrom(r).Identity.ID), 20, time.Minute) {
		apiFailure(w, r, 429, "RATE_LIMITED", "Too many purchase requests")
		return
	}
	var req struct {
		PassID string `json:"passId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	passID, ok := parsedID(w, r, req.PassID)
	if !ok {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) > 128 || strings.TrimSpace(key) != key || strings.ContainsAny(key, "\r\n\t ") {
		apiFailure(w, r, 400, "VALIDATION_ERROR", "Invalid idempotency key")
		return
	}
	p, reused, err := h.payments.Create(r.Context(), sessionFrom(r).Identity, passID, key)
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
	if !h.allow(r, "payment-submit:"+string(sessionFrom(r).Identity.ID), 30, time.Minute) {
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
	if !h.allow(r, "payment-reconcile:"+string(sessionFrom(r).Identity.ID), 30, time.Minute) {
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

// getPass serves one purchased pass to either of its two parties.
//
// It used to be owner-only, which meant a provider had no way to see the pass
// they are contracted to deliver — and therefore no way for the two sides to
// be looking at the same state. The record is unchanged for the owner; the
// provider now reads the same row, and `viewerRole` says which of them asked.
func (h *handler) getPass(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	p, role, err := h.passSessions.Store.GetPassForActor(r.Context(), id, sessionFrom(r).Identity.ID)
	if err != nil {
		h.paymentError(w, r, err)
		return
	}
	respond(w, 200, passDTO(p, role))
}

// passDTO renders one purchased pass.
//
// `viewerRole` is the backend's statement of what the requesting account is to
// this pass — OWNER or PROVIDER. It is sent rather than left to the client to
// work out, because the client working it out is exactly how a screen ends up
// offering a control the server will refuse.
func passDTO(p domain.PurchasedPass, viewerRole domain.ViewerRole) any {
	return map[string]any{"id": p.ID, "purchaseId": p.PurchaseID, "ownerWallet": p.OwnerWallet, "passId": p.Snapshot.PassID, "passTitle": p.Snapshot.PassTitle, "serviceName": p.Snapshot.ServiceName, "providerName": p.Snapshot.ProviderName, "priceLuna": p.Snapshot.PriceLuna, "completedAt": p.CompletedAt, "serviceId": p.Snapshot.ServiceID, "providerId": p.Snapshot.ProviderID, "originalSessions": p.OriginalSessions, "usedSessions": p.UsedSessions, "remainingSessions": p.RemainingSessions, "status": p.Status, "createdAt": p.CreatedAt, "expiresAt": p.ExpiresAt, "viewerRole": viewerRole}
}

func (h *handler) listPasses(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := 20
	for _, key := range []string{"limit", "status", "cursor"} {
		if len(q[key]) > 1 {
			catalogError(w, r, application.ErrValidation)
			return
		}
	}
	if q.Has("limit") {
		var err error
		limit, err = strconv.Atoi(q.Get("limit"))
		if err != nil || limit < 1 || limit > 100 {
			catalogError(w, r, application.ErrValidation)
			return
		}
	}
	cursor, err := application.DecodePurchasedPassCursor(q.Get("cursor"))
	if err != nil {
		catalogError(w, r, err)
		return
	}
	page, err := h.payments.Store.ListPasses(r.Context(), sessionFrom(r).Identity.ID, application.PurchasedPassFilter{Limit: limit, Status: domain.PurchasedPassStatus(q.Get("status")), Before: cursor})
	if err != nil {
		catalogError(w, r, err)
		return
	}
	items := make([]any, 0, len(page.Items))
	for _, p := range page.Items {
		items = append(items, passDTO(p, domain.ViewerOwner))
	}
	var next any
	if page.NextCursor != "" {
		next = page.NextCursor
	}
	respond(w, 200, map[string]any{"items": items, "nextCursor": next})
}
