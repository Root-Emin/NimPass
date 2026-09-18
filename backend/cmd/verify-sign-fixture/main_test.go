package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"nimpass/backend/internal/nimiq"
	"strings"
	"testing"
)

func TestFixtureReportsSchemesAndWalletWithoutLeakingCapture(t *testing.T) {
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	wallet, err := nimiq.AddressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	for _, pre := range []nimiq.MessagePreprocessor{nimiq.RawMessage, nimiq.HubSignedMessage} {
		f := fixture{Wallet: wallet, Message: "NIMPASS\nPurpose: AUTH_LOGIN\nUnicode: İstanbul", PublicKey: hex.EncodeToString(pub)}
		f.Signature = hex.EncodeToString(ed25519.Sign(key, pre(f.Message)))
		data, _ := json.Marshal(f)
		var out bytes.Buffer
		if code := run([]string{"-fixture", "-"}, bytes.NewReader(data), &out); code != 0 {
			t.Fatalf("exit %d: %s", code, out.String())
		}
		if !strings.Contains(out.String(), "matches expected: true") {
			t.Fatal(out.String())
		}
		for _, secret := range []string{f.Message, f.PublicKey, f.Signature, f.Wallet} {
			if strings.Contains(out.String(), secret) {
				t.Fatal("capture leaked")
			}
		}
		f.Wallet = "NQ07" + strings.Repeat("0", 32)
		data, _ = json.Marshal(f)
		out.Reset()
		if code := run([]string{"-fixture", "-"}, bytes.NewReader(data), &out); code != 1 || !strings.Contains(out.String(), "matches expected: false") {
			t.Fatalf("wrong wallet: %d %s", code, out.String())
		}
	}
	var out bytes.Buffer
	if run([]string{"-fixture", "-"}, strings.NewReader(`{"privateKey":"never accepted"}`), &out) != 2 {
		t.Fatal("unknown fixture field accepted")
	}
}
