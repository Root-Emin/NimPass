package application

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"nimpass/backend/internal/domain"
)

type CatalogStore interface {
	InsertProvider(context.Context, domain.Provider) error
	GetProvider(context.Context, domain.ID, domain.ID) (domain.Provider, error)
	ListProviders(context.Context, domain.ID) ([]domain.Provider, error)
	UpdateProvider(context.Context, domain.ID, domain.ID, string, time.Time) (domain.Provider, error)
	InsertService(context.Context, domain.Service, domain.ID) error
	GetService(context.Context, domain.ID, domain.ID) (domain.Service, error)
	ListServices(context.Context, domain.ID, domain.ID) ([]domain.Service, error)
	UpdateService(context.Context, domain.ID, domain.ID, string, string, domain.ServiceStatus, time.Time) (domain.Service, error)
	InsertPackage(context.Context, domain.Package, domain.ID) error
	GetPackage(context.Context, domain.ID, domain.ID) (domain.Package, error)
	ListPackages(context.Context, domain.ID, domain.ID) ([]domain.Package, error)
	UpdatePackage(context.Context, domain.ID, domain.ID, string, string, domain.SessionCount, domain.Luna, *time.Time, time.Time) (domain.Package, error)
	PublishPackage(context.Context, domain.ID, domain.ID, time.Time) (domain.Package, error)
	ListPublicPackages(context.Context) ([]PublicOffer, error)
	GetPublicPackage(context.Context, domain.ID) (PublicOffer, error)
	GetPublicProvider(context.Context, domain.ID) (PublicProvider, error)
}

type PublicProvider struct {
	ID   domain.ID
	Name string
}
type PublicService struct {
	ID          domain.ID
	Name        string
	Description string
}
type PublicOffer struct {
	Package  domain.Package
	Provider PublicProvider
	Service  PublicService
}

type Catalog struct {
	Store CatalogStore
	Now   func() time.Time
}

func (c Catalog) CreateProvider(ctx context.Context, actor Identity, name string) (domain.Provider, error) {
	id, err := domain.NewID()
	if err != nil {
		return domain.Provider{}, err
	}
	p, err := domain.NewProvider(id, actor.ID, name, c.Now().UTC())
	if err != nil {
		return p, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	return p, c.Store.InsertProvider(ctx, p)
}
func (c Catalog) UpdateProvider(ctx context.Context, actor Identity, id domain.ID, name string) (domain.Provider, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 160 {
		return domain.Provider{}, ErrValidation
	}
	return c.Store.UpdateProvider(ctx, id, actor.ID, name, c.Now().UTC())
}
func (c Catalog) CreateService(ctx context.Context, actor Identity, providerID domain.ID, name, description string) (domain.Service, error) {
	id, err := domain.NewID()
	if err != nil {
		return domain.Service{}, err
	}
	s, err := domain.NewService(id, providerID, name, description, c.Now().UTC())
	if err != nil {
		return s, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	return s, c.Store.InsertService(ctx, s, actor.ID)
}
func (c Catalog) UpdateService(ctx context.Context, actor Identity, providerID, id domain.ID, name, description string, status domain.ServiceStatus) (domain.Service, error) {
	if status != domain.ServiceDraft && status != domain.ServiceActive && status != domain.ServiceArchived {
		return domain.Service{}, ErrValidation
	}
	_, err := domain.NewService(id, providerID, name, description, c.Now().UTC())
	if err != nil {
		return domain.Service{}, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	current, err := c.Store.GetService(ctx, id, actor.ID)
	if err != nil {
		return domain.Service{}, err
	}
	if current.ProviderID != providerID {
		return domain.Service{}, ErrForbidden
	}
	if current.Status == domain.ServiceArchived || (current.Status == domain.ServiceActive && status == domain.ServiceDraft) {
		return domain.Service{}, ErrConflict
	}
	updated, err := c.Store.UpdateService(ctx, id, actor.ID, strings.TrimSpace(name), strings.TrimSpace(description), status, c.Now().UTC())
	if errors.Is(err, ErrNotFound) {
		return updated, ErrConflict
	}
	return updated, err
}
func (c Catalog) CreatePackage(ctx context.Context, actor Identity, providerID, serviceID domain.ID, title, description string, sessions int32, price int64, expires *time.Time) (domain.Package, error) {
	id, err := domain.NewID()
	if err != nil {
		return domain.Package{}, err
	}
	count, err := domain.NewSessionCount(sessions)
	if err != nil {
		return domain.Package{}, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	luna, err := domain.NewLuna(price)
	if err != nil {
		return domain.Package{}, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	p, err := domain.NewPackage(id, providerID, serviceID, title, description, count, luna, domain.NewExpirationPolicy(expires), c.Now().UTC())
	if err != nil {
		return p, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	return p, c.Store.InsertPackage(ctx, p, actor.ID)
}
func (c Catalog) UpdatePackage(ctx context.Context, actor Identity, id domain.ID, title, description string, sessions int32, price int64, expires *time.Time) (domain.Package, error) {
	p, err := c.Store.GetPackage(ctx, id, actor.ID)
	if err != nil {
		return p, err
	}
	if p.Status != domain.PackageDraft && p.Status != domain.PackageUnavailable {
		return p, ErrConflict
	}
	count, err := domain.NewSessionCount(sessions)
	if err != nil {
		return p, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	luna, err := domain.NewLuna(price)
	if err != nil {
		return p, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	updated, err := domain.NewPackage(id, p.ProviderID, p.ServiceID, title, description, count, luna, domain.NewExpirationPolicy(expires), c.Now().UTC())
	if err != nil {
		return p, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	result, err := c.Store.UpdatePackage(ctx, id, actor.ID, updated.Title, updated.Description, updated.Sessions, updated.PriceLuna, updated.Expiration.ExpiresAt, c.Now().UTC())
	if errors.Is(err, ErrNotFound) {
		return result, ErrConflict
	}
	return result, err
}
func (c Catalog) PublishPackage(ctx context.Context, actor Identity, id domain.ID) (domain.Package, error) {
	return c.Store.PublishPackage(ctx, id, actor.ID, c.Now().UTC())
}
