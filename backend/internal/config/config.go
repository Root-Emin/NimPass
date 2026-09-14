package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	Environment       string
	HTTPAddress       string
	DatabaseURL       string
	Network           string
	RPCURL            string
	PublicOrigin      string
	CookieSecure      bool
	CookieMode        string
	TrustedProxyCIDRs []string
}

func Load() (Config, error) {
	return Parse(os.Getenv)
}

func Parse(getenv func(string) string) (Config, error) {
	c := Config{
		Environment:       strings.TrimSpace(getenv("APP_ENV")),
		HTTPAddress:       fallback(getenv("HTTP_ADDR"), ":8080"),
		DatabaseURL:       strings.TrimSpace(getenv("DATABASE_URL")),
		Network:           strings.TrimSpace(getenv("NIMIQ_NETWORK")),
		RPCURL:            strings.TrimSpace(getenv("NIMIQ_RPC_URL")),
		PublicOrigin:      strings.TrimRight(strings.TrimSpace(getenv("PUBLIC_ORIGIN")), "/"),
		CookieMode:        fallback(getenv("SESSION_COOKIE_MODE"), "secure"),
		TrustedProxyCIDRs: splitList(getenv("TRUSTED_PROXY_CIDRS")),
	}
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
	if c.Environment == "production" && u.Query().Get("sslmode") == "disable" {
		return Config{}, errors.New("production DATABASE_URL cannot disable TLS")
	}
	if c.Network != "TESTNET" && c.Network != "MAINNET" {
		return Config{}, errors.New("NIMIQ_NETWORK must be TESTNET or MAINNET")
	}
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
	if err != nil || origin.Host == "" || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" || (origin.Scheme != "http" && origin.Scheme != "https") {
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
