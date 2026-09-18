package application

import (
	"encoding/base64"
	"encoding/json"
	"nimpass/backend/internal/domain"
	"time"
)

type PurchasedPassCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        domain.ID `json:"id"`
}
type PurchasedPassFilter struct {
	Limit  int
	Status domain.PurchasedPassStatus
	Before *PurchasedPassCursor
}
type PurchasedPassPage struct {
	Items      []domain.PurchasedPass
	NextCursor string
}

func DecodePurchasedPassCursor(value string) (*PurchasedPassCursor, error) {
	if value == "" {
		return nil, nil
	}
	if len(value) > 256 {
		return nil, ErrValidation
	}
	data, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, ErrValidation
	}
	var c PurchasedPassCursor
	if json.Unmarshal(data, &c) != nil || c.CreatedAt.IsZero() {
		return nil, ErrValidation
	}
	if _, err := domain.ParseID(string(c.ID)); err != nil {
		return nil, ErrValidation
	}
	return &c, nil
}
func EncodePurchasedPassCursor(p domain.PurchasedPass) string {
	data, _ := json.Marshal(PurchasedPassCursor{CreatedAt: p.CreatedAt, ID: p.ID})
	return base64.RawURLEncoding.EncodeToString(data)
}
