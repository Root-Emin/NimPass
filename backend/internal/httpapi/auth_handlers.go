package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

type challengeRequest struct {
	Wallet string `json:"wallet"`
}
type challengeResponse struct {
	ID        domain.ID `json:"id"`
	Purpose   string    `json:"purpose"`
	Wallet    string    `json:"wallet"`
	Message   string    `json:"message"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func challengeDTO(c application.Challenge) challengeResponse {
	return challengeResponse{ID: c.ID, Purpose: c.Purpose, Wallet: c.Wallet, Message: c.Message(), ExpiresAt: c.ExpiresAt}
}

func (h *handler) createLoginChallenge(w http.ResponseWriter, r *http.Request) {
	var req challengeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	wallet, err := nimiq.ValidateAddress(req.Wallet)
	if err != nil {
		apiFailure(w, r, 400, "VALIDATION_ERROR", "Invalid Nimiq wallet")
		return
	}
	if !h.allow(r, "challenge-ip:"+h.clientIP(r), 20, 5*time.Minute) || !h.allow(r, "challenge-wallet:"+wallet, 10, 5*time.Minute) {
		apiFailure(w, r, 429, "RATE_LIMITED", "Too many challenges")
		return
	}
	c, err := h.auth.NewChallenge(r.Context(), application.AuthLogin, wallet, "")
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 201, challengeDTO(c))
}

type proofRequest struct {
	ChallengeID    string `json:"challengeId"`
	Wallet         string `json:"wallet"`
	PublicKey      string `json:"publicKey"`
	Signature      string `json:"signature"`
	SigningScheme  string `json:"signingScheme,omitempty"`
	OwnerPublicKey string `json:"ownerPublicKey,omitempty"`
	OwnerSignature string `json:"ownerSignature,omitempty"`
}
type loginProofRequest struct {
	ChallengeID   string `json:"challengeId"`
	Wallet        string `json:"wallet"`
	PublicKey     string `json:"publicKey"`
	Signature     string `json:"signature"`
	SigningScheme string `json:"signingScheme,omitempty"`
}

// validSigningScheme accepts only the two names the verifier implements.
//
// A client says which documented preprocessing produced its signature: "hub"
// for the Nimiq Hub, whose envelope is specified, and nothing at all for the
// Mini App provider, whose preprocessing is not — that path stays on the
// deployment's configured NIMIQ_SIGNING_SCHEME. Anything else is a 400 rather
// than a silent fallback, so an unknown value can never be verified under some
// other scheme by accident.
func validSigningScheme(scheme string) bool {
	return scheme == "" || scheme == "raw" || scheme == "hub"
}

func compactNQLength(wallet string) int {
	return len(strings.ReplaceAll(wallet, " ", ""))
}

func proofFrom(w http.ResponseWriter, r *http.Request, p proofRequest) (application.Proof, bool) {
	id, ok := parsedID(w, r, p.ChallengeID)
	if !ok {
		return application.Proof{}, false
	}
	// Compact Nimiq addresses are 36 characters. Hub chooseAddress() returns
	// the user-friendly form with spaces ("NQ41 CDMJ … N9Y2"), which is 44.
	// ChallengeInput already accepts that spelling; this bound must too, or
	// every real Hub login proof dies here as "Invalid proof fields".
	if len(p.PublicKey) != 64 || len(p.Signature) != 128 || compactNQLength(p.Wallet) > 36 || len(p.OwnerPublicKey) > 64 || len(p.OwnerSignature) > 128 {
		apiFailure(w, r, 400, "VALIDATION_ERROR", "Invalid proof fields")
		return application.Proof{}, false
	}
	if !validSigningScheme(p.SigningScheme) {
		apiFailure(w, r, 400, "VALIDATION_ERROR", "Unsupported signing scheme")
		return application.Proof{}, false
	}
	return application.Proof{ChallengeID: id, Wallet: p.Wallet, PublicKey: p.PublicKey, Signature: p.Signature, SigningScheme: p.SigningScheme, OwnerPublicKey: p.OwnerPublicKey, OwnerSignature: p.OwnerSignature}, true
}
func identityDTO(i application.Identity) any {
	return map[string]any{"id": i.ID, "wallet": i.Wallet, "createdAt": i.CreatedAt}
}

func (h *handler) completeLogin(w http.ResponseWriter, r *http.Request) {
	if !h.allow(r, "verify-ip:"+h.clientIP(r), 40, 5*time.Minute) {
		apiFailure(w, r, 429, "RATE_LIMITED", "Too many attempts")
		return
	}
	var req loginProofRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, ok := proofFrom(w, r, proofRequest{ChallengeID: req.ChallengeID, Wallet: req.Wallet, PublicKey: req.PublicKey, Signature: req.Signature, SigningScheme: req.SigningScheme})
	if !ok {
		return
	}
	s, token, csrf, err := h.auth.Login(r.Context(), p)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	h.setSessionCookie(w, token, int(application.SessionTTL.Seconds()))
	respond(w, 201, map[string]any{"identity": identityDTO(s.Identity), "expiresAt": s.ExpiresAt, "csrfToken": csrf})
}
func (h *handler) currentSession(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	cookie, _ := r.Cookie(h.cookieName())
	respond(w, 200, map[string]any{"identity": identityDTO(s.Identity), "expiresAt": s.ExpiresAt, "csrfToken": application.CSRFToken(cookie.Value)})
}
func (h *handler) logout(w http.ResponseWriter, r *http.Request) {
	s := sessionFrom(r)
	if err := h.auth.Store.RevokeSession(r.Context(), s.ID, h.auth.Now().UTC()); err != nil {
		mappedError(w, r, err)
		return
	}
	h.setSessionCookie(w, "", -1)
	w.WriteHeader(http.StatusNoContent)
}

func (h *handler) createPayoutChallenge(w http.ResponseWriter, r *http.Request) {
	providerID, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	s := sessionFrom(r)
	if _, err := h.catalog.Store.GetProvider(r.Context(), providerID, s.Identity.ID); err != nil {
		mappedError(w, r, err)
		return
	}
	var req challengeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	wallet, err := nimiq.ValidateAddress(req.Wallet)
	if err != nil {
		apiFailure(w, r, 400, "VALIDATION_ERROR", "Invalid Nimiq wallet")
		return
	}
	if !h.allow(r, "payout-ip:"+h.clientIP(r), 20, 5*time.Minute) || !h.allow(r, "payout-provider:"+string(providerID), 10, 5*time.Minute) {
		apiFailure(w, r, 429, "RATE_LIMITED", "Too many challenges")
		return
	}
	c, err := h.auth.NewChallenge(r.Context(), application.VerifyProviderWallet, wallet, providerID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 201, challengeDTO(c))
}
func (h *handler) verifyPayout(w http.ResponseWriter, r *http.Request) {
	providerID, ok := parsedID(w, r, chi.URLParam(r, "providerID"))
	if !ok {
		return
	}
	s := sessionFrom(r)
	if _, err := h.catalog.Store.GetProvider(r.Context(), providerID, s.Identity.ID); err != nil {
		mappedError(w, r, err)
		return
	}
	if !h.allow(r, "payout-verify-ip:"+h.clientIP(r), 40, 5*time.Minute) {
		apiFailure(w, r, 429, "RATE_LIMITED", "Too many attempts")
		return
	}
	var req proofRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, ok := proofFrom(w, r, req)
	if !ok {
		return
	}
	if len(p.OwnerPublicKey) != 64 || len(p.OwnerSignature) != 128 {
		apiFailure(w, r, 400, "VALIDATION_ERROR", "Owner step-up signature required")
		return
	}
	if err := h.auth.VerifyPayout(r.Context(), s.Identity, providerID, p); err != nil {
		mappedError(w, r, err)
		return
	}
	provider, err := h.catalog.Store.GetProvider(r.Context(), providerID, s.Identity.ID)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	respond(w, 200, providerDTO(provider))
}
