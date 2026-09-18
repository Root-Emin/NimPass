package httpapi

import (
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"testing"
	"time"
)

func TestWalletAttemptOmitsPayableInstructionEvenAfterExpiry(t *testing.T) {
	now := time.Now()
	p := application.PurchaseRecord{Purchase: domain.Purchase{Status: domain.PurchasePaymentPending, ExpiresAt: now.Add(time.Minute)}}
	if purchaseDTO(p, now)["paymentRequest"] == nil {
		t.Fatal("fresh intent has no instruction")
	}
	p.WalletAttemptPending = true
	for _, clock := range []time.Time{now, now.Add(time.Hour)} {
		dto := purchaseDTO(p, clock)
		if dto["paymentRequest"] != nil || dto["status"] != "uncertain_retryable" {
			t.Fatal("possible broadcast became payable", dto)
		}
	}
}
