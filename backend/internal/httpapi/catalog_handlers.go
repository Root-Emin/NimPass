package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

type nameRequest struct {
	Name string `json:"name"`
	domain.ProfileInput
}
type serviceRequest struct {
	Category    *string              `json:"category"`
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Status      domain.ServiceStatus `json:"status"`
}
type createServiceRequest struct {
	Category    string `json:"category"`
	Name        string `json:"name"`
	Description string `json:"description"`
}
type passRequest struct {
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	Sessions     int32      `json:"sessions"`
	PriceLuna    int64      `json:"priceLuna"`
	ExpirationAt *time.Time `json:"expirationAt"`
	Accent       *string    `json:"accent"`
	CoverMediaID nullableID `json:"coverMediaId"`
}

type nullableID struct {
	Set bool
	ID  domain.ID
}

func (n *nullableID) UnmarshalJSON(b []byte) error {
	n.Set = true
	if string(b) == "null" {
		n.ID = ""
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	id, err := domain.ParseID(s)
	if err != nil {
		return err
	}
	n.ID = id
	return nil
}

func providerDTO(p domain.Provider) any {
	var wallet any
	if p.PayoutWallet != "" {
		wallet = p.PayoutWallet
	}
	return map[string]any{"id": p.ID, "name": p.Name, "slug": p.Slug, "headline": p.Headline, "bio": p.Bio, "avatarUrl": p.AvatarURL, "avatarVariant": p.AvatarVariant, "location": p.Location, "payoutWallet": wallet, "payoutVerifiedAt": p.PayoutVerifiedAt, "createdAt": p.CreatedAt, "updatedAt": p.UpdatedAt}
}
func serviceDTO(s domain.Service) any {
	return map[string]any{"id": s.ID, "providerId": s.ProviderID, "name": s.Name, "description": s.Description, "category": s.Category, "status": s.Status, "createdAt": s.CreatedAt, "updatedAt": s.UpdatedAt}
}
func passListingDTO(p domain.Pass) any {
	var accent any
	if p.Accent != "" {
		accent = p.Accent
	}
	coverID, coverURL := coverFields(p.CoverMediaID)
	return map[string]any{"id": p.ID, "providerId": p.ProviderID, "serviceId": p.ServiceID, "title": p.Title, "description": p.Description, "sessions": p.Sessions, "priceLuna": p.PriceLuna, "currency": "NIM", "expirationAt": p.Expiration.ExpiresAt, "accent": accent, "coverMediaId": coverID, "coverUrl": coverURL, "status": p.Status, "createdAt": p.CreatedAt, "updatedAt": p.UpdatedAt}
}

func coverFields(id domain.ID) (any, any) {
	if id == "" {
		return nil, nil
	}
	return id, "/api/v1/media/" + string(id)
}
func publicPassDTO(o application.PublicPass) any {
	return map[string]any{"pass": passListingDTO(o.Pass), "provider": publicProviderDTO(o.Provider), "service": map[string]any{"id": o.Service.ID, "name": o.Service.Name, "description": o.Service.Description, "category": o.Service.Category}}
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// allowCatalogWrite is the burst guard on every write to the catalogue.
//
// Auth, payment, redemption, media and pass sessions have all had one; the
// catalogue had none, so a single authenticated wallet could create providers,
// services and passes as fast as it could post. That surface is public by
// construction: ADR-025 adopts the login wallet as the payout wallet, so a new
// provider needs no verification step to reach the public directory, and every
// ACTIVE Pass reaches Discover.
//
// Both dimensions are applied, as the auth handlers do it: the identity is the
// thing being limited, and the IP is what stops one client cycling through
// wallets. Neither number is a product quota — a provider editing a Pass sends
// a handful of requests a minute at most, and nothing here is meant to be
// reached by a person using the product.
func (h *handler) allowCatalogWrite(w http.ResponseWriter, r *http.Request) bool {
	identity := string(sessionFrom(r).Identity.ID)
	if !h.allow(r, "catalog-write:"+identity, 60, time.Minute) || !h.allow(r, "catalog-write-ip:"+h.clientIP(r), 120, time.Minute) {
		apiFailure(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Too many catalog changes")
		return false
	}
	return true
}

func (h *handler) createProvider(w http.ResponseWriter, r *http.Request) {
	if !h.allowCatalogWrite(w, r) {
		return
	}
	var req nameRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, err := h.catalog.CreateProvider(r.Context(), sessionFrom(r).Identity, req.Name, req.ProfileInput)
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
	if !h.allowCatalogWrite(w, r) {
		return
	}
	id, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	var req nameRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, err := h.catalog.UpdateProvider(r.Context(), sessionFrom(r).Identity, id, req.Name, req.ProfileInput)
	if err != nil {
		catalogError(w, r, err)
		return
	}
	respond(w, 200, providerDTO(p))
}
func (h *handler) createService(w http.ResponseWriter, r *http.Request) {
	if !h.allowCatalogWrite(w, r) {
		return
	}
	providerID, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	var req createServiceRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	s, err := h.catalog.CreateService(r.Context(), sessionFrom(r).Identity, providerID, req.Name, req.Description, req.Category)
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
	if !h.allowCatalogWrite(w, r) {
		return
	}
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
	var category []string
	if req.Category != nil {
		category = []string{*req.Category}
	}
	updated, err := h.catalog.UpdateService(r.Context(), sessionFrom(r).Identity, s.ProviderID, id, req.Name, req.Description, req.Status, category...)
	if err != nil {
		catalogError(w, r, err)
		return
	}
	respond(w, 200, serviceDTO(updated))
}
func (h *handler) createPass(w http.ResponseWriter, r *http.Request) {
	if !h.allowCatalogWrite(w, r) {
		return
	}
	providerID, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	serviceID, ok := parsedID(w, r, chi.URLParam(r, "serviceID"))
	if !ok {
		return
	}
	var req passRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, err := h.catalog.CreatePass(r.Context(), sessionFrom(r).Identity, providerID, serviceID, req.Title, req.Description, req.Sessions, req.PriceLuna, req.ExpirationAt, deref(req.Accent), req.CoverMediaID.ID)
	if err != nil {
		catalogError(w, r, err)
		return
	}
	respond(w, 201, passListingDTO(p))
}
func (h *handler) listProviderPasses(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	if _, err := h.catalog.Store.GetProvider(r.Context(), id, sessionFrom(r).Identity.ID); err != nil {
		mappedError(w, r, err)
		return
	}
	items, err := h.catalog.Store.ListProviderPasses(r.Context(), id, sessionFrom(r).Identity.ID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	out := make([]any, 0, len(items))
	for _, p := range items {
		out = append(out, passListingDTO(p))
	}
	respond(w, 200, map[string]any{"items": out})
}
func (h *handler) getProviderPass(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	p, err := h.catalog.Store.GetProviderPass(r.Context(), id, sessionFrom(r).Identity.ID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, passListingDTO(p))
}
func (h *handler) updatePass(w http.ResponseWriter, r *http.Request) {
	if !h.allowCatalogWrite(w, r) {
		return
	}
	id, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	var req passRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	var cover *domain.ID
	if req.CoverMediaID.Set {
		id := req.CoverMediaID.ID
		cover = &id
	}
	p, err := h.catalog.UpdatePass(r.Context(), sessionFrom(r).Identity, id, req.Title, req.Description, req.Sessions, req.PriceLuna, req.ExpirationAt, deref(req.Accent), cover)
	if err != nil {
		catalogError(w, r, err)
		return
	}
	respond(w, 200, passListingDTO(p))
}
func (h *handler) publishPass(w http.ResponseWriter, r *http.Request) {
	if !h.allowCatalogWrite(w, r) {
		return
	}
	id, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	p, err := h.catalog.PublishPass(r.Context(), sessionFrom(r).Identity, id)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, passListingDTO(p))
}

// unpublishPass serves POST /catalog/passes/{passID}/unpublish.
//
// The mirror of `publish`, and deliberately not a DELETE: this is not a
// deletion at any level. The Pass keeps its id, its data, its place in the
// provider's own catalogue and every record that points at it; only its
// availability for new purchases changes (`08-ARCHITECTURE.md` §34).
//
// A POST to a named transition rather than a PATCH of `status`, because that is
// how publishing is already addressed here and because a status field open to
// assignment would let a client ask for ARCHIVED — a different, terminal act
// with its own route and its own confirmation.
//
// Repeating it is a 200, not a 409. The caller asked for the Pass to be off the
// listing and it is; see `CatalogRepository.UnpublishPass`. A Pass this account
// does not own is 404, as everywhere else (docs/09-SECURITY.md §31).
func (h *handler) unpublishPass(w http.ResponseWriter, r *http.Request) {
	if !h.allowCatalogWrite(w, r) {
		return
	}
	id, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	p, err := h.catalog.UnpublishPass(r.Context(), sessionFrom(r).Identity, id)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, passListingDTO(p))
}

// archivePass serves DELETE /catalog/passes/{passID}.
//
// DELETE is the right verb for what the provider is doing — the Pass stops
// existing as far as the product is concerned — and an archival write is the
// right thing for it to do, because customers hold passes issued from this row
// and every purchase and payment that produced them points at it
// (docs/08-ARCHITECTURE.md §135). The response body says which, by returning
// the Pass with `status: ARCHIVED` rather than 204.
//
// A Pass this account does not own is 404, not 403: it is not theirs to know
// about (docs/09-SECURITY.md §31).
func (h *handler) archivePass(w http.ResponseWriter, r *http.Request) {
	if !h.allowCatalogWrite(w, r) {
		return
	}
	id, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	p, err := h.catalog.ArchivePass(r.Context(), sessionFrom(r).Identity, id)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, passListingDTO(p))
}

func (h *handler) listPublicPasses(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	value := query.Get("category")
	if _, err := domain.ParseCategory(value); err != nil || len(query["category"]) > 1 {
		catalogError(w, r, application.ErrValidation)
		return
	}
	// `provider` is a storefront filter, not an authorisation boundary: every
	// row it can return is already public. It is still parsed strictly, because
	// a query parameter is user input and a malformed id must be a 400 rather
	// than a silently unfiltered catalogue.
	filter := application.PublicPassFilter{Category: value}
	if len(query["provider"]) > 1 {
		catalogError(w, r, application.ErrValidation)
		return
	}
	if raw := query.Get("provider"); raw != "" {
		providerID, err := domain.ParseID(raw)
		if err != nil {
			catalogError(w, r, application.ErrValidation)
			return
		}
		filter.ProviderID = providerID
	}
	items, err := h.catalog.Store.ListPublicPasses(r.Context(), filter)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	out := make([]any, 0, len(items))
	for _, o := range items {
		out = append(out, publicPassDTO(o))
	}
	respond(w, 200, map[string]any{"items": out})
}
func (h *handler) getPublicPass(w http.ResponseWriter, r *http.Request) {
	id, ok := parsedID(w, r, chi.URLParam(r, "passID"))
	if !ok {
		return
	}
	o, err := h.catalog.Store.GetPublicPass(r.Context(), id)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, publicPassDTO(o))
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
	respond(w, 200, publicProviderDTO(p))
}

// listPublicProviders serves the provider directory.
//
// One query, one answer. The browser used to assemble this from the newest
// hundred public passes, which meant the directory silently stopped at whoever
// happened to appear in them.
func (h *handler) listPublicProviders(w http.ResponseWriter, r *http.Request) {
	items, err := h.catalog.Store.ListPublicProviders(r.Context(), 0)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	out := make([]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{"provider": publicProviderDTO(item.Provider), "passCount": item.PassCount})
	}
	respond(w, 200, map[string]any{"items": out})
}

func catalogError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, application.ErrValidation) {
		apiFailure(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid resource values")
		return
	}
	mappedError(w, r, err)
}

func publicProviderDTO(p application.PublicProvider) any {
	return map[string]any{"id": p.ID, "name": p.Name, "slug": p.Slug, "headline": p.Headline, "bio": p.Bio, "avatarUrl": p.AvatarURL, "avatarVariant": p.AvatarVariant, "location": p.Location, "wallet": p.Wallet}
}
func (h *handler) getPublicProviderBySlug(w http.ResponseWriter, r *http.Request) {
	slug, err := domain.NormalizeSlug(chi.URLParam(r, "slug"))
	if err != nil {
		catalogError(w, r, application.ErrValidation)
		return
	}
	p, err := h.catalog.Store.GetPublicProviderBySlug(r.Context(), slug)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, publicProviderDTO(p))
}
func (h *handler) listCategories(w http.ResponseWriter, _ *http.Request) {
	respond(w, 200, map[string]any{"items": domain.Categories()})
}
