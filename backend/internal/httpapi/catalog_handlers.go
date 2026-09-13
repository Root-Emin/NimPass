package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

type nameRequest struct {
	Name string `json:"name"`
}
type serviceRequest struct {
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Status      domain.ServiceStatus `json:"status"`
}
type createServiceRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}
type packageRequest struct {
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	Sessions     int32      `json:"sessions"`
	PriceLuna    int64      `json:"priceLuna"`
	ExpirationAt *time.Time `json:"expirationAt"`
}

func providerDTO(p domain.Provider) any {
	var wallet any
	if p.PayoutWallet != "" {
		wallet = p.PayoutWallet
	}
	return map[string]any{"id": p.ID, "name": p.Name, "payoutWallet": wallet, "payoutVerifiedAt": p.PayoutVerifiedAt, "createdAt": p.CreatedAt, "updatedAt": p.UpdatedAt}
}
func serviceDTO(s domain.Service) any {
	return map[string]any{"id": s.ID, "providerId": s.ProviderID, "name": s.Name, "description": s.Description, "status": s.Status, "createdAt": s.CreatedAt, "updatedAt": s.UpdatedAt}
}
func packageDTO(p domain.Package) any {
	return map[string]any{"id": p.ID, "providerId": p.ProviderID, "serviceId": p.ServiceID, "title": p.Title, "description": p.Description, "sessions": p.Sessions, "priceLuna": p.PriceLuna, "currency": "NIM", "expirationAt": p.Expiration.ExpiresAt, "status": p.Status, "createdAt": p.CreatedAt, "updatedAt": p.UpdatedAt}
}
func offerDTO(o application.PublicOffer) any {
	return map[string]any{"package": packageDTO(o.Package), "provider": map[string]any{"id": o.Provider.ID, "name": o.Provider.Name}, "service": map[string]any{"id": o.Service.ID, "name": o.Service.Name, "description": o.Service.Description}}
}

func (h *handler) createProvider(w http.ResponseWriter, r *http.Request) {
	var req nameRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, err := h.catalog.CreateProvider(r.Context(), sessionFrom(r).Identity, req.Name)
	if err != nil {
		catalogError(w, r, err)
		return
	}
	respond(w, 201, providerDTO(p))
}
func (h *handler) listProviders(w http.ResponseWriter, r *http.Request) {
	items, err := h.catalog.Store.ListProviders(r.Context(), sessionFrom(r).Identity.ID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	out := make([]any, 0, len(items))
	for _, p := range items {
		out = append(out, providerDTO(p))
	}
	respond(w, 200, map[string]any{"items": out})
}
func (h *handler) getProvider(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	p, err := h.catalog.Store.GetProvider(r.Context(), id, sessionFrom(r).Identity.ID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, providerDTO(p))
}
func (h *handler) updateProvider(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	var req nameRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, err := h.catalog.UpdateProvider(r.Context(), sessionFrom(r).Identity, id, req.Name)
	if err != nil {
		catalogError(w, r, err)
		return
	}
	respond(w, 200, providerDTO(p))
}
func (h *handler) createService(w http.ResponseWriter, r *http.Request) {
	providerID, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	var req createServiceRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	s, err := h.catalog.CreateService(r.Context(), sessionFrom(r).Identity, providerID, req.Name, req.Description)
	if err != nil {
		catalogError(w, r, err)
		return
	}
	respond(w, 201, serviceDTO(s))
}
func (h *handler) listServices(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	if _, err := h.catalog.Store.GetProvider(r.Context(), id, sessionFrom(r).Identity.ID); err != nil {
		mappedError(w, r, err)
		return
	}
	items, err := h.catalog.Store.ListServices(r.Context(), id, sessionFrom(r).Identity.ID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	out := make([]any, 0, len(items))
	for _, s := range items {
		out = append(out, serviceDTO(s))
	}
	respond(w, 200, map[string]any{"items": out})
}
func (h *handler) getService(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "serviceID"))
	if !ok {
		return
	}
	s, err := h.catalog.Store.GetService(r.Context(), id, sessionFrom(r).Identity.ID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, serviceDTO(s))
}
func (h *handler) updateService(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "serviceID"))
	if !ok {
		return
	}
	var req serviceRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	s, err := h.catalog.Store.GetService(r.Context(), id, sessionFrom(r).Identity.ID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	updated, err := h.catalog.UpdateService(r.Context(), sessionFrom(r).Identity, s.ProviderID, id, req.Name, req.Description, req.Status)
	if err != nil {
		catalogError(w, r, err)
		return
	}
	respond(w, 200, serviceDTO(updated))
}
func (h *handler) createPackage(w http.ResponseWriter, r *http.Request) {
	providerID, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	serviceID, ok := parsedID(w, r, chi.URLParam(r, "serviceID"))
	if !ok {
		return
	}
	var req packageRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, err := h.catalog.CreatePackage(r.Context(), sessionFrom(r).Identity, providerID, serviceID, req.Title, req.Description, req.Sessions, req.PriceLuna, req.ExpirationAt)
	if err != nil {
		catalogError(w, r, err)
		return
	}
	respond(w, 201, packageDTO(p))
}
func (h *handler) listPackages(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	if _, err := h.catalog.Store.GetProvider(r.Context(), id, sessionFrom(r).Identity.ID); err != nil {
		mappedError(w, r, err)
		return
	}
	items, err := h.catalog.Store.ListPackages(r.Context(), id, sessionFrom(r).Identity.ID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	out := make([]any, 0, len(items))
	for _, p := range items {
		out = append(out, packageDTO(p))
	}
	respond(w, 200, map[string]any{"items": out})
}
func (h *handler) getPackage(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "packageID"))
	if !ok {
		return
	}
	p, err := h.catalog.Store.GetPackage(r.Context(), id, sessionFrom(r).Identity.ID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, packageDTO(p))
}
func (h *handler) updatePackage(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "packageID"))
	if !ok {
		return
	}
	var req packageRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, err := h.catalog.UpdatePackage(r.Context(), sessionFrom(r).Identity, id, req.Title, req.Description, req.Sessions, req.PriceLuna, req.ExpirationAt)
	if err != nil {
		catalogError(w, r, err)
		return
	}
	respond(w, 200, packageDTO(p))
}
func (h *handler) publishPackage(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "packageID"))
	if !ok {
		return
	}
	p, err := h.catalog.PublishPackage(r.Context(), sessionFrom(r).Identity, id)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, packageDTO(p))
}
func (h *handler) listPublicPackages(w http.ResponseWriter, r *http.Request) {
	items, err := h.catalog.Store.ListPublicPackages(r.Context())
	if err != nil {
		mappedError(w, r, err)
		return
	}
	out := make([]any, 0, len(items))
	for _, o := range items {
		out = append(out, offerDTO(o))
	}
	respond(w, 200, map[string]any{"items": out})
}
func (h *handler) getPublicPackage(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "packageID"))
	if !ok {
		return
	}
	o, err := h.catalog.Store.GetPublicPackage(r.Context(), id)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, offerDTO(o))
}
func (h *handler) getPublicProvider(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	p, err := h.catalog.Store.GetPublicProvider(r.Context(), id)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, map[string]any{"id": p.ID, "name": p.Name})
}
func catalogError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, application.ErrValidation) {
		apiFailure(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid resource values")
		return
	}
	mappedError(w, r, err)
}
