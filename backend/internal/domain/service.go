package domain

import (
	"errors"
	"strings"
	"time"
)

type ServiceStatus string

const (
	ServiceDraft    ServiceStatus = "DRAFT"
	ServiceActive   ServiceStatus = "ACTIVE"
	ServiceArchived ServiceStatus = "ARCHIVED"
)

type Service struct {
	ID          ID
	ProviderID  ID
	Name        string
	Description string
	Status      ServiceStatus
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func NewService(id, providerID ID, name, description string, now time.Time) (Service, error) {
	if _, err := ParseID(string(id)); err != nil {
		return Service{}, err
	}
	if _, err := ParseID(string(providerID)); err != nil {
		return Service{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 160 || len(description) > 2000 || now.IsZero() {
		return Service{}, errors.New("service requires valid name, description and creation time")
	}
	return Service{ID: id, ProviderID: providerID, Name: name, Description: strings.TrimSpace(description), Status: ServiceDraft, CreatedAt: now.UTC(), UpdatedAt: now.UTC()}, nil
}
