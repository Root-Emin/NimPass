// verify-sign-fixture checks a captured Mini App sign() response offline.
// Capture the exact challenge message returned by the backend and the exact
// publicKey/signature hex from Nimiq Pay. Never pass private keys to this tool.
package main

import (
	"flag"
	"fmt"
	"os"

	"nimpass/backend/internal/nimiq"
)

func main() {
	message := flag.String("message", "", "exact challenge message")
	wallet := flag.String("wallet", "", "Nimiq wallet address")
	pub := flag.String("public-key", "", "hex public key")
	sig := flag.String("signature", "", "hex signature")
	scheme := flag.String("scheme", "raw", "one scheme: raw or hub-envelope")
	flag.Parse()
	if *message == "" || *wallet == "" || *pub == "" || *sig == "" {
		fmt.Fprintln(os.Stderr, "message, wallet, public-key, signature are required")
		os.Exit(2)
	}
	v := nimiq.Ed25519Verifier{Preprocess: nimiq.RawMessage}
	if *scheme == "hub-envelope" {
		v.Preprocess = nimiq.HubSignedMessage
	} else if *scheme != "raw" {
		fmt.Fprintln(os.Stderr, "unsupported scheme")
		os.Exit(2)
	}
	if err := v.Verify(*message, *wallet, *pub, *sig); err != nil {
		fmt.Fprintln(os.Stderr, "fixture verification failed:", err)
		os.Exit(1)
	}
	fmt.Println("fixture verified with", *scheme)
}
