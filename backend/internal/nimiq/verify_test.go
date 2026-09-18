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

// TestVerifyAsAppliesExactlyTheNamedScheme covers the per-proof scheme that
// lets one deployment serve both wallet surfaces.
//
// The Nimiq Hub documents its signed-message envelope; the Nimiq Pay Mini App
// host documents nothing, so it stays on the configured default. The property
// under test is that naming a scheme selects exactly one preprocessor and never
// causes a second attempt — a signature must still mean one thing.
func TestVerifyAsAppliesExactlyTheNamedScheme(t *testing.T) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	wallet, err := AddressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	publicKey := hex.EncodeToString(pub)
	message := "NIMPASS\nVersion: 1\nPurpose: AUTH_LOGIN\nNonce: 7f3c"

	hubSignature := hex.EncodeToString(ed25519.Sign(private, HubSignedMessage(message)))
	rawSignature := hex.EncodeToString(ed25519.Sign(private, RawMessage(message)))

	// A deployment configured for the Mini App's unproven "raw" scheme.
	verifier := Ed25519Verifier{Preprocess: RawMessage}

	// A Hub proof names its scheme and verifies, even though the deployment
	// default is raw. Without this, desktop login cannot work at all.
	if err := verifier.VerifyAs("hub", message, wallet, publicKey, hubSignature); err != nil {
		t.Fatalf("hub proof rejected under its own scheme: %v", err)
	}
	// A Mini App proof names nothing and falls to the configured default.
	if err := verifier.VerifyAs("", message, wallet, publicKey, rawSignature); err != nil {
		t.Fatalf("mini app proof rejected under the deployment default: %v", err)
	}

	// Naming a scheme selects it and only it: the other preimage is refused,
	// so one named scheme still admits exactly one byte string.
	if verifier.VerifyAs("hub", message, wallet, publicKey, rawSignature) == nil {
		t.Fatal("raw signature accepted while hub was named")
	}
	if verifier.VerifyAs("raw", message, wallet, publicKey, hubSignature) == nil {
		t.Fatal("envelope signature accepted while raw was named")
	}

	// And a scheme the verifier does not implement is refused rather than
	// silently falling back to the default.
	if verifier.VerifyAs("auto", message, wallet, publicKey, rawSignature) == nil {
		t.Fatal("unknown scheme accepted")
	}

	// The scheme never loosens anything else. A different challenge, a wrong
	// wallet and a foreign key all still fail under the named scheme.
	if verifier.VerifyAs("hub", message+"x", wallet, publicKey, hubSignature) == nil {
		t.Fatal("modified message accepted under hub scheme")
	}
	otherPub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if verifier.VerifyAs("hub", message, wallet, hex.EncodeToString(otherPub), hubSignature) == nil {
		t.Fatal("foreign public key accepted under hub scheme")
	}
	if verifier.VerifyAs("hub", message, "NQ07"+strings.Repeat("0", 32), publicKey, hubSignature) == nil {
		t.Fatal("wrong wallet accepted under hub scheme")
	}
}
