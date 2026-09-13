// Package nimiq contains the Nimiq-specific public-key and signature adapter.
// It never handles private keys. The Mini App provider returns hex publicKey and
// signature values. The Mini App host's exact signing preprocessor is not yet
// proven by a live Nimiq Pay fixture. Production uses one explicit scheme,
// RawMessage, and must not silently try alternate schemes.
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
	Verify(message, wallet, publicKeyHex, signatureHex string) error
}

type MessagePreprocessor func(string) []byte

func RawMessage(message string) []byte { return []byte(message) }

// HubSignedMessage is a separate, opt-in fixture scheme based on the Hub's
// documented signed-message envelope. It is NOT an automatic fallback for the
// Mini App sign() API; host interoperability remains to be established.
func HubSignedMessage(message string) []byte {
	payload := "\x16Nimiq Signed Message:\n" + strconv.Itoa(len([]byte(message))) + message
	hash := sha256.Sum256([]byte(payload))
	return hash[:]
}

type Ed25519Verifier struct{ Preprocess MessagePreprocessor }

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
