package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

type CatalogRepository struct{ Pool *pgxpool.Pool }

type row interface{ Scan(...any) error }

func providerScan(r row) (domain.Provider, error) {
	var p domain.Provider
	var wallet *string
	err := r.Scan(&p.ID, &p.OwnerIdentityID, &p.Name, &wallet, &p.PayoutVerifiedAt, &p.CreatedAt, &p.UpdatedAt)
	if wallet != nil {
		p.PayoutWallet = domain.WalletAddress(*wallet)
	}
	return p, notFound(err)
}
func serviceScan(r row) (domain.Service, error) {
	var s domain.Service
	err := r.Scan(&s.ID, &s.ProviderID, &s.Name, &s.Description, &s.Status, &s.CreatedAt, &s.UpdatedAt)
	return s, notFound(err)
}
func packageScan(r row) (domain.Package, error) {
	var p domain.Package
	var expires *time.Time
	err := r.Scan(&p.ID, &p.ProviderID, &p.ServiceID, &p.Title, &p.Description, &p.Sessions, &p.PriceLuna, &expires, &p.Status, &p.CreatedAt, &p.UpdatedAt)
	p.Expiration = domain.NewExpirationPolicy(expires)
	return p, notFound(err)
}
func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return application.ErrNotFound
	}
	return err
}

const providerFields = `id,owner_identity_id,name,payout_wallet,payout_verified_at,created_at,updated_at`

func (r CatalogRepository) InsertProvider(ctx context.Context, p domain.Provider) error {
	_, err := r.Pool.Exec(ctx, `INSERT INTO providers(id,owner_identity_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5)`, p.ID, p.OwnerIdentityID, p.Name, p.CreatedAt, p.UpdatedAt)
	return err
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
func (r CatalogRepository) UpdateProvider(ctx context.Context, id, owner domain.ID, name string, now time.Time) (domain.Provider, error) {
	return providerScan(r.Pool.QueryRow(ctx, `UPDATE providers SET name=$3,updated_at=$4 WHERE id=$1 AND owner_identity_id=$2 RETURNING `+providerFields, id, owner, name, now))
}
func (r CatalogRepository) InsertService(ctx context.Context, s domain.Service, owner domain.ID) error {
	tag, err := r.Pool.Exec(ctx, `INSERT INTO services(id,provider_id,name,description,status,created_at,updated_at) SELECT $1,p.id,$3,$4,$5,$6,$7 FROM providers p WHERE p.id=$2 AND p.owner_identity_id=$8`, s.ID, s.ProviderID, s.Name, s.Description, s.Status, s.CreatedAt, s.UpdatedAt, owner)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return application.ErrNotFound
	}
	return nil
}
func (r CatalogRepository) GetService(ctx context.Context, id, owner domain.ID) (domain.Service, error) {
	return serviceScan(r.Pool.QueryRow(ctx, `SELECT s.id,s.provider_id,s.name,s.description,s.status,s.created_at,s.updated_at FROM services s JOIN providers p ON p.id=s.provider_id WHERE s.id=$1 AND p.owner_identity_id=$2`, id, owner))
}
func (r CatalogRepository) ListServices(ctx context.Context, providerID, owner domain.ID) ([]domain.Service, error) {
	rows, err := r.Pool.Query(ctx, `SELECT s.id,s.provider_id,s.name,s.description,s.status,s.created_at,s.updated_at FROM services s JOIN providers p ON p.id=s.provider_id WHERE p.id=$1 AND p.owner_identity_id=$2 ORDER BY s.created_at DESC LIMIT 100`, providerID, owner)
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
func (r CatalogRepository) UpdateService(ctx context.Context, id, owner domain.ID, name, description string, status domain.ServiceStatus, now time.Time) (domain.Service, error) {
	return serviceScan(r.Pool.QueryRow(ctx, `UPDATE services s SET name=$3,description=$4,status=$5,updated_at=$6 FROM providers p WHERE s.id=$1 AND p.id=s.provider_id AND p.owner_identity_id=$2 AND s.status<>'ARCHIVED' AND (s.status=$5 OR (s.status='DRAFT' AND $5='ACTIVE') OR $5='ARCHIVED') RETURNING s.id,s.provider_id,s.name,s.description,s.status,s.created_at,s.updated_at`, id, owner, name, description, status, now))
}
func (r CatalogRepository) InsertPackage(ctx context.Context, p domain.Package, owner domain.ID) error {
	tag, err := r.Pool.Exec(ctx, `INSERT INTO packages(id,provider_id,service_id,title,description,session_count,price_luna,expiration_at,status,created_at,updated_at) SELECT $1,s.provider_id,s.id,$4,$5,$6,$7,$8,$9,$10,$11 FROM services s JOIN providers pr ON pr.id=s.provider_id WHERE s.id=$3 AND s.provider_id=$2 AND pr.owner_identity_id=$12 AND s.status<>'ARCHIVED'`, p.ID, p.ProviderID, p.ServiceID, p.Title, p.Description, p.Sessions, p.PriceLuna, p.Expiration.ExpiresAt, p.Status, p.CreatedAt, p.UpdatedAt, owner)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return application.ErrNotFound
	}
	return nil
}
func (r CatalogRepository) GetPackage(ctx context.Context, id, owner domain.ID) (domain.Package, error) {
	return packageScan(r.Pool.QueryRow(ctx, `SELECT pk.id,pk.provider_id,pk.service_id,pk.title,pk.description,pk.session_count,pk.price_luna,pk.expiration_at,pk.status,pk.created_at,pk.updated_at FROM packages pk JOIN providers pr ON pr.id=pk.provider_id WHERE pk.id=$1 AND pr.owner_identity_id=$2`, id, owner))
}
func (r CatalogRepository) ListPackages(ctx context.Context, providerID, owner domain.ID) ([]domain.Package, error) {
	rows, err := r.Pool.Query(ctx, `SELECT pk.id,pk.provider_id,pk.service_id,pk.title,pk.description,pk.session_count,pk.price_luna,pk.expiration_at,pk.status,pk.created_at,pk.updated_at FROM packages pk JOIN providers pr ON pr.id=pk.provider_id WHERE pr.id=$1 AND pr.owner_identity_id=$2 ORDER BY pk.created_at DESC LIMIT 100`, providerID, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Package, 0)
	for rows.Next() {
		p, err := packageScan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func (r CatalogRepository) UpdatePackage(ctx context.Context, id, owner domain.ID, title, description string, sessions domain.SessionCount, price domain.Luna, expires *time.Time, now time.Time) (domain.Package, error) {
	return packageScan(r.Pool.QueryRow(ctx, `UPDATE packages pk SET title=$3,description=$4,session_count=$5,price_luna=$6,expiration_at=$7,updated_at=$8 FROM providers pr WHERE pk.id=$1 AND pr.id=pk.provider_id AND pr.owner_identity_id=$2 AND pk.status IN ('DRAFT','UNAVAILABLE') RETURNING pk.id,pk.provider_id,pk.service_id,pk.title,pk.description,pk.session_count,pk.price_luna,pk.expiration_at,pk.status,pk.created_at,pk.updated_at`, id, owner, title, description, sessions, price, expires, now))
}
func (r CatalogRepository) PublishPackage(ctx context.Context, id, owner domain.ID, now time.Time) (domain.Package, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return domain.Package{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var p domain.Package
	var expires *time.Time
	var serviceStatus domain.ServiceStatus
	var payoutWallet *string
	var payoutVerified *time.Time
	err = tx.QueryRow(ctx, `SELECT pk.id,pk.provider_id,pk.service_id,pk.title,pk.description,pk.session_count,pk.price_luna,pk.expiration_at,pk.status,pk.created_at,pk.updated_at,s.status,pr.payout_wallet,pr.payout_verified_at FROM packages pk JOIN providers pr ON pr.id=pk.provider_id JOIN services s ON s.id=pk.service_id AND s.provider_id=pr.id WHERE pk.id=$1 AND pr.owner_identity_id=$2 FOR UPDATE OF pk,pr,s`, id, owner).Scan(&p.ID, &p.ProviderID, &p.ServiceID, &p.Title, &p.Description, &p.Sessions, &p.PriceLuna, &expires, &p.Status, &p.CreatedAt, &p.UpdatedAt, &serviceStatus, &payoutWallet, &payoutVerified)
	if err != nil {
		return domain.Package{}, notFound(err)
	}
	if payoutWallet == nil || payoutVerified == nil || serviceStatus != domain.ServiceActive || p.Sessions <= 0 || p.PriceLuna <= 0 {
		return p, application.ErrConflict
	}
	p.Expiration = domain.NewExpirationPolicy(expires)
	if err = p.Publish(now); err != nil {
		return p, application.ErrConflict
	}
	_, err = tx.Exec(ctx, `UPDATE packages SET status='ACTIVE',updated_at=$2 WHERE id=$1`, id, now)
	if err != nil {
		return p, err
	}
	return p, tx.Commit(ctx)
}

func publicOfferScan(r row) (application.PublicOffer, error) {
	var o application.PublicOffer
	var expires *time.Time
	err := r.Scan(&o.Package.ID, &o.Package.ProviderID, &o.Package.ServiceID, &o.Package.Title, &o.Package.Description, &o.Package.Sessions, &o.Package.PriceLuna, &expires, &o.Package.Status, &o.Package.CreatedAt, &o.Package.UpdatedAt, &o.Provider.Name, &o.Service.Name, &o.Service.Description)
	o.Package.Expiration = domain.NewExpirationPolicy(expires)
	o.Provider.ID = o.Package.ProviderID
	o.Service.ID = o.Package.ServiceID
	return o, notFound(err)
}

const publicOfferSQL = `SELECT pk.id,pk.provider_id,pk.service_id,pk.title,pk.description,pk.session_count,pk.price_luna,pk.expiration_at,pk.status,pk.created_at,pk.updated_at,pr.name,s.name,s.description FROM packages pk JOIN providers pr ON pr.id=pk.provider_id JOIN services s ON s.id=pk.service_id AND s.provider_id=pr.id WHERE pk.status='ACTIVE' AND s.status='ACTIVE' AND pr.payout_verified_at IS NOT NULL AND pr.payout_wallet IS NOT NULL AND (pk.expiration_at IS NULL OR pk.expiration_at>now())`

func (r CatalogRepository) ListPublicPackages(ctx context.Context) ([]application.PublicOffer, error) {
	rows, err := r.Pool.Query(ctx, publicOfferSQL+` ORDER BY pk.created_at DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]application.PublicOffer, 0)
	for rows.Next() {
		o, err := publicOfferScan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
func (r CatalogRepository) GetPublicPackage(ctx context.Context, id domain.ID) (application.PublicOffer, error) {
	return publicOfferScan(r.Pool.QueryRow(ctx, publicOfferSQL+` AND pk.id=$1`, id))
}
func (r CatalogRepository) GetPublicProvider(ctx context.Context, id domain.ID) (application.PublicProvider, error) {
	var p application.PublicProvider
	err := r.Pool.QueryRow(ctx, `SELECT id,name FROM providers WHERE id=$1 AND payout_verified_at IS NOT NULL`, id).Scan(&p.ID, &p.Name)
	return p, notFound(err)
}
