package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"nimpass/backend/internal/domain"
)

type Config struct {
	Environment   string
	MigrationsDir string
	HTTPAddress   string
	DatabaseURL   string
	Network       string
	RPCURL        string
	SigningScheme string
	// ConfirmationPolicy is how much chain certainty a payment must have
	// accumulated before the purchase confirms and the Pass is issued.
	//
	// A risk decision, so it is configuration rather than code: `inclusion`
	// issues the Pass on a validated canonical micro-block inclusion and
	// tracks finality afterwards, `finality` waits for the macro block first
	// (ADR-021). Neither relaxes any economic check.
	ConfirmationPolicy domain.ConfirmationPolicy
	PublicOrigin       string
	CookieSecure       bool
	CookieMode         string
	TrustedProxyCIDRs  []string
	MediaDir           string
}

func Load() (Config, error) {
	return Parse(os.Getenv)
}

func Parse(getenv func(string) string) (Config, error) {
	c := Config{
		Environment:       strings.TrimSpace(getenv("APP_ENV")),
		MigrationsDir:     fallback(getenv("MIGRATIONS_DIR"), "migrations"),
		HTTPAddress:       fallback(getenv("HTTP_ADDR"), ":8080"),
		DatabaseURL:       strings.TrimSpace(getenv("DATABASE_URL")),
		Network:           strings.TrimSpace(getenv("NIMIQ_NETWORK")),
		RPCURL:            strings.TrimSpace(getenv("NIMIQ_RPC_URL")),
		SigningScheme:     fallback(getenv("NIMIQ_SIGNING_SCHEME"), "raw"),
		PublicOrigin:      strings.TrimRight(strings.TrimSpace(getenv("PUBLIC_ORIGIN")), "/"),
		CookieMode:        fallback(getenv("SESSION_COOKIE_MODE"), "secure"),
		TrustedProxyCIDRs: splitList(getenv("TRUSTED_PROXY_CIDRS")),
	}
	mediaDir, err := filepath.Abs(fallback(getenv("MEDIA_DIR"), "var/media"))
	if err != nil {
		return Config{}, errors.New("MEDIA_DIR must be a usable directory path")
	}
	c.MediaDir = mediaDir
	if c.Environment != "development" && c.Environment != "test" && c.Environment != "production" {
		return Config{}, fmt.Errorf("APP_ENV must be development, test or production")
	}
	if _, port, err := net.SplitHostPort(c.HTTPAddress); err != nil || port == "" {
		return Config{}, fmt.Errorf("HTTP_ADDR must contain a host/port or :port")
	}
	if c.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	u, err := url.Parse(c.DatabaseURL)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Host == "" || strings.TrimPrefix(u.Path, "/") == "" {
		return Config{}, errors.New("DATABASE_URL must be a PostgreSQL URL with a database name")
	}
	if c.Environment == "production" && (u.Query().Get("sslmode") != "require" && u.Query().Get("sslmode") != "verify-ca" && u.Query().Get("sslmode") != "verify-full") {
		return Config{}, errors.New("production DATABASE_URL requires sslmode=require, verify-ca or verify-full")
	}
	if c.Network != "TESTNET" && c.Network != "MAINNET" {
		return Config{}, errors.New("NIMIQ_NETWORK must be TESTNET or MAINNET")
	}
	if (c.Environment == "production") != (c.Network == "MAINNET") {
		return Config{}, errors.New("production requires MAINNET; development/test requires TESTNET")
	}
	// Which envelope Nimiq Pay signs is not stated by the Mini Apps
	// documentation, and the SDK forwards the message untouched, so the scheme
	// is settled by a device fixture rather than by reading a spec
	// (see internal/nimiq/verify.go). Keeping it in configuration means the
	// answer can be applied without changing verification code; the value is
	// still explicit and single, never a silent fallback between schemes.
	if c.SigningScheme != "raw" && c.SigningScheme != "hub" {
		return Config{}, errors.New("NIMIQ_SIGNING_SCHEME must be raw or hub")
	}
	// Defaulted to `inclusion`, which is the product's settlement rule
	// (ADR-021) and what makes checkout finish in seconds rather than a batch.
	// The default is applied here, once, where it is visible in configuration;
	// anything present and unrecognised is refused outright rather than
	// resolving to either policy, because a typo must not quietly choose a
	// risk posture.
	policy, err := domain.ParseConfirmationPolicy(fallback(getenv("NIMIQ_CONFIRMATION_POLICY"), string(domain.ConfirmOnInclusion)))
	if err != nil {
		return Config{}, fmt.Errorf("NIMIQ_CONFIRMATION_POLICY: %w", err)
	}
	c.ConfirmationPolicy = policy
	if c.RPCURL == "" && c.Environment != "test" {
		return Config{}, errors.New("NIMIQ_RPC_URL is required")
	}
	if c.RPCURL != "" {
		rpc, err := url.Parse(c.RPCURL)
		if err != nil || rpc.Host == "" || rpc.Fragment != "" || rpc.RawQuery != "" || (rpc.Scheme != "https" && rpc.Scheme != "http") {
			return Config{}, errors.New("NIMIQ_RPC_URL must be a fixed http(s) endpoint")
		}
		if rpc.Scheme == "http" && (c.Environment == "production" || (rpc.Hostname() != "localhost" && rpc.Hostname() != "127.0.0.1" && rpc.Hostname() != "::1")) {
			return Config{}, errors.New("NIMIQ_RPC_URL requires HTTPS except local development")
		}
	}
	if c.PublicOrigin == "" {
		return Config{}, errors.New("PUBLIC_ORIGIN is required")
	}
	origin, err := url.Parse(c.PublicOrigin)
	if err != nil || origin.Host == "" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" || (origin.Scheme != "http" && origin.Scheme != "https") {
		return Config{}, errors.New("PUBLIC_ORIGIN must be an http(s) origin without path")
	}
	if c.Environment == "production" && origin.Scheme != "https" {
		return Config{}, errors.New("production PUBLIC_ORIGIN must use HTTPS")
	}
	if c.CookieMode != "secure" && c.CookieMode != "local-insecure" {
		return Config{}, errors.New("SESSION_COOKIE_MODE must be secure or local-insecure")
	}
	if c.CookieMode == "local-insecure" && (c.Environment == "production" || origin.Scheme != "http") {
		return Config{}, errors.New("local-insecure cookies require non-production HTTP origin")
	}
	for _, cidr := range c.TrustedProxyCIDRs {
		if _, _, err := net.ParseCIDR(cidr); err != nil {
			return Config{}, fmt.Errorf("TRUSTED_PROXY_CIDRS contains invalid CIDR %q", cidr)
		}
	}
	c.CookieSecure = c.CookieMode == "secure"
	return c, nil
}

func fallback(value, defaultValue string) string {
	if strings.TrimSpace(value) == "" {
		return defaultValue
	}
	return strings.TrimSpace(value)
}

func splitList(value string) []string {
	var result []string
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			result = append(result, item)
		}
	}
	return result
}
