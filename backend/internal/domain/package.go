package domain

import (
	"errors"
	"strings"
	"time"
)

type PackageStatus string

const (
	PackageDraft       PackageStatus = "DRAFT"
	PackageActive      PackageStatus = "ACTIVE"
	PackageUnavailable PackageStatus = "UNAVAILABLE"
	PackageArchived    PackageStatus = "ARCHIVED"
)

// ExpirationPolicy currently represents an optional fixed UTC expiration date.
// A relative-duration policy needs a separate product decision before use.
type ExpirationPolicy struct {
	ExpiresAt *time.Time
}

func NewExpirationPolicy(at *time.Time) ExpirationPolicy {
	if at == nil {
		return ExpirationPolicy{}
	}
	copy := at.UTC()
	return ExpirationPolicy{ExpiresAt: &copy}
}

func (p ExpirationPolicy) Resolve(at time.Time) (*time.Time, error) {
	if p.ExpiresAt == nil {
		return nil, nil
	}
	if !p.ExpiresAt.After(at) {
		return nil, errors.New("package expiration must be after purchase confirmation")
	}
	copy := p.ExpiresAt.UTC()
	return &copy, nil
}

type Package struct {
	ID          ID
	ProviderID  ID
	ServiceID   ID
	Title       string
	Description string
	Sessions    SessionCount
	PriceLuna   Luna
	Expiration  ExpirationPolicy
	Status      PackageStatus
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func NewPackage(id, providerID, serviceID ID, title, description string, sessions SessionCount, price Luna, expiration ExpirationPolicy, now time.Time) (Package, error) {
	for _, value := range []ID{id, providerID, serviceID} {
		if _, err := ParseID(string(value)); err != nil {
			return Package{}, err
		}
	}
	title = strings.TrimSpace(title)
	if title == "" || len(title) > 160 || len(description) > 2000 || sessions <= 0 || price <= 0 || now.IsZero() {
		return Package{}, errors.New("package requires valid title, positive sessions and Luna price")
	}
	if _, err := expiration.Resolve(now); err != nil {
		return Package{}, err
	}
	return Package{ID: id, ProviderID: providerID, ServiceID: serviceID, Title: title, Description: strings.TrimSpace(description), Sessions: sessions, PriceLuna: price, Expiration: NewExpirationPolicy(expiration.ExpiresAt), Status: PackageDraft, CreatedAt: now.UTC(), UpdatedAt: now.UTC()}, nil
}

func (p *Package) Publish(now time.Time) error {
	if p.Status != PackageDraft && p.Status != PackageUnavailable {
		return errors.New("package cannot be published from current state")
	}
	if _, err := p.Expiration.Resolve(now); err != nil {
		return err
	}
	p.Status = PackageActive
	p.UpdatedAt = now.UTC()
	return nil
}

func (p Package) CanPurchase(at time.Time) bool {
	if p.Status != PackageActive || p.Sessions <= 0 || p.PriceLuna <= 0 || at.IsZero() {
		return false
	}
	_, err := p.Expiration.Resolve(at)
	return err == nil
}
