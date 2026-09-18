package database

import (
	"context"
	"errors"
	"testing"
	"time"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

// Create and update both refuse a past expiration, as a validation error.
//
// The browser refuses it too ("Pick a date and time in the future"), but the
// browser is a convenience; this is the rule. `ErrValidation` is what
// `catalogError` turns into 400 VALIDATION_ERROR, which is the convention every
// other bad field on this endpoint already follows.
func TestAPastExpirationIsRefusedOnCreateAndUpdate(t *testing.T) {
	pool := missionPool(t)
	ctx := context.Background()
	_, _, seed, _ := paymentOffer(t, pool)
	var providerID, serviceID, ownerID domain.ID
	if err := pool.QueryRow(ctx, `SELECT pk.provider_id,pk.service_id,pr.owner_identity_id FROM passes pk JOIN providers pr ON pr.id=pk.provider_id WHERE pk.id=$1`, seed).Scan(&providerID, &serviceID, &ownerID); err != nil {
		t.Fatal(err)
	}
	var wallet string
	if err := pool.QueryRow(ctx, `SELECT wallet_address FROM identities WHERE id=$1`, ownerID).Scan(&wallet); err != nil {
		t.Fatal(err)
	}
	owner := application.Identity{ID: ownerID, Wallet: wallet}
	now := time.Now().UTC()
	catalog := application.Catalog{Store: CatalogRepository{Pool: pool}, Now: func() time.Time { return now }}

	past := now.Add(-time.Hour)
	if _, err := catalog.CreatePass(ctx, owner, providerID, serviceID, "Already over", "", 10, 12340000, &past, "", ""); !errors.Is(err, application.ErrValidation) {
		t.Fatalf("create with a past expiration: %v", err)
	}
	// The boundary, through the application rather than the domain: an
	// expiration equal to now is already over.
	if _, err := catalog.CreatePass(ctx, owner, providerID, serviceID, "Exactly now", "", 10, 12340000, &now, "", ""); !errors.Is(err, application.ErrValidation) {
		t.Fatalf("create with expiration == now: %v", err)
	}

	future := now.Add(48 * time.Hour)
	created, err := catalog.CreatePass(ctx, owner, providerID, serviceID, "Good", "", 10, 12340000, &future, "", "")
	if err != nil {
		t.Fatalf("create with a future expiration: %v", err)
	}

	// An update may not walk it backwards either — including the case that
	// matters in practice, where the date was legal when it was set and the
	// clock has since passed it.
	if _, err := catalog.UpdatePass(ctx, owner, created.ID, "Good", "", 10, 12340000, &past, "", nil); !errors.Is(err, application.ErrValidation) {
		t.Fatalf("update to a past expiration: %v", err)
	}
	stillFuture := now.Add(72 * time.Hour)
	if _, err := catalog.UpdatePass(ctx, owner, created.ID, "Good", "", 10, 12340000, &stillFuture, "", nil); err != nil {
		t.Fatalf("update to a later expiration: %v", err)
	}
	// Clearing it is not a past date and stays legal.
	if _, err := catalog.UpdatePass(ctx, owner, created.ID, "Good", "", 10, 12340000, nil, "", nil); err != nil {
		t.Fatalf("clearing the expiration: %v", err)
	}
}
