package database

import (
	"context"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

func (r PaymentRepository) ListPasses(ctx context.Context, customer domain.ID, filter application.PurchasedPassFilter) (application.PurchasedPassPage, error) {
	out := application.PurchasedPassPage{Items: make([]domain.PurchasedPass, 0)}
	if filter.Limit < 1 || filter.Limit > 100 {
		return out, application.ErrValidation
	}
	switch filter.Status {
	case "", domain.PurchasedPassActive, domain.PurchasedPassCompleted, domain.PurchasedPassExpired, domain.PurchasedPassCancelled:
	default:
		return out, application.ErrValidation
	}
	var beforeTime, beforeID any
	if filter.Before != nil {
		beforeTime = filter.Before.CreatedAt
		beforeID = filter.Before.ID
	}
	// Effective expiry is computed in the same statement as filtering; the read
	// need not lock every owned Pass. Redemption separately enforces expiry.
	//
	// Scoped by the pass's own owner_identity_id. The buyer's collection is
	// therefore a property of the pass, not something reconstructed from the
	// purchase each time — which is what makes it survive logout, a new
	// device, and any later correction to the purchase row.
	rows, err := r.Pool.Query(ctx, `SELECT `+purchasedPassFields+purchasedPassSource+` WHERE pa.owner_identity_id=$1 AND ($2='' OR `+purchasedPassStatusExpr+`=$2) AND ($3::timestamptz IS NULL OR (pa.created_at,pa.id)<($3,$4::uuid)) ORDER BY pa.created_at DESC,pa.id DESC LIMIT $5`, customer, filter.Status, beforeTime, beforeID, filter.Limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		p, err := scanPurchasedPass(rows)
		if err != nil {
			return out, err
		}
		out.Items = append(out.Items, p)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	if len(out.Items) > filter.Limit {
		out.Items = out.Items[:filter.Limit]
		out.NextCursor = application.EncodePurchasedPassCursor(out.Items[len(out.Items)-1])
	}
	return out, nil
}
