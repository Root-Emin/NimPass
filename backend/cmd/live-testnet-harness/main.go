// Command live-testnet-harness drives the real Nimpass HTTP API for an
// explicitly opt-in Testnet validation. It never creates a wallet, signs a
// message, or handles a private key. Customer signatures must be captured from
// Nimiq Pay and supplied as publicKey/signature hex values.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const maxResponseBytes = 1 << 20

type apiClient struct {
	baseURL    string
	origin     string
	cookieName string
	session    string
	csrf       string
	http       *http.Client
}

func main() {
	phase := flag.String("phase", "", "intent, submit, challenge, authorize, lookup, or confirm")
	pollCount := flag.Int("poll-count", 18, "number of submit reconciliation attempts")
	pollInterval := flag.Duration("poll-interval", 10*time.Second, "delay between reconciliation attempts")
	flag.Parse()
	if err := validateOptIn(); err != nil {
		fatal(err)
	}
	client, err := newClient(*phase)
	if err != nil {
		fatal(err)
	}
	switch *phase {
	case "intent":
		fatalIf(runIntent(client))
	case "submit":
		fatalIf(runSubmit(client, *pollCount, *pollInterval))
	case "challenge":
		fatalIf(runChallenge(client))
	case "authorize":
		fatalIf(runAuthorize(client))
	case "lookup":
		fatalIf(runLookup(client))
	case "confirm":
		fatalIf(runConfirm(client))
	default:
		fatal(errors.New("-phase must be intent, submit, challenge, authorize, lookup, or confirm"))
	}
}

func validateOptIn() error {
	if os.Getenv("LIVE_TESTNET_CONFIRM") != "YES" {
		return errors.New("set LIVE_TESTNET_CONFIRM=YES for explicit live Testnet execution")
	}
	if os.Getenv("NIMIQ_NETWORK") != "TESTNET" {
		return errors.New("live-testnet-harness refuses any NIMIQ_NETWORK other than TESTNET")
	}
	return nil
}

func newClient(phase string) (apiClient, error) {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("NIMPASS_API_ORIGIN")), "/")
	origin := strings.TrimRight(strings.TrimSpace(os.Getenv("NIMPASS_PUBLIC_ORIGIN")), "/")
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return apiClient{}, errors.New("NIMPASS_API_ORIGIN must be an http(s) origin without a path")
	}
	if origin == "" {
		return apiClient{}, errors.New("NIMPASS_PUBLIC_ORIGIN is required and must match backend PUBLIC_ORIGIN")
	}
	if phase == "lookup" || phase == "confirm" {
		return clientFromEnv(base, origin, "PROVIDER")
	}
	return clientFromEnv(base, origin, "CUSTOMER")
}

func clientFromEnv(base, origin, role string) (apiClient, error) {
	session := strings.TrimSpace(os.Getenv("NIMPASS_" + role + "_SESSION"))
	csrf := strings.TrimSpace(os.Getenv("NIMPASS_" + role + "_CSRF"))
	if len(session) != 64 || len(csrf) != 64 {
		return apiClient{}, fmt.Errorf("NIMPASS_%s_SESSION and NIMPASS_%s_CSRF must be 64-character hex values", role, role)
	}
	return apiClient{baseURL: base, origin: origin, cookieName: cookieName(), session: session, csrf: csrf, http: &http.Client{Timeout: 20 * time.Second}}, nil
}

func cookieName() string {
	if value := strings.TrimSpace(os.Getenv("NIMPASS_COOKIE_NAME")); value != "" {
		return value
	}
	return "__Host-nimpass_session"
}

func (c apiClient) call(method, path string, body any, idempotency string) (map[string]any, error) {
	var payload io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		payload = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, c.baseURL+path, payload)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Origin", c.origin)
	req.Header.Set("Cookie", c.cookieName+"="+c.session)
	if method != http.MethodGet {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", c.csrf)
	}
	if idempotency != "" {
		req.Header.Set("Idempotency-Key", idempotency)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxResponseBytes {
		return nil, errors.New("backend response exceeded harness limit")
	}
	var result map[string]any
	if len(data) > 0 && json.Unmarshal(data, &result) != nil {
		return nil, fmt.Errorf("backend returned non-JSON status %d", response.StatusCode)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("backend returned status %d code=%s", response.StatusCode, errorCode(result))
	}
	return result, nil
}

func runIntent(client apiClient) error {
	packageID := required("NIMPASS_PACKAGE_ID")
	key := os.Getenv("NIMPASS_IDEMPOTENCY_KEY")
	if key == "" {
		key = "live-testnet-" + time.Now().UTC().Format("20060102T150405.000000000Z")
	}
	result, err := client.call(http.MethodPost, "/api/v1/purchases", map[string]string{"packageId": packageID}, key)
	if err != nil {
		return err
	}
	printJSON(map[string]any{"purchaseIntentId": result["purchaseIntentId"], "status": result["status"], "paymentRequest": result["paymentRequest"]})
	return nil
}

func runSubmit(client apiClient, pollCount int, pollInterval time.Duration) error {
	purchaseID := required("NIMPASS_PURCHASE_ID")
	txHash := required("NIMPASS_TX_HASH")
	if _, err := client.call(http.MethodPost, "/api/v1/purchases/"+url.PathEscape(purchaseID)+"/transactions", map[string]string{"txHash": txHash}, ""); err != nil {
		return err
	}
	for attempt := 1; attempt <= pollCount; attempt++ {
		result, err := client.call(http.MethodPost, "/api/v1/purchases/"+url.PathEscape(purchaseID)+"/reconcile", nil, "")
		if err != nil {
			return err
		}
		status, _ := result["status"].(string)
		printJSON(map[string]any{"attempt": attempt, "status": status, "passId": result["passId"], "paymentVerification": result["paymentVerification"], "compensation": result["compensation"]})
		if result["passId"] != nil && result["passId"] != "" {
			return nil
		}
		if status == "compensation_required" || status == "permanently_failed" {
			return fmt.Errorf("purchase did not provision a Pass: %s", status)
		}
		if attempt < pollCount {
			time.Sleep(pollInterval)
		}
	}
	return errors.New("pass was not provisioned within the polling window")
}

func runChallenge(client apiClient) error {
	passID := required("NIMPASS_PASS_ID")
	result, err := client.call(http.MethodPost, "/api/v1/passes/"+url.PathEscape(passID)+"/redemption-challenges", nil, "")
	if err != nil {
		return err
	}
	printJSON(map[string]any{"challengeId": result["challengeId"], "passId": result["passId"], "message": result["message"], "expiresAt": result["expiresAt"]})
	return nil
}

func runAuthorize(client apiClient) error {
	challengeID := required("NIMPASS_CHALLENGE_ID")
	result, err := client.call(http.MethodPost, "/api/v1/redemption-challenges/"+url.PathEscape(challengeID)+"/authorization", map[string]string{"publicKey": required("NIMPASS_PUBLIC_KEY"), "signature": required("NIMPASS_SIGNATURE")}, "")
	if err != nil {
		return err
	}
	printJSON(map[string]any{"challengeId": result["challengeId"], "redemptionReference": result["redemptionReference"], "qrExpiresAt": result["qrExpiresAt"]})
	return nil
}

func runLookup(client apiClient) error {
	providerID := required("NIMPASS_PROVIDER_ID")
	reference := required("NIMPASS_REDEMPTION_REFERENCE")
	result, err := client.call(http.MethodPost, "/api/v1/providers/"+url.PathEscape(providerID)+"/redemptions/lookup", map[string]string{"redemptionReference": reference}, "")
	if err != nil {
		return err
	}
	printJSON(result)
	return nil
}

func runConfirm(client apiClient) error {
	providerID := required("NIMPASS_PROVIDER_ID")
	reference := required("NIMPASS_REDEMPTION_REFERENCE")
	result, err := client.call(http.MethodPost, "/api/v1/providers/"+url.PathEscape(providerID)+"/redemptions/confirm", map[string]string{"redemptionReference": reference}, "")
	if err != nil {
		return err
	}
	printJSON(result)
	return nil
}

func required(name string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		fatal(fmt.Errorf("%s is required", name))
	}
	return value
}

func errorCode(result map[string]any) string {
	if value, ok := result["error"].(map[string]any); ok {
		if code, ok := value["code"].(string); ok {
			return code
		}
	}
	return "unknown"
}

func printJSON(value any) {
	data, _ := json.MarshalIndent(value, "", "  ")
	fmt.Println(string(data))
}

func fatalIf(err error) {
	if err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "live-testnet-harness:", err)
	os.Exit(1)
}
