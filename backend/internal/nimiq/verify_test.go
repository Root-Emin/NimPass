package nimiq

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"testing"
)

func TestAddressChecksumAndRealSignature(t *testing.T) {
	if got, err := ValidateAddress("NQ07 " + strings.Repeat("0", 32)); err != nil || got != "NQ07"+strings.Repeat("0", 32) {
		t.Fatalf("known Nimiq zero address: %q %v", got, err)
	}
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	wallet, err := AddressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateAddress(wallet); err != nil {
		t.Fatal(err)
	}
	message := "NIMPASS\nPurpose: AUTH_LOGIN\nChallenge: test"
	signature := hex.EncodeToString(ed25519.Sign(private, []byte(message)))
	verifier := Ed25519Verifier{}
	if err := verifier.Verify(message, wallet, hex.EncodeToString(pub), signature); err != nil {
		t.Fatal(err)
	}
	if err := verifier.Verify(message+"x", wallet, hex.EncodeToString(pub), signature); err == nil {
		t.Fatal("modified message accepted")
	}
	otherPub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifier.Verify(message, wallet, hex.EncodeToString(otherPub), signature); err == nil {
		t.Fatal("wrong public key accepted")
	}
	if err := verifier.Verify(message, "NQ07"+strings.Repeat("0", 32), hex.EncodeToString(pub), signature); err == nil {
		t.Fatal("wrong wallet accepted")
	}
}

func TestSigningPreprocessorsAreExplicitAndNeverFallback(t *testing.T) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	wallet, err := AddressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	message := "NIMPASS\nPurpose: AUTH_LOGIN\nChallenge: fixture"
	signature := hex.EncodeToString(ed25519.Sign(private, HubSignedMessage(message)))
	raw := Ed25519Verifier{Preprocess: RawMessage}
	if raw.Verify(message, wallet, hex.EncodeToString(pub), signature) == nil {
		t.Fatal("production raw scheme silently accepted envelope signature")
	}
	hub := Ed25519Verifier{Preprocess: HubSignedMessage}
	if err := hub.Verify(message, wallet, hex.EncodeToString(pub), signature); err != nil {
		t.Fatal(err)
	}
}
