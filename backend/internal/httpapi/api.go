package httpapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/config"
	"nimpass/backend/internal/domain"
)

type handler struct {
	auth        application.Auth
	catalog     application.Catalog
	payments    application.Payments
	redemptions application.Redemptions
	cfg         config.Config
	limits      *limiter
}

type sessionKey struct{}

func (h *handler) cookieName() string {
	if h.cfg.CookieSecure {
		return "__Host-nimpass_session"
	}
	return "nimpass_session"
}

func (h *handler) setSessionCookie(w http.ResponseWriter, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: h.cookieName(), Value: token, Path: "/", HttpOnly: true, Secure: h.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}

func (h *handler) originAndCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == h.cfg.PublicOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			if origin != h.cfg.PublicOrigin {
				apiFailure(w, r, http.StatusForbidden, "ORIGIN_FORBIDDEN", "Origin not allowed")
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Idempotency-Key")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if origin == "" {
				ref, err := url.Parse(r.Referer())
				if err == nil && ref.Host != "" {
					origin = ref.Scheme + "://" + ref.Host
				}
			}
			if origin != h.cfg.PublicOrigin {
				apiFailure(w, r, http.StatusForbidden, "ORIGIN_FORBIDDEN", "Origin not allowed")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func sanitizeRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		value := r.Header.Get(middleware.RequestIDHeader)
		if !safeRequestID(value) {
			r.Header.Del(middleware.RequestIDHeader)
		}
		next.ServeHTTP(w, r)
	})
}

func safeRequestID(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') && !strings.ContainsRune("-_.:/", char) {
			return false
		}
	}
	return true
}

func (h *handler) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(h.cookieName())
		if err != nil {
			apiFailure(w, r, http.StatusUnauthorized, "AUTH_REQUIRED", "Authentication required")
			return
		}
		s, err := h.auth.Authenticate(r.Context(), cookie.Value)
		if err != nil {
			apiFailure(w, r, http.StatusUnauthorized, "AUTH_REQUIRED", "Authentication required")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			token := r.Header.Get("X-CSRF-Token")
			if len(token) != 64 {
				apiFailure(w, r, http.StatusForbidden, "CSRF_INVALID", "CSRF token required")
				return
			}
			digest := sha256.Sum256([]byte(token))
			if subtle.ConstantTimeCompare(digest[:], s.CSRFDigest[:]) != 1 || token != application.CSRFToken(cookie.Value) {
				apiFailure(w, r, http.StatusForbidden, "CSRF_INVALID", "CSRF token invalid")
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), sessionKey{}, s)))
	})
}

func sessionFrom(r *http.Request) application.Session {
	return r.Context().Value(sessionKey{}).(application.Session)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		apiFailure(w, r, http.StatusUnsupportedMediaType, "CONTENT_TYPE", "JSON required")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		apiFailure(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid JSON request")
		return false
	}
	if err := dec.Decode(new(any)); !errors.Is(err, io.EOF) {
		apiFailure(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "One JSON object required")
		return false
	}
	return true
}
func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func apiFailure(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	respond(w, status, map[string]any{"error": map[string]string{"code": code, "message": message, "requestId": middleware.GetReqID(r.Context())}})
}
func mappedError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, application.ErrNotFound):
		apiFailure(w, r, 404, "NOT_FOUND", "Resource not found")
	case errors.Is(err, application.ErrExpired):
		apiFailure(w, r, 410, "CHALLENGE_EXPIRED", "Challenge expired")
	case errors.Is(err, application.ErrConsumed):
		apiFailure(w, r, 409, "CHALLENGE_CONSUMED", "Challenge already used or unavailable")
	case errors.Is(err, application.ErrInvalidSignature):
		apiFailure(w, r, 401, "INVALID_SIGNATURE", "Wallet signature invalid")
	case errors.Is(err, application.ErrForbidden):
		apiFailure(w, r, 403, "FORBIDDEN", "Not authorized")
	case errors.Is(err, application.ErrConflict):
		apiFailure(w, r, 409, "CONFLICT", "Invalid state transition")
	case errors.Is(err, application.ErrPassNotFound):
		apiFailure(w, r, 404, "PASS_NOT_FOUND", "Pass not found")
	case errors.Is(err, application.ErrPassNotOwned):
		apiFailure(w, r, 403, "PASS_NOT_OWNED", "Pass is not owned by this wallet")
	case errors.Is(err, application.ErrPassExpired):
		apiFailure(w, r, 410, "PASS_EXPIRED", "Pass expired")
	case errors.Is(err, application.ErrPassCompleted):
		apiFailure(w, r, 409, "PASS_COMPLETED", "Pass is completed")
	case errors.Is(err, application.ErrRedemptionChallengeExpired):
		apiFailure(w, r, 410, "REDEMPTION_CHALLENGE_EXPIRED", "Redemption challenge expired")
	case errors.Is(err, application.ErrRedemptionConsumed):
		apiFailure(w, r, 409, "REDEMPTION_ALREADY_CONSUMED", "Redemption was already consumed")
	case errors.Is(err, application.ErrRedemptionNotAuthorized):
		apiFailure(w, r, 409, "REDEMPTION_NOT_AUTHORIZED", "Redemption is not authorized")
	case errors.Is(err, application.ErrInvalidRedemptionSignature):
		apiFailure(w, r, 401, "INVALID_REDEMPTION_SIGNATURE", "Redemption signature invalid")
	case errors.Is(err, application.ErrStaleRedemptionChallenge):
		apiFailure(w, r, 409, "STALE_REDEMPTION_CHALLENGE", "Redemption challenge is stale")
	case errors.Is(err, application.ErrInvalidRedemptionToken):
		apiFailure(w, r, 404, "INVALID_REDEMPTION_TOKEN", "Invalid redemption reference")
	case errors.Is(err, application.ErrTooManyAttempts):
		apiFailure(w, r, 429, "RATE_LIMITED", "Too many attempts")
	default:
		apiFailure(w, r, 500, "INTERNAL_ERROR", "Internal server error")
	}
}
func parsedID(w http.ResponseWriter, r *http.Request, value string) (domain.ID, bool) {
	id, err := domain.ParseID(value)
	if err != nil {
		apiFailure(w, r, 400, "VALIDATION_ERROR", "Invalid resource ID")
		return "", false
	}
	return id, true
}
func (h *handler) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer := net.ParseIP(host)
	if peer == nil {
		return "unknown"
	}
	if !h.isTrustedProxy(peer) {
		return peer.String()
	}
	forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
	if forwarded == "" {
		return peer.String()
	}
	parts := strings.Split(forwarded, ",")
	parsed := make([]net.IP, len(parts))
	for i, part := range parts {
		parsed[i] = net.ParseIP(strings.TrimSpace(part))
		if parsed[i] == nil {
			return peer.String()
		}
	}
	for i := len(parsed) - 1; i >= 0; i-- {
		if !h.isTrustedProxy(parsed[i]) {
			return parsed[i].String()
		}
	}
	return parsed[0].String()
}

func (h *handler) isTrustedProxy(ip net.IP) bool {
	for _, cidr := range h.cfg.TrustedProxyCIDRs {
		_, network, err := net.ParseCIDR(cidr)
		if err == nil && network.Contains(ip) {
			return true
		}
	}
	return false
}

type limitEntry struct {
	Count int
	Reset time.Time
}
type limiter struct {
	mu      sync.Mutex
	entries map[string]limitEntry
}

func newLimiter() *limiter { return &limiter{entries: make(map[string]limitEntry)} }
func (l *limiter) Allow(key string, max int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	entry, exists := l.entries[key]
	if !exists && len(l.entries) >= 10000 {
		for k, v := range l.entries {
			if now.After(v.Reset) {
				delete(l.entries, k)
			}
		}
		if len(l.entries) >= 10000 {
			return false
		}
	}
	if now.After(entry.Reset) {
		entry = limitEntry{Reset: now.Add(window)}
	}
	if entry.Count >= max {
		return false
	}
	entry.Count++
	l.entries[key] = entry
	return true
}
