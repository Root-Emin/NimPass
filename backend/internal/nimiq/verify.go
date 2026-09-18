// Package nimiq contains the Nimiq-specific public-key and signature adapter.
// It never handles private keys.
//
// Two wallet surfaces reach this verifier. The Mini App provider returns hex
// publicKey and signature values, and its exact signing preprocessor is not yet
// proven by a live Nimiq Pay fixture — that path stays on the configured
// NIMIQ_SIGNING_SCHEME. The Nimiq Hub documents its envelope, and a proof
// produced there names "hub" explicitly.
//
// A scheme is always chosen explicitly, never by trying alternatives until one
// succeeds: verification applies exactly one preprocessor per proof.
package nimiq

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"

	"golang.org/x/crypto/blake2b"
)

var alphabet = "0123456789ABCDEFGHJKLMNPQRSTUVXY"

type SignatureVerifier interface {
	// Verify checks a signature under the deployment's configured scheme.
	Verify(message, wallet, publicKeyHex, signatureHex string) error
	// VerifyAs checks a signature under a scheme the proof names. An empty
	// scheme means the deployment's configured one.
	VerifyAs(scheme, message, wallet, publicKeyHex, signatureHex string) error
}

type MessagePreprocessor func(string) []byte

func RawMessage(message string) []byte { return []byte(message) }

// PreprocessorFor resolves a signing scheme by name.
//
// "raw" verifies the Ed25519 signature over the message bytes exactly as the
// Mini App handed them to sign(). "hub" verifies over the Nimiq signed-message
// envelope below.
//
// The Mini Apps documentation (https://nimiq.dev/mini-apps/api-reference/nimiq-provider)
// specifies sign()'s parameters and result but not what the host signs, and
// @nimiq/mini-app-sdk forwards the message untouched, so that scheme cannot be
// settled from the published API alone. Settle it with a device capture — use
// cmd/verify-sign-fixture — and set NIMIQ_SIGNING_SCHEME accordingly.
func PreprocessorFor(scheme string) (MessagePreprocessor, error) {
	switch scheme {
	case "", "raw":
		return RawMessage, nil
	case "hub":
		return HubSignedMessage, nil
	default:
		return nil, errors.New("unknown Nimiq signing scheme")
	}
}

// HubSignedMessage is the Nimiq Hub's documented signed-message envelope:
//
//	sign(sha256("\x16Nimiq Signed Message:\n" + len(message) + message))
//
// Ref: https://nimiq.github.io/hub/api-reference/sign-message
//
// It is what @nimiq/hub-api's signMessage() produces, and it is NOT an
// automatic fallback for the Mini App sign() API. Which scheme applies is
// decided per proof by the client that produced the signature; see VerifyAs.
func HubSignedMessage(message string) []byte {
	payload := "\x16Nimiq Signed Message:\n" + strconv.Itoa(len([]byte(message))) + message
	hash := sha256.Sum256([]byte(payload))
	return hash[:]
}

type Ed25519Verifier struct{ Preprocess MessagePreprocessor }

// VerifyAs verifies under the scheme the proof names, falling back to the
// deployment's configured preprocessor when it names none.
//
// # Why a proof may name its own scheme
//
// Nimpass reaches wallets through two official surfaces. Hub documents its
// message envelope; the Mini App host's preprocessing is undocumented and
// stays on NIMIQ_SIGNING_SCHEME until a real-device fixture establishes it.
// A single scheme cannot be assumed compatible with both. The explicit scheme
// travels with the proof rather than with the
// challenge because it is a property of the wallet that produced the bytes, not
// of the challenge — the same challenge can legitimately be created in one
// runtime and signed in another after a reload.
//
// # Why this does not weaken verification
//
// Naming a scheme cannot change what a signature authorises. The message is
// always the server's own challenge, carrying a 32-byte nonce, the expected
// wallet, the purpose, the network, the environment and an expiry, and it is
// single-use. Both schemes are deterministic functions of exactly that string,
// so to satisfy either one an attacker still needs the challenge's own wallet
// to sign that specific nonce-bearing message; neither preimage is derivable
// from the other without the private key. What a proof may choose is which of
// two transforms of one message it claims, never which message.
func (v Ed25519Verifier) VerifyAs(scheme, message, wallet, publicKeyHex, signatureHex string) error {
	if scheme == "" {
		return v.Verify(message, wallet, publicKeyHex, signatureHex)
	}
	preprocess, err := PreprocessorFor(scheme)
	if err != nil {
		return err
	}
	return Ed25519Verifier{Preprocess: preprocess}.Verify(message, wallet, publicKeyHex, signatureHex)
}

func (v Ed25519Verifier) Verify(message, wallet, publicKeyHex, signatureHex string) error {
	pub, err := hex.DecodeString(publicKeyHex)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return errors.New("invalid public key")
	}
	sig, err := hex.DecodeString(signatureHex)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return errors.New("invalid signature")
	}
	address, err := AddressFromPublicKey(pub)
	if err != nil || address != normalize(wallet) {
		return errors.New("public key does not match wallet")
	}
	preprocess := v.Preprocess
	if preprocess == nil {
		preprocess = RawMessage
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), preprocess(message), sig) {
		return errors.New("signature verification failed")
	}
	return nil
}

func AddressFromPublicKey(publicKey []byte) (string, error) {
	if len(publicKey) != ed25519.PublicKeySize {
		return "", errors.New("invalid public key length")
	}
	hash := blake2b.Sum256(publicKey)
	data := base32.NewEncoding(alphabet).WithPadding(base32.NoPadding).EncodeToString(hash[:20])
	base := "NQ00" + data
	check := 98 - ibanMod(base)
	return "NQ" + string([]byte{'0' + byte(check/10), '0' + byte(check%10)}) + data, nil
}

func ValidateAddress(value string) (string, error) {
	value = normalize(value)
	if len(value) != 36 || !strings.HasPrefix(value, "NQ") || ibanMod(value) != 1 {
		return "", errors.New("invalid Nimiq address")
	}
	if _, err := base32.NewEncoding(alphabet).WithPadding(base32.NoPadding).DecodeString(value[4:]); err != nil {
		return "", errors.New("invalid Nimiq address")
	}
	return value, nil
}

func normalize(value string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(value), " ", ""))
}

func ibanMod(value string) int {
	if len(value) != 36 {
		return -1
	}
	value = value[4:] + value[:4]
	mod := 0
	for _, char := range value {
		switch {
		case char >= '0' && char <= '9':
			mod = (mod*10 + int(char-'0')) % 97
		case char >= 'A' && char <= 'Z':
			n := int(char-'A') + 10
			mod = (mod*10 + n/10) % 97
			mod = (mod*10 + n%10) % 97
		default:
			return -1
		}
	}
	return mod
}
