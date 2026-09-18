// verify-sign-fixture checks a captured Mini App sign() response offline.
package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"nimpass/backend/internal/nimiq"
	"os"
)

type fixture struct {
	Message   string `json:"message"`
	Wallet    string `json:"wallet"`
	PublicKey string `json:"publicKey"`
	Signature string `json:"signature"`
	Verified  *bool  `json:"verified,omitempty"`
}

func main() { os.Exit(run(os.Args[1:], os.Stdin, os.Stdout)) }

func run(args []string, stdin io.Reader, out io.Writer) int {
	f := fixture{}
	flags := flag.NewFlagSet("verify-sign-fixture", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&f.Message, "message", "", "exact challenge message")
	flags.StringVar(&f.Wallet, "wallet", "", "expected Nimiq wallet")
	flags.StringVar(&f.PublicKey, "public-key", "", "hex public key")
	flags.StringVar(&f.Signature, "signature", "", "hex signature")
	scheme := flags.String("scheme", "auto", "auto, raw, hub or hub-envelope")
	path := flags.String("fixture", "", "JSON file, or - for stdin; preferable to command-line signatures")
	if flags.Parse(args) != nil || flags.NArg() != 0 {
		_, _ = fmt.Fprintln(out, "invalid arguments; use -fixture FILE -scheme auto")
		return 2
	}
	if *path != "" {
		if f.Message != "" || f.Wallet != "" || f.PublicKey != "" || f.Signature != "" {
			_, _ = fmt.Fprintln(out, "fixture cannot be combined with individual fields")
			return 2
		}
		source := stdin
		if *path != "-" {
			file, err := os.Open(*path)
			if err != nil {
				_, _ = fmt.Fprintln(out, "cannot open fixture")
				return 2
			}
			defer func() { _ = file.Close() }()
			source = file
		}
		data, err := io.ReadAll(io.LimitReader(source, 32769))
		if err != nil || len(data) > 32768 {
			_, _ = fmt.Fprintln(out, "fixture exceeds 32 KiB or cannot be read")
			return 2
		}
		dec := json.NewDecoder(bytes.NewReader(data))
		dec.DisallowUnknownFields()
		if dec.Decode(&f) != nil || dec.Decode(new(any)) != io.EOF {
			_, _ = fmt.Fprintln(out, "invalid fixture JSON")
			return 2
		}
	}
	if f.Message == "" || f.Wallet == "" || f.PublicKey == "" || f.Signature == "" {
		_, _ = fmt.Fprintln(out, "message, wallet, publicKey and signature are required")
		return 2
	}
	if *scheme != "auto" && *scheme != "raw" && *scheme != "hub" && *scheme != "hub-envelope" {
		_, _ = fmt.Fprintln(out, "unsupported scheme")
		return 2
	}
	pub, err := hex.DecodeString(f.PublicKey)
	derived, deriveErr := nimiq.AddressFromPublicKey(pub)
	expected, walletErr := nimiq.ValidateAddress(f.Wallet)
	walletMatch := err == nil && deriveErr == nil && walletErr == nil && derived == expected
	_, _ = fmt.Fprintf(out, "derived wallet matches expected: %t\n", walletMatch)
	matched := ""
	for _, candidate := range []struct {
		name string
		pre  nimiq.MessagePreprocessor
	}{{"raw", nimiq.RawMessage}, {"hub", nimiq.HubSignedMessage}} {
		if *scheme != "auto" && *scheme != candidate.name && (*scheme != "hub-envelope" || candidate.name != "hub") {
			continue
		}
		// Test the envelope independently of expected-wallet matching, so one
		// command distinguishes an incorrect wallet from an incorrect scheme.
		valid := deriveErr == nil && (nimiq.Ed25519Verifier{Preprocess: candidate.pre}).Verify(f.Message, derived, f.PublicKey, f.Signature) == nil
		_, _ = fmt.Fprintf(out, "scheme %s verifies: %t\n", candidate.name, valid)
		if valid {
			matched = candidate.name
		}
	}
	verified := walletMatch && matched != ""
	if f.Verified != nil && *f.Verified != verified {
		_, _ = fmt.Fprintln(out, "expected verification result mismatch")
		return 1
	}
	if !verified {
		_, _ = fmt.Fprintln(out, "fixture did not verify; no deployment change recommended")
		return 1
	}
	_, _ = fmt.Fprintf(out, "fixture verified; matching NIMIQ_SIGNING_SCHEME=%s\n", matched)
	return 0
}
