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
	if w.Code != http.StatusConflict || json.Unmarshal(w.Body.Bytes(), &body) != nil || body.Error.Code != "PACKAGE_PURCHASE_CUTOFF" {
		t.Fatalf("cutoff response: %d %s", w.Code, w.Body.String())
	}
}

func TestCompensationPurchaseDTOCannotRequestAnotherPayment(t *testing.T) {
	now := time.Now().UTC()
	hash := strings.Repeat("a", 64)
	record := application.PurchaseRecord{
		Purchase:      domain.Purchase{Status: domain.PurchaseCompensationRequired, TransactionHash: hash},
		CandidateHash: hash, CandidateStatus: "COMPENSATION_REQUIRED",
		CompensationStatus: "OPEN", CompensationReason: "PACKAGE_EXPIRED_BEFORE_ACTIVATION", CompensationAt: &now,
	}
	dto := purchaseDTO(record, now)
	if dto["status"] != "compensation_required" || dto["paymentRequest"] != nil || dto["passId"] != nil || dto["paymentVerification"] != "COMPENSATION_REQUIRED" || dto["purchaseStatus"] != domain.PurchaseCompensationRequired {
		t.Fatalf("compensation response could request payment: %+v", dto)
	}
	caseDTO, ok := dto["compensation"].(map[string]any)
	if !ok || caseDTO["doNotPayAgain"] != true || caseDTO["automatedRefund"] != false || caseDTO["reason"] != "PACKAGE_EXPIRED_BEFORE_ACTIVATION" || !strings.Contains(caseDTO["message"].(string), "Do not pay again") {
		t.Fatalf("compensation contract incomplete: %+v", dto)
	}
}
