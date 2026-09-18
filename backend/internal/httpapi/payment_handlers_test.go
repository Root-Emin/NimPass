package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

func TestPurchaseCutoffErrorIsMachineReadable(t *testing.T) {
	w := httptest.NewRecorder()
	(&handler{}).paymentError(w, httptest.NewRequest(http.MethodPost, "/purchases", nil), application.ErrPurchaseCutoff)
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if w.Code != http.StatusConflict || json.Unmarshal(w.Body.Bytes(), &body) != nil || body.Error.Code != "PASS_PURCHASE_CUTOFF" {
		t.Fatalf("cutoff response: %d %s", w.Code, w.Body.String())
	}
}

// Two refusals that both mean "no purchase happened", each with its own code.
//
// PASS_ALREADY_OWNED wraps ErrConflict, so it has to be recognised before the
// generic conflict branch or it would reach the customer as PAYMENT_CONFLICT —
// a payment problem, for a payment that was never started.
func TestPurchaseRefusalsKeepTheirOwnCodes(t *testing.T) {
	for _, c := range []struct {
		err    error
		status int
		code   string
	}{
		{application.ErrPassAlreadyOwned, http.StatusConflict, "PASS_ALREADY_OWNED"},
		{application.ErrPassUnavailable, http.StatusConflict, "PASS_UNAVAILABLE"},
		{application.ErrSelfPurchase, http.StatusForbidden, "SELF_PURCHASE_NOT_ALLOWED"},
		{application.ErrConflict, http.StatusConflict, "PAYMENT_CONFLICT"},
	} {
		w := httptest.NewRecorder()
		(&handler{}).paymentError(w, httptest.NewRequest(http.MethodPost, "/purchases", nil), c.err)
		var body struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if w.Code != c.status || json.Unmarshal(w.Body.Bytes(), &body) != nil || body.Error.Code != c.code {
			t.Fatalf("%v answered %d %s, want %d %s", c.err, w.Code, w.Body.String(), c.status, c.code)
		}
	}
}

func TestCompensationPurchaseDTOCannotRequestAnotherPayment(t *testing.T) {
	now := time.Now().UTC()
	hash := strings.Repeat("a", 64)
	record := application.PurchaseRecord{
		Purchase:      domain.Purchase{Status: domain.PurchaseCompensationRequired, TransactionHash: hash},
		CandidateHash: hash, CandidateStatus: "COMPENSATION_REQUIRED",
		CompensationStatus: "OPEN", CompensationReason: "PASS_EXPIRED_BEFORE_ACTIVATION", CompensationAt: &now,
	}
	dto := purchaseDTO(record, now)
	if dto["status"] != "compensation_required" || dto["paymentRequest"] != nil || dto["purchasedPassId"] != nil || dto["paymentVerification"] != "COMPENSATION_REQUIRED" || dto["purchaseStatus"] != domain.PurchaseCompensationRequired {
		t.Fatalf("compensation response could request payment: %+v", dto)
	}
	caseDTO, ok := dto["compensation"].(map[string]any)
	if !ok || caseDTO["doNotPayAgain"] != true || caseDTO["automatedRefund"] != false || caseDTO["reason"] != "PASS_EXPIRED_BEFORE_ACTIVATION" || !strings.Contains(caseDTO["message"].(string), "Do not pay again") {
		t.Fatalf("compensation contract incomplete: %+v", dto)
	}
}

// A purchase is complete and its settlement is provisional, at the same time,
// and the API says both without ambiguity.
//
// This is the contract the frontend relies on to stop showing "waiting for
// finality" for a minute: `status` is what the customer is told, `settlement`
// is how permanent the payment behind it is, and the two are allowed to differ.
func TestProvisionalSettlementIsExposedWithoutDelayingTheCustomer(t *testing.T) {
	now := time.Now().UTC()
	hash := strings.Repeat("b", 64)
	included := now.Add(-2 * time.Second)
	record := application.PurchaseRecord{
		Purchase:      domain.Purchase{Status: domain.PurchaseConfirmed, TransactionHash: hash},
		CandidateHash: hash, CandidateStatus: "CONFIRMED", PassID: "pass-1",
		Settlement: &application.Settlement{
			Status: domain.SettlementIncluded, Hash: hash,
			InclusionBlock: 100, IncludedAt: included, ExpectedFinalityBlock: 120,
		},
	}
	dto := purchaseDTO(record, now)
	if dto["status"] != "completed" || dto["purchasedPassId"] != "pass-1" {
		t.Fatalf("provisional settlement delayed the customer's success: %+v", dto)
	}
	settlement, ok := dto["settlement"].(map[string]any)
	if !ok {
		t.Fatalf("settlement missing from a settled purchase: %+v", dto)
	}
	if settlement["status"] != domain.SettlementIncluded || settlement["provisional"] != true {
		t.Fatalf("settlement state: %+v", settlement)
	}
	// The expected height is exposed; the observed one is not, because it has
	// not happened.
	if settlement["expectedFinalityBlock"] != uint32(120) || settlement["finalityBlock"] != nil || settlement["finalizedAt"] != (*time.Time)(nil) {
		t.Fatalf("provisional receipt claimed finality over the wire: %+v", settlement)
	}

	// Promotion changes the settlement and nothing the customer sees.
	finalized := now.Add(-time.Second)
	record.Settlement.Status = domain.SettlementFinalized
	record.Settlement.FinalityBlock = 120
	record.Settlement.FinalizedAt = &finalized
	promoted := purchaseDTO(record, now)
	if promoted["status"] != "completed" {
		t.Fatalf("finality changed the customer-facing status: %+v", promoted)
	}
	settlement = promoted["settlement"].(map[string]any)
	if settlement["provisional"] != false || settlement["finalityBlock"] != uint32(120) || settlement["finalizedAt"] == nil {
		t.Fatalf("finalised settlement: %+v", settlement)
	}
}

// A withdrawn Pass must not be described with the words for a Pass that was
// paid for. Nothing is owed here, and the customer may buy again.
func TestReversedSettlementCompensationTellsTheCustomerToRetry(t *testing.T) {
	now := time.Now().UTC()
	hash := strings.Repeat("c", 64)
	record := application.PurchaseRecord{
		Purchase:      domain.Purchase{Status: domain.PurchaseCompensationRequired, TransactionHash: hash},
		CandidateHash: hash, CandidateStatus: "SETTLEMENT_REVERSED",
		CompensationStatus: "OPEN", CompensationReason: domain.SettlementReversed, CompensationAt: &now,
		Settlement: &application.Settlement{
			Status: domain.SettlementContested, Hash: hash, InclusionBlock: 100,
			IncludedAt: now.Add(-time.Minute), ExpectedFinalityBlock: 120,
			ContestedAt: &now, ContestReason: domain.SettlementReversed,
		},
	}
	dto := purchaseDTO(record, now)
	caseDTO, ok := dto["compensation"].(map[string]any)
	if !ok || caseDTO["reason"] != domain.SettlementReversed {
		t.Fatalf("reversal not reported as compensation: %+v", dto)
	}
	if caseDTO["doNotPayAgain"] != false {
		t.Fatal("a customer whose NIM never moved was told not to pay again")
	}
	if strings.Contains(caseDTO["message"].(string), "Payment received") {
		t.Fatalf("reversal message claims a payment arrived: %q", caseDTO["message"])
	}
	settlement := dto["settlement"].(map[string]any)
	if settlement["status"] != domain.SettlementContested || settlement["contestedAt"] == nil || settlement["provisional"] != false {
		t.Fatalf("contested settlement not exposed: %+v", settlement)
	}
}
