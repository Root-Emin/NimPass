package httpapi

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"nimpass/backend/internal/application"
)

// proofFixtureDir is where a development build leaves rejected proofs. The
// path is relative to the backend working directory and ignored by git.
const proofFixtureDir = ".nimpass-proof-fixtures"

// proofMismatchRecorder captures a rejected signature as a fixture that
// cmd/verify-sign-fixture can read.
//
// # Why this exists
//
// Nimiq Pay's sign() preprocessing is not documented (see the package comment
// in internal/nimiq), so a deployment configures one scheme and a wallet that
// preprocesses differently can only fail as "invalid signature" — the same
// symptom as a wrong wallet, a replayed challenge or a genuine forgery. The
// proof material exists for one instant inside validateProof and is then gone,
// which is why settling the scheme has needed a device capture. This writes
// that capture down instead.
//
// # Why it does not weaken verification
//
// It runs only after the verifier has already rejected the proof, and only
// outside production. It records public values — the server's own challenge
// message, the public key and the signature — and never a session token, a
// cookie or any private key. Verification still applies exactly one
// preprocessor per proof; nothing here is a fallback path that could admit a
// signature the configured scheme rejected.
//
// Read a capture with:
//
//	go run ./cmd/verify-sign-fixture -fixture .nimpass-proof-fixtures/<file> -scheme auto
func proofMismatchRecorder(logger *slog.Logger, now func() time.Time) func(string, application.Proof) {
	return func(message string, p application.Proof) {
		// Only the four fields cmd/verify-sign-fixture accepts: it decodes with
		// DisallowUnknownFields, so an extra key would make the capture useless.
		fixture := struct {
			Message   string `json:"message"`
			Wallet    string `json:"wallet"`
			PublicKey string `json:"publicKey"`
			Signature string `json:"signature"`
		}{Message: message, Wallet: p.Wallet, PublicKey: p.PublicKey, Signature: p.Signature}

		encoded, err := json.MarshalIndent(fixture, "", "  ")
		if err != nil {
			return
		}
		if err := os.MkdirAll(proofFixtureDir, 0o700); err != nil {
			logger.Warn("proof fixture directory unavailable", "error", err)
			return
		}
		name := filepath.Join(proofFixtureDir, "rejected-proof-"+now().UTC().Format("20060102-150405.000")+".json")
		if err := os.WriteFile(name, encoded, 0o600); err != nil {
			logger.Warn("proof fixture not written", "error", err)
			return
		}
		logger.Warn("rejected signature captured for scheme diagnosis",
			"fixture", name,
			"named_scheme", p.SigningScheme,
			"hint", "go run ./cmd/verify-sign-fixture -fixture "+name+" -scheme auto")
	}
}
