package nimiq

import (
	"net/url"
	"strings"
	"testing"
)

// A real, checksum-valid Testnet address. ValidateAddress runs the IBAN mod-97
// check, so a made-up NQ string would be rejected and prove nothing.
const sampleAddress = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000"

func TestPaymentRequestURIMatchesTheOfficialEncoding(t *testing.T) {
	// 1000 NIM. The whole point of the amount rule: the link carries decimal
	// NIM, so a customer's wallet must open on 1000, not on 100,000,000.
	uri, err := PaymentRequestURI(sampleAddress, "1000", "NP1:"+strings.Repeat("a", 32))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	scheme, rest, ok := strings.Cut(uri, ":")
	if !ok || scheme != "nimiq" {
		t.Fatalf("expected a nimiq: URI, got %q", uri)
	}
	address, query, ok := strings.Cut(rest, "?")
	if !ok {
		t.Fatalf("expected a query string, got %q", uri)
	}
	if strings.Contains(address, " ") {
		t.Fatalf("the official encoder strips spaces from the address: %q", address)
	}
	if address != strings.ReplaceAll(sampleAddress, " ", "") {
		t.Fatalf("address = %q", address)
	}
	values, err := url.ParseQuery(query)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if got := values.Get("amount"); got != "1000" {
		t.Fatalf("amount = %q, want decimal NIM 1000 (not Luna)", got)
	}
	if got := values.Get("message"); got != "NP1:"+strings.Repeat("a", 32) {
		t.Fatalf("message = %q", got)
	}
}

func TestPaymentRequestURIRejectsWhatItCannotEncodeHonestly(t *testing.T) {
	long := "NP1:" + strings.Repeat("a", 90)
	for name, run := range map[string]func() (string, error){
		"invalid address":  func() (string, error) { return PaymentRequestURI("NQ00 BAD", "10", "") },
		"luna as amount":   func() (string, error) { return PaymentRequestURI(sampleAddress, "1000.000000", "") },
		"zero amount":      func() (string, error) { return PaymentRequestURI(sampleAddress, "0", "") },
		"empty amount":     func() (string, error) { return PaymentRequestURI(sampleAddress, "", "") },
		"float notation":   func() (string, error) { return PaymentRequestURI(sampleAddress, "1e3", "") },
		"trailing zero":    func() (string, error) { return PaymentRequestURI(sampleAddress, "1.50", "") },
		"message too long": func() (string, error) { return PaymentRequestURI(sampleAddress, "10", long) },
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := run(); err == nil {
				t.Fatal("expected a refusal rather than an improvised payment instruction")
			}
		})
	}
}

// The reference has to survive the 64-byte cap the official encoder documents,
// or the strongest correlation Nimpass has would be silently unusable.
func TestPaymentReferenceFitsTheMessageLimit(t *testing.T) {
	reference := "NP1:" + strings.Repeat("f", 32)
	if len(reference) != 36 {
		t.Fatalf("reference length = %d", len(reference))
	}
	if len(reference) > MaxRequestLinkMessageBytes {
		t.Fatalf("reference does not fit the %d-byte message limit", MaxRequestLinkMessageBytes)
	}
}
