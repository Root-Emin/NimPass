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
	UpdateProvider(context.Context, domain.ID, domain.ID, string, time.Time, ...domain.ProfileInput) (domain.Provider, error)
	InsertService(context.Context, domain.Service, domain.ID) error
	GetService(context.Context, domain.ID, domain.ID) (domain.Service, error)
	ListServices(context.Context, domain.ID, domain.ID) ([]domain.Service, error)
	UpdateService(context.Context, domain.ID, domain.ID, string, string, domain.ServiceStatus, time.Time, ...string) (domain.Service, error)
	InsertPass(context.Context, domain.Pass, domain.ID) error
	GetProviderPass(context.Context, domain.ID, domain.ID) (domain.Pass, error)
	ListProviderPasses(context.Context, domain.ID, domain.ID) ([]domain.Pass, error)
	UpdatePass(context.Context, domain.ID, domain.ID, string, string, domain.SessionCount, domain.Luna, *time.Time, domain.Accent, time.Time, *domain.ID) (domain.Pass, error)
	PublishPass(context.Context, domain.ID, domain.ID, time.Time) (domain.Pass, error)
	UnpublishPass(context.Context, domain.ID, domain.ID, time.Time) (domain.Pass, error)
	ArchivePass(context.Context, domain.ID, domain.ID, time.Time) (domain.Pass, error)
	ListPublicPasses(context.Context, PublicPassFilter) ([]PublicPass, error)
	ListPublicProviders(context.Context, int) ([]PublicProviderSummary, error)
	GetPublicPass(context.Context, domain.ID) (PublicPass, error)
	GetPublicProvider(context.Context, domain.ID) (PublicProvider, error)
	GetPublicProviderBySlug(context.Context, string) (PublicProvider, error)
}

type CoverSource interface {
	OwnedCover(context.Context, domain.ID, domain.ID) error
}

type PublicProvider struct {
	ID        domain.ID
	Name      string
	Slug      string
	Headline  string
	Bio       string
	AvatarURL string
	// Which identicon of `Wallet` to draw. 0 is the wallet's own.
	AvatarVariant int16
	Location      string
	// Owner identity wallet. Identicon seed, never the payout destination.
	Wallet domain.WalletAddress
}

// PublicProviderSummary is one row of the provider directory: the public
// profile plus how many passes that provider currently has on sale.
//
// The count is the database's, taken from the same rows the directory is
// selected by. Nothing on a provider card is estimated
// (docs/08-ARCHITECTURE.md §11).
type PublicProviderSummary struct {
	Provider  PublicProvider
	PassCount int
}

// PublicPassFilter narrows the public catalogue server-side.
//
// Both fields are optional and both are the backend's to apply: a provider
// storefront is one query rather than the whole catalogue filtered in a
// browser, which is what made a storefront silently stop at whoever appeared
// in the newest hundred passes.
type PublicPassFilter struct {
	// Canonical category slug, or empty for every category.
	Category string
	// One provider's storefront, or empty for every provider.
	ProviderID domain.ID
}

type PublicService struct {
	ID          domain.ID
	Name        string
	Description string
	Category    domain.Category
}
type PublicPass struct {
	Pass     domain.Pass
	Provider PublicProvider
	Service  PublicService
}

type Catalog struct {
	Store  CatalogStore
	Covers CoverSource
	Now    func() time.Time
}

func (c Catalog) CreateProvider(ctx context.Context, actor Identity, name string, profile ...domain.ProfileInput) (domain.Provider, error) {
	id, err := domain.NewID()
	if err != nil {
		return domain.Provider{}, err
	}
	p, err := domain.NewProvider(id, actor.ID, name, c.Now().UTC())
	if err != nil {
		return p, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	if len(profile) > 0 {
		if err := p.ApplyProfile(profile[0]); err != nil {
			return p, fmt.Errorf("%w: %v", ErrValidation, err)
		}
	}
	// Where they get paid, decided here and not asked for. The wallet comes
	// from the authenticated session, never from the request body: a caller
	// cannot name a payout address, which is a stronger position than the
	// ceremony this replaces, where the address was client-supplied and a
	// signature had to make up the difference (ADR-025, docs/09-SECURITY.md
	// §21). Changing it later still requires that ceremony (§22).
	if err := p.AdoptOwnerPayout(actor.Wallet, c.Now()); err != nil {
		return p, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	if p.Slug != "" {
		// A slug the provider chose. A duplicate is CONFLICT, never a silently
		// different URL from the one they asked for.
		return p, c.Store.InsertProvider(ctx, p)
	}
	return c.insertWithGeneratedSlug(ctx, p)
}

// insertWithGeneratedSlug gives a new provider the most readable public URL
// that is still free.
//
// `emin`, then `emin-2`, `emin-3` … and, if even those are taken, the
// id-suffixed form that cannot collide with anything. The loop exists because
// the alternative was handing every provider created in the product a URL like
// `/providers/emin-kutlu-0f3ac1d24b7e4f0a91c5d8e2b6704a13` — correct, unique,
// and not a link anyone would send to a customer.
//
// Uniqueness is still the database's: `providers_slug_unique` decides, and a
// 23505 is what advances this loop. Two providers registering the same name at
// the same instant therefore cannot both take one slug — one of them simply
// moves to the next candidate. The final candidate carries the provider's own
// id, so the loop always terminates on a slug nothing else can hold.
func (c Catalog) insertWithGeneratedSlug(ctx context.Context, p domain.Provider) (domain.Provider, error) {
	candidates := domain.SlugCandidates(p.Name, p.ID)
	for i, candidate := range candidates {
		p.Slug = candidate
		err := c.Store.InsertProvider(ctx, p)
		if err == nil {
			return p, nil
		}
		if !errors.Is(err, ErrConflict) || i == len(candidates)-1 {
			return p, err
		}
	}
	return p, ErrConflict
}
func (c Catalog) UpdateProvider(ctx context.Context, actor Identity, id domain.ID, name string, profile ...domain.ProfileInput) (domain.Provider, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 160 {
		return domain.Provider{}, ErrValidation
	}
	return c.Store.UpdateProvider(ctx, id, actor.ID, name, c.Now().UTC(), profile...)
}
func (c Catalog) CreateService(ctx context.Context, actor Identity, providerID domain.ID, name, description string, category ...string) (domain.Service, error) {
	id, err := domain.NewID()
	if err != nil {
		return domain.Service{}, err
	}
	s, err := domain.NewService(id, providerID, name, description, c.Now().UTC())
	if err != nil {
		return s, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	if len(category) > 0 {
		s.Category, err = domain.ParseCategory(category[0])
		if err != nil {
			return s, ErrValidation
		}
	}
	return s, c.Store.InsertService(ctx, s, actor.ID)
}
func (c Catalog) UpdateService(ctx context.Context, actor Identity, providerID, id domain.ID, name, description string, status domain.ServiceStatus, category ...string) (domain.Service, error) {
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
	if len(category) > 0 {
		if _, err := domain.ParseCategory(category[0]); err != nil {
			return domain.Service{}, ErrValidation
		}
	}
	updated, err := c.Store.UpdateService(ctx, id, actor.ID, strings.TrimSpace(name), strings.TrimSpace(description), status, c.Now().UTC(), category...)
	if errors.Is(err, ErrNotFound) {
		return updated, ErrConflict
	}
	return updated, err
}
func (c Catalog) CreatePass(ctx context.Context, actor Identity, providerID, serviceID domain.ID, title, description string, sessions int32, price int64, expires *time.Time, accent string, coverMediaID domain.ID) (domain.Pass, error) {
	id, err := domain.NewID()
	if err != nil {
		return domain.Pass{}, err
	}
	count, err := domain.NewSessionCount(sessions)
	if err != nil {
		return domain.Pass{}, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	luna, err := domain.NewLuna(price)
	if err != nil {
		return domain.Pass{}, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	parsedAccent, err := domain.ParseAccent(accent)
	if err != nil {
		return domain.Pass{}, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	if err := c.bindCover(ctx, actor.ID, coverMediaID); err != nil {
		return domain.Pass{}, err
	}
	p, err := domain.NewPass(id, providerID, serviceID, title, description, count, luna, domain.NewExpirationPolicy(expires), parsedAccent, c.Now().UTC())
	if err != nil {
		return p, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	p.CoverMediaID = coverMediaID
	return p, c.Store.InsertPass(ctx, p, actor.ID)
}
func (c Catalog) UpdatePass(ctx context.Context, actor Identity, id domain.ID, title, description string, sessions int32, price int64, expires *time.Time, accent string, coverMediaID *domain.ID) (domain.Pass, error) {
	p, err := c.Store.GetProviderPass(ctx, id, actor.ID)
	if err != nil {
		return p, err
	}
	if p.Status != domain.PassDraft && p.Status != domain.PassUnavailable {
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
	parsedAccent, err := domain.ParseAccent(accent)
	if err != nil {
		return p, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	if coverMediaID != nil {
		if err := c.bindCover(ctx, actor.ID, *coverMediaID); err != nil {
			return p, err
		}
	}
	updated, err := domain.NewPass(id, p.ProviderID, p.ServiceID, title, description, count, luna, domain.NewExpirationPolicy(expires), parsedAccent, c.Now().UTC())
	if err != nil {
		return p, fmt.Errorf("%w: %v", ErrValidation, err)
	}
	result, err := c.Store.UpdatePass(ctx, id, actor.ID, updated.Title, updated.Description, updated.Sessions, updated.PriceLuna, updated.Expiration.ExpiresAt, updated.Accent, c.Now().UTC(), coverMediaID)
	if errors.Is(err, ErrNotFound) {
		return result, ErrConflict
	}
	return result, err
}

func (c Catalog) bindCover(ctx context.Context, owner, id domain.ID) error {
	if id == "" {
		return nil
	}
	if _, err := domain.ParseID(string(id)); err != nil {
		return fmt.Errorf("%w: %v", ErrValidation, err)
	}
	if c.Covers == nil {
		return ErrValidation
	}
	return c.Covers.OwnedCover(ctx, owner, id)
}
func (c Catalog) PublishPass(ctx context.Context, actor Identity, id domain.ID) (domain.Pass, error) {
	return c.Store.PublishPass(ctx, id, actor.ID, c.Now().UTC())
}

// ArchivePass is "delete this Pass", as the provider means it.
//
// `actor.ID` is the only account the repository will match against the Pass's
// provider, so a provider who is not the owner gets ErrNotFound and no write —
// authorisation is the statement, not a check in front of it
// (docs/09-SECURITY.md §33).
//
// What the customer keeps is decided by what this does *not* touch: the
// `purchased_passes` rows issued from this Pass, their sessions, their
// redemption history and the purchases and verified payments behind them are
// all untouched records with their own snapshots (docs/08-ARCHITECTURE.md
// §135-§136).
func (c Catalog) ArchivePass(ctx context.Context, actor Identity, id domain.ID) (domain.Pass, error) {
	return c.Store.ArchivePass(ctx, id, actor.ID, c.Now().UTC())
}

// UnpublishPass is "remove this from the listing" — the reversible half of
// withdrawing a Pass.
//
// It sits beside ArchivePass rather than inside it because the two answer
// different questions. Archiving ends a Pass; this parks it. A provider who
// simply has no slots this month should not have to destroy the product and
// rebuild it later, and `Pass.status` already carried UNAVAILABLE for exactly
// this (`08-ARCHITECTURE.md` §34, `02-USER-FLOWS.md` §80).
//
// Like every other write here, `actor.ID` is the only account the repository
// matches against the Pass's provider, so a provider who is not the owner gets
// ErrNotFound and no write (docs/09-SECURITY.md §33).
//
// What a customer already bought is untouched, and not by care taken here: a
// purchased pass is a different row with its own frozen snapshot, and nothing
// in the purchase, payment, session or redemption trail reads the catalog
// Pass's status. Withdrawal decides new purchases only (§34, §136).
func (c Catalog) UnpublishPass(ctx context.Context, actor Identity, id domain.ID) (domain.Pass, error) {
	return c.Store.UnpublishPass(ctx, id, actor.ID, c.Now().UTC())
}
