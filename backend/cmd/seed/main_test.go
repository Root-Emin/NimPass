package main

import (
	"fmt"
	"testing"

	"nimpass/backend/internal/nimiq"
)

/*
Every wallet this command writes must be an address the rest of Nimpass agrees
is one.

This test exists because of a real failure, not a hypothetical. `devWallet` used
to build "NQ" + tag + zero padding, which produced strings like
`NQ11PROVIDER200000000000000000000000`: 36 characters, matching the database's
`^NQ[A-Z0-9]{34}$` CHECK constraint and the seed's own shape regex, and not a
Nimiq address at all — wrong IBAN check digits, and `I` and `O` are not in
Nimiq's base32 alphabet.

Nothing caught it, because nothing compared the seeded value against the
validator the payment path uses. The consequence was that every seeded Pass
snapshotted an unpayable recipient into its Purchase Intent, so
`sendBasicTransactionWithData()` could not build a transaction and both the
mobile and desktop checkouts failed at the wallet — while the provider row
claimed a verified payout wallet, which is what let the Pass be published in the
first place.
*/

func TestSeededWalletsAreRealNimiqAddresses(t *testing.T) {
	tags := []string{"07DEVCUSTOMER", "11YOURSTUDIO"}
	for n := 1; n <= 5; n++ {
		tags = append(tags, fmt.Sprintf("11PROVIDER%d", n))
	}

	seen := map[string]string{}
	for _, tag := range tags {
		address := devWallet(tag)
		// The payment verifier's own check: length, prefix, IBAN check digits
		// and a base32 body in Nimiq's alphabet.
		if _, err := nimiq.ValidateAddress(address); err != nil {
			t.Fatalf("devWallet(%q) = %q, which is not a valid Nimiq address: %v", tag, address, err)
		}
		if previous, clash := seen[address]; clash {
			t.Fatalf("devWallet(%q) collides with devWallet(%q): both %q", tag, previous, address)
		}
		seen[address] = tag
	}
}

func TestDevWalletIsStableAcrossRuns(t *testing.T) {
	// Re-seeding has to replace the same rows rather than add a second Alex
	// Mehr under a new address, so the derivation must not involve randomness.
	for range 3 {
		if got, want := devWallet("11PROVIDER1"), devWallet("11PROVIDER1"); got != want {
			t.Fatalf("devWallet is not deterministic: %q vs %q", got, want)
		}
	}
}

func TestValidWalletRejectsThingsShapedLikeAddresses(t *testing.T) {
	// The exact string that shipped, plus the family it came from. Each one
	// passes `^NQ[A-Z0-9]{34}$` and must still be refused here.
	for _, value := range []string{
		"NQ11PROVIDER200000000000000000000000",
		"NQ11PROVIDER100000000000000000000000",
		"NQ11YOURSTUDIO0000000000000000000000",
		"NQ07DEVCUSTOMER00000000000000000000",
	} {
		if _, err := validWallet(value); err == nil {
			t.Fatalf("validWallet(%q) accepted a string that is not an address", value)
		}
	}
}

func TestValidWalletAcceptsARealAddress(t *testing.T) {
	address := devWallet("11PROVIDER1")
	got, err := validWallet(address)
	if err != nil || got != address {
		t.Fatalf("validWallet(%q) = %q, %v; want the address back unchanged", address, got, err)
	}
}

func TestPayoutOverrideReplacesEveryProviderAddress(t *testing.T) {
	// `-payout-wallet` is what points a Testnet run at an address a person can
	// actually watch, so it has to reach every provider, not just the first.
	t.Cleanup(func() { payoutOverride = "" })

	payoutOverride = ""
	derived := seedPayoutWallet("11PROVIDER1")
	if derived != devWallet("11PROVIDER1") {
		t.Fatalf("without an override each provider keeps its own address, got %q", derived)
	}

	payoutOverride = devWallet("OPERATOR")
	for n := 1; n <= 5; n++ {
		if got := seedPayoutWallet(fmt.Sprintf("11PROVIDER%d", n)); got != payoutOverride {
			t.Fatalf("provider %d was paid to %q, want the override %q", n, got, payoutOverride)
		}
	}
}
