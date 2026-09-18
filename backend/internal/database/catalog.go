package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

type CatalogRepository struct{ Pool *pgxpool.Pool }

type row interface{ Scan(...any) error }

func providerScan(r row) (domain.Provider, error) {
	var p domain.Provider
	var wallet *string
	err := r.Scan(&p.ID, &p.OwnerIdentityID, &p.Name, &wallet, &p.PayoutVerifiedAt, &p.CreatedAt, &p.UpdatedAt, &p.Slug, &p.Headline, &p.Bio, &p.AvatarURL, &p.Location, &p.AvatarVariant)
	if wallet != nil {
		p.PayoutWallet = domain.WalletAddress(*wallet)
	}
	return p, notFound(err)
}
func serviceScan(r row) (domain.Service, error) {
	var s domain.Service
	err := r.Scan(&s.ID, &s.ProviderID, &s.Name, &s.Description, &s.Status, &s.CreatedAt, &s.UpdatedAt, &s.Category)
	return s, notFound(err)
}
func passScan(r row) (domain.Pass, error) {
	var p domain.Pass
	var expires *time.Time
	var accent *string
	var cover *string
	err := r.Scan(&p.ID, &p.ProviderID, &p.ServiceID, &p.Title, &p.Description, &p.Sessions, &p.PriceLuna, &expires, &accent, &p.Status, &p.CreatedAt, &p.UpdatedAt, &cover)
	p.Expiration = domain.NewExpirationPolicy(expires)
	if accent != nil {
		parsed, parseErr := domain.ParseAccent(*accent)
		if parseErr != nil {
			return p, parseErr
		}
		p.Accent = parsed
	}
	if cover != nil {
		p.CoverMediaID = domain.ID(*cover)
	}
	return p, notFound(err)
}
func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return application.ErrNotFound
	}
	return err
}

const providerFields = `id,owner_identity_id,name,payout_wallet,payout_verified_at,created_at,updated_at,slug,headline,bio,avatar_url,location,avatar_variant`
const passFields = `pk.id,pk.provider_id,pk.service_id,pk.title,pk.description,pk.session_count,pk.price_luna,pk.expiration_at,pk.accent,pk.status,pk.created_at,pk.updated_at,pk.cover_media_id`

func nullableAccent(accent domain.Accent) *string {
	if accent == "" {
		return nil
	}
	value := string(accent)
	return &value
}

func nullableID(id domain.ID) *string {
	if id == "" {
		return nil
	}
	value := string(id)
	return &value
}

// InsertProvider writes the provider and, in the same transaction, the audit
// record of the payout wallet it was born with.
//
// The wallet is the owner's own, adopted from the session's login proof rather
// than verified by a second ceremony (ADR-025). It is still a payout
// assignment, so it is still audited: `provider_payout_audit` holds one row for
// every wallet a provider has ever been paid into, and a NULL `challenge_id`
// is what says this one came from the login proof instead of a signed
// VERIFY_PROVIDER_WALLET challenge (docs/09-SECURITY.md §22).
//
// One transaction rather than two writes, because a provider that exists with
// no trace of where its money goes is the gap the audit table is for. The slug
// loop in `Catalog.insertWithGeneratedSlug` retries on 23505, and a rolled-back
// attempt leaves no audit row behind for the slug it failed to take.
func (r CatalogRepository) InsertProvider(ctx context.Context, p domain.Provider) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `INSERT INTO providers(id,owner_identity_id,name,created_at,updated_at,slug,headline,bio,avatar_url,location,avatar_variant,payout_wallet,payout_verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, p.ID, p.OwnerIdentityID, p.Name, p.CreatedAt, p.UpdatedAt, p.Slug, p.Headline, p.Bio, p.AvatarURL, p.Location, p.AvatarVariant, nullableWallet(p.PayoutWallet), p.PayoutVerifiedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return application.ErrConflict
	}
	if err != nil {
		return err
	}
	if p.PayoutVerifiedAt != nil {
		auditID, err := domain.NewID()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO provider_payout_audit(id,provider_id,actor_identity_id,challenge_id,previous_wallet,new_wallet,verified_at) VALUES($1,$2,$3,NULL,NULL,$4,$5)`, auditID, p.ID, p.OwnerIdentityID, string(p.PayoutWallet), *p.PayoutVerifiedAt); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// nullableWallet keeps the `providers_payout_verification_pair` check honest:
// an unset payout wallet is NULL, never the empty string the column's shape
// constraint would refuse.
func nullableWallet(w domain.WalletAddress) *string {
	if w == "" {
		return nil
	}
	value := string(w)
	return &value
}
func (r CatalogRepository) GetProvider(ctx context.Context, id, owner domain.ID) (domain.Provider, error) {
	return providerScan(r.Pool.QueryRow(ctx, `SELECT `+providerFields+` FROM providers WHERE id=$1 AND owner_identity_id=$2`, id, owner))
}
func (r CatalogRepository) ListProviders(ctx context.Context, owner domain.ID) ([]domain.Provider, error) {
	rows, err := r.Pool.Query(ctx, `SELECT `+providerFields+` FROM providers WHERE owner_identity_id=$1 ORDER BY created_at DESC LIMIT 100`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Provider, 0)
	for rows.Next() {
		p, err := providerScan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func (r CatalogRepository) UpdateProvider(ctx context.Context, id, owner domain.ID, name string, now time.Time, profile ...domain.ProfileInput) (domain.Provider, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return domain.Provider{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	p, err := providerScan(tx.QueryRow(ctx, `SELECT `+providerFields+` FROM providers WHERE id=$1 AND owner_identity_id=$2 FOR UPDATE`, id, owner))
	if err != nil {
		return p, err
	}
	if len(profile) > 0 {
		if err := p.ApplyProfile(profile[0]); err != nil {
			return p, application.ErrValidation
		}
	}
	p, err = providerScan(tx.QueryRow(ctx, `UPDATE providers SET name=$3,updated_at=$4,headline=$5,bio=$6,avatar_url=$7,location=$8,avatar_variant=$9 WHERE id=$1 AND owner_identity_id=$2 RETURNING `+providerFields, id, owner, name, now, p.Headline, p.Bio, p.AvatarURL, p.Location, p.AvatarVariant))
	if err != nil {
		return p, err
	}
	return p, tx.Commit(ctx)
}
func (r CatalogRepository) InsertService(ctx context.Context, s domain.Service, owner domain.ID) error {
	tag, err := r.Pool.Exec(ctx, `INSERT INTO services(id,provider_id,name,description,status,created_at,updated_at,category) SELECT $1,p.id,$3,$4,$5,$6,$7,NULLIF($9,'') FROM providers p WHERE p.id=$2 AND p.owner_identity_id=$8`, s.ID, s.ProviderID, s.Name, s.Description, s.Status, s.CreatedAt, s.UpdatedAt, owner, s.Category)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return application.ErrNotFound
	}
	return nil
}
func (r CatalogRepository) GetService(ctx context.Context, id, owner domain.ID) (domain.Service, error) {
	return serviceScan(r.Pool.QueryRow(ctx, `SELECT s.id,s.provider_id,s.name,s.description,s.status,s.created_at,s.updated_at,coalesce(s.category,'') FROM services s JOIN providers p ON p.id=s.provider_id WHERE s.id=$1 AND p.owner_identity_id=$2`, id, owner))
}
func (r CatalogRepository) ListServices(ctx context.Context, providerID, owner domain.ID) ([]domain.Service, error) {
	rows, err := r.Pool.Query(ctx, `SELECT s.id,s.provider_id,s.name,s.description,s.status,s.created_at,s.updated_at,coalesce(s.category,'') FROM services s JOIN providers p ON p.id=s.provider_id WHERE p.id=$1 AND p.owner_identity_id=$2 ORDER BY s.created_at DESC LIMIT 100`, providerID, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Service, 0)
	for rows.Next() {
		s, err := serviceScan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
func (r CatalogRepository) UpdateService(ctx context.Context, id, owner domain.ID, name, description string, status domain.ServiceStatus, now time.Time, category ...string) (domain.Service, error) {
	var value *string
	if len(category) > 0 {
		value = &category[0]
	}
	return serviceScan(r.Pool.QueryRow(ctx, `UPDATE services s SET name=$3,description=$4,status=$5,updated_at=$6,category=CASE WHEN $7::text IS NULL THEN s.category ELSE NULLIF($7,'') END FROM providers p WHERE s.id=$1 AND p.id=s.provider_id AND p.owner_identity_id=$2 AND s.status<>'ARCHIVED' AND (s.status=$5 OR (s.status='DRAFT' AND $5='ACTIVE') OR $5='ARCHIVED') RETURNING s.id,s.provider_id,s.name,s.description,s.status,s.created_at,s.updated_at,coalesce(s.category,'')`, id, owner, name, description, status, now, value))
}
func (r CatalogRepository) InsertPass(ctx context.Context, p domain.Pass, owner domain.ID) error {
	tag, err := r.Pool.Exec(ctx, `INSERT INTO passes(id,provider_id,service_id,title,description,session_count,price_luna,expiration_at,accent,status,created_at,updated_at,cover_media_id) SELECT $1,s.provider_id,s.id,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13 FROM services s JOIN providers pr ON pr.id=s.provider_id WHERE s.id=$3 AND s.provider_id=$2 AND pr.owner_identity_id=$14 AND s.status<>'ARCHIVED'`, p.ID, p.ProviderID, p.ServiceID, p.Title, p.Description, p.Sessions, p.PriceLuna, p.Expiration.ExpiresAt, nullableAccent(p.Accent), p.Status, p.CreatedAt, p.UpdatedAt, nullableID(p.CoverMediaID), owner)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return application.ErrNotFound
	}
	return nil
}
func (r CatalogRepository) GetProviderPass(ctx context.Context, id, owner domain.ID) (domain.Pass, error) {
	return passScan(r.Pool.QueryRow(ctx, `SELECT `+passFields+` FROM passes pk JOIN providers pr ON pr.id=pk.provider_id WHERE pk.id=$1 AND pr.owner_identity_id=$2`, id, owner))
}

// ListProviderPasses is the provider's own catalogue: everything they can still
// sell or still edit.
//
// ARCHIVED rows are excluded, because archiving is how a provider deletes a
// Pass — leaving it in the list would make "Delete" look like it did nothing.
// UNAVAILABLE rows are deliberately *kept*, for the mirror-image reason: a
// withdrawn Pass is still theirs, still editable and still republishable, and
// dropping it here would make "Remove from listing" indistinguishable from the
// delete it is meant to be an alternative to (`02-USER-FLOWS.md` §80, which
// lists ACTIVE and UNAVAILABLE side by side on this very screen).
// The row itself stays, and every purchase, payment and purchased pass that
// points at it keeps resolving (docs/08-ARCHITECTURE.md §135); it simply has no
// place on a screen whose whole subject is what is on sale.
func (r CatalogRepository) ListProviderPasses(ctx context.Context, providerID, owner domain.ID) ([]domain.Pass, error) {
	rows, err := r.Pool.Query(ctx, `SELECT `+passFields+` FROM passes pk JOIN providers pr ON pr.id=pk.provider_id WHERE pr.id=$1 AND pr.owner_identity_id=$2 AND pk.status<>'ARCHIVED' ORDER BY pk.created_at DESC LIMIT 100`, providerID, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Pass, 0)
	for rows.Next() {
		p, err := passScan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func (r CatalogRepository) UpdatePass(ctx context.Context, id, owner domain.ID, title, description string, sessions domain.SessionCount, price domain.Luna, expires *time.Time, accent domain.Accent, now time.Time, cover *domain.ID) (domain.Pass, error) {
	var setCover bool
	var coverValue *string
	if cover != nil {
		setCover = true
		coverValue = nullableID(*cover)
	}
	return passScan(r.Pool.QueryRow(ctx, `UPDATE passes pk SET title=$3,description=$4,session_count=$5,price_luna=$6,expiration_at=$7,accent=$8,updated_at=$9,cover_media_id=CASE WHEN $10 THEN $11::uuid ELSE pk.cover_media_id END FROM providers pr WHERE pk.id=$1 AND pr.id=pk.provider_id AND pr.owner_identity_id=$2 AND pk.status IN ('DRAFT','UNAVAILABLE') RETURNING `+passFields, id, owner, title, description, sessions, price, expires, nullableAccent(accent), now, setCover, coverValue))
}
func (r CatalogRepository) PublishPass(ctx context.Context, id, owner domain.ID, now time.Time) (domain.Pass, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return domain.Pass{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var p domain.Pass
	var expires *time.Time
	var accent *string
	var cover *string
	var serviceStatus domain.ServiceStatus
	var payoutWallet *string
	var payoutVerified *time.Time
	err = tx.QueryRow(ctx, `SELECT `+passFields+`,s.status,pr.payout_wallet,pr.payout_verified_at FROM passes pk JOIN providers pr ON pr.id=pk.provider_id JOIN services s ON s.id=pk.service_id AND s.provider_id=pr.id WHERE pk.id=$1 AND pr.owner_identity_id=$2 FOR UPDATE OF pk,pr,s`, id, owner).Scan(&p.ID, &p.ProviderID, &p.ServiceID, &p.Title, &p.Description, &p.Sessions, &p.PriceLuna, &expires, &accent, &p.Status, &p.CreatedAt, &p.UpdatedAt, &cover, &serviceStatus, &payoutWallet, &payoutVerified)
	if err != nil {
		return domain.Pass{}, notFound(err)
	}
	if cover != nil {
		p.CoverMediaID = domain.ID(*cover)
	}
	if payoutWallet == nil || payoutVerified == nil || serviceStatus != domain.ServiceActive || p.Sessions <= 0 || p.PriceLuna <= 0 {
		return p, application.ErrConflict
	}
	p.Expiration = domain.NewExpirationPolicy(expires)
	if accent != nil {
		parsed, parseErr := domain.ParseAccent(*accent)
		if parseErr != nil {
			return p, parseErr
		}
		p.Accent = parsed
	}
	if err = p.Publish(now); err != nil {
		return p, application.ErrConflict
	}
	_, err = tx.Exec(ctx, `UPDATE passes SET status='ACTIVE',updated_at=$2 WHERE id=$1`, id, now)
	if err != nil {
		return p, err
	}
	return p, tx.Commit(ctx)
}

// ArchivePass withdraws one Pass from sale, for its owner only.
//
// The ownership predicate is the authorisation: `pr.owner_identity_id=$2` is
// part of the same statement that does the write, so a second provider's id
// matches no row and comes back as ErrNotFound rather than as a forbidden
// action on a Pass they were allowed to learn the existence of
// (docs/09-SECURITY.md §31, §33).
//
// Nothing else is touched. `purchased_passes`, `purchases`, `verified_payments`
// and the redemption trail keep pointing at this row, and the composite foreign
// keys that bind them stay satisfied — which is exactly why this is a status
// change and not a DELETE.
func (r CatalogRepository) ArchivePass(ctx context.Context, id, owner domain.ID, now time.Time) (domain.Pass, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return domain.Pass{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	p, err := passScan(tx.QueryRow(ctx, `SELECT `+passFields+` FROM passes pk JOIN providers pr ON pr.id=pk.provider_id WHERE pk.id=$1 AND pr.owner_identity_id=$2 FOR UPDATE OF pk`, id, owner))
	if err != nil {
		return p, err
	}
	if err = p.Archive(now); err != nil {
		return p, application.ErrConflict
	}
	if _, err = tx.Exec(ctx, `UPDATE passes SET status='ARCHIVED',updated_at=$2 WHERE id=$1`, id, now); err != nil {
		return p, err
	}
	return p, tx.Commit(ctx)
}

// UnpublishPass takes one Pass off the shelf, for its owner only.
//
// Authorisation is the same statement it is everywhere else in this file:
// `pr.owner_identity_id=$2` sits inside the query that performs the write, so
// another provider's id matches no row and comes back as ErrNotFound rather
// than as a refusal on a Pass they were allowed to learn exists
// (docs/09-SECURITY.md §31, §33).
//
// Repeating the request is a success, not a conflict. A Pass that is already
// UNAVAILABLE is already in the state the caller asked for, so the row is
// returned untouched — `updated_at` included, because nothing happened to it.
// That is the difference from `ArchivePass`, where a second call is genuinely a
// conflict: archiving is terminal, and a repeat means the caller believes
// something is still there to end.
//
// Exactly one column changes, and it is the one `08-ARCHITECTURE.md` §34 says
// governs availability for new purchases. `purchased_passes`, `purchases`,
// `verified_payments`, `pass_sessions` and the redemption trail are not
// referenced by this transaction at all.
func (r CatalogRepository) UnpublishPass(ctx context.Context, id, owner domain.ID, now time.Time) (domain.Pass, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return domain.Pass{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	p, err := passScan(tx.QueryRow(ctx, `SELECT `+passFields+` FROM passes pk JOIN providers pr ON pr.id=pk.provider_id WHERE pk.id=$1 AND pr.owner_identity_id=$2 FOR UPDATE OF pk`, id, owner))
	if err != nil {
		return p, err
	}
	if p.Status == domain.PassUnavailable {
		return p, tx.Commit(ctx)
	}
	if err = p.Unpublish(now); err != nil {
		return p, application.ErrConflict
	}
	if _, err = tx.Exec(ctx, `UPDATE passes SET status='UNAVAILABLE',updated_at=$2 WHERE id=$1`, id, now); err != nil {
		return p, err
	}
	return p, tx.Commit(ctx)
}

func publicPassScan(r row) (application.PublicPass, error) {
	var o application.PublicPass
	var expires *time.Time
	var accent *string
	var cover *string
	err := r.Scan(&o.Pass.ID, &o.Pass.ProviderID, &o.Pass.ServiceID, &o.Pass.Title, &o.Pass.Description, &o.Pass.Sessions, &o.Pass.PriceLuna, &expires, &accent, &o.Pass.Status, &o.Pass.CreatedAt, &o.Pass.UpdatedAt, &cover, &o.Provider.Name, &o.Service.Name, &o.Service.Description, &o.Provider.Slug, &o.Provider.Headline, &o.Provider.Bio, &o.Provider.AvatarURL, &o.Provider.Location, &o.Provider.Wallet, &o.Service.Category, &o.Provider.AvatarVariant)
	o.Pass.Expiration = domain.NewExpirationPolicy(expires)
	if accent != nil {
		parsed, parseErr := domain.ParseAccent(*accent)
		if parseErr != nil {
			return o, parseErr
		}
		o.Pass.Accent = parsed
	}
	if cover != nil {
		o.Pass.CoverMediaID = domain.ID(*cover)
	}
	o.Provider.ID = o.Pass.ProviderID
	o.Service.ID = o.Pass.ServiceID
	return o, notFound(err)
}

const publicPassSQL = `SELECT pk.id,pk.provider_id,pk.service_id,pk.title,pk.description,pk.session_count,pk.price_luna,pk.expiration_at,pk.accent,pk.status,pk.created_at,pk.updated_at,pk.cover_media_id,pr.name,s.name,s.description,pr.slug,pr.headline,pr.bio,pr.avatar_url,pr.location,i.wallet_address,coalesce(s.category,''),pr.avatar_variant FROM passes pk JOIN providers pr ON pr.id=pk.provider_id JOIN identities i ON i.id=pr.owner_identity_id JOIN services s ON s.id=pk.service_id AND s.provider_id=pr.id WHERE pk.status='ACTIVE' AND s.status='ACTIVE' AND pr.payout_verified_at IS NOT NULL AND pr.payout_wallet IS NOT NULL AND (pk.expiration_at IS NULL OR pk.expiration_at>now())`

// ListPublicPasses is the public catalogue, narrowed by whatever the filter
// carries.
//
// An empty provider filter is the whole catalogue; a provider id is that
// provider's storefront. Both go through `publicPassSQL`, so a draft, archived
// or expired Pass is absent from a storefront for exactly the reason it is
// absent from Discover — there is one visibility rule and this is it.
func (r CatalogRepository) ListPublicPasses(ctx context.Context, filter application.PublicPassFilter) ([]application.PublicPass, error) {
	rows, err := r.Pool.Query(ctx, publicPassSQL+` AND ($1='' OR s.category=$1) AND ($2='' OR pk.provider_id=$2::uuid) ORDER BY pk.created_at DESC,pk.id DESC LIMIT 100`, filter.Category, string(filter.ProviderID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]application.PublicPass, 0)
	for rows.Next() {
		o, err := publicPassScan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
func (r CatalogRepository) GetPublicPass(ctx context.Context, id domain.ID) (application.PublicPass, error) {
	return publicPassScan(r.Pool.QueryRow(ctx, publicPassSQL+` AND pk.id=$1`, id))
}

const publicProviderSQL = `SELECT pr.id,pr.name,pr.slug,pr.headline,pr.bio,pr.avatar_url,pr.location,i.wallet_address,pr.avatar_variant FROM providers pr JOIN identities i ON i.id=pr.owner_identity_id WHERE pr.payout_verified_at IS NOT NULL`

func publicProviderScan(r row) (application.PublicProvider, error) {
	var p application.PublicProvider
	err := r.Scan(&p.ID, &p.Name, &p.Slug, &p.Headline, &p.Bio, &p.AvatarURL, &p.Location, &p.Wallet, &p.AvatarVariant)
	return p, notFound(err)
}

func (r CatalogRepository) GetPublicProvider(ctx context.Context, id domain.ID) (application.PublicProvider, error) {
	return publicProviderScan(r.Pool.QueryRow(ctx, publicProviderSQL+` AND pr.id=$1`, id))
}

func (r CatalogRepository) GetPublicProviderBySlug(ctx context.Context, slug string) (application.PublicProvider, error) {
	return publicProviderScan(r.Pool.QueryRow(ctx, publicProviderSQL+` AND pr.slug=$1`, slug))
}

// ListPublicProviders is the provider directory behind `/providers`.
//
// "Discoverable" is defined here exactly as Discover has always defined it: a
// provider with at least one pass that `publicPassSQL` would list. The
// predicate below is that query's WHERE clause, reused rather than restated, so
// the directory and the catalogue cannot disagree about who is sellable.
//
// Both halves of that matter. A provider whose payout wallet is unverified
// cannot be paid at all, and a provider with nothing published has a storefront
// that can only say "no passes available" — listing either would be a directory
// of dead ends.
//
// This replaces deriving the list in the browser from `GET /public/passes`,
// which silently capped the directory at whoever appeared in the newest hundred
// passes. `passCount` is counted here, from the same rows, so it is a fact
// rather than a tally of what happened to be on screen.
func (r CatalogRepository) ListPublicProviders(ctx context.Context, limit int) ([]application.PublicProviderSummary, error) {
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	rows, err := r.Pool.Query(ctx, `
        SELECT pr.id,pr.name,pr.slug,pr.headline,pr.bio,pr.avatar_url,pr.location,i.wallet_address,pr.avatar_variant,count(pk.id) AS pass_count
          FROM providers pr
          JOIN identities i ON i.id=pr.owner_identity_id
          JOIN passes pk ON pk.provider_id=pr.id AND pk.status='ACTIVE' AND (pk.expiration_at IS NULL OR pk.expiration_at>now())
          JOIN services s ON s.id=pk.service_id AND s.provider_id=pr.id AND s.status='ACTIVE'
         WHERE pr.payout_verified_at IS NOT NULL AND pr.payout_wallet IS NOT NULL
         GROUP BY pr.id,pr.name,pr.slug,pr.headline,pr.bio,pr.avatar_url,pr.location,i.wallet_address,pr.avatar_variant
         ORDER BY count(pk.id) DESC, pr.name ASC, pr.id ASC
         LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]application.PublicProviderSummary, 0)
	for rows.Next() {
		var item application.PublicProviderSummary
		p := &item.Provider
		if err := rows.Scan(&p.ID, &p.Name, &p.Slug, &p.Headline, &p.Bio, &p.AvatarURL, &p.Location, &p.Wallet, &p.AvatarVariant, &item.PassCount); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
