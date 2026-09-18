package nimiq

import (
	"errors"
	"net/url"
	"strings"
)

// The Nimiq payment request link — the one place the QR payload's format lives.
//
// # Why the server builds it
//
// The QR a customer scans must not be assembled from anything a browser can
// edit. Recipient and amount come from the Purchase Intent's immutable snapshot
// and are encoded here, server-side, so the string the phone reads is a
// projection of the same row the verifier later compares the chain against
// (docs/05-NIMIQ-PAY-INTEGRATION.md §13, §14, §85).
//
// # The format, and where each part of it is documented
//
//		nimiq:<ADDRESS>?amount=<decimal NIM>&message=<reference>
//
//	  - The `nimiq:` URI type, the `amount` and `message` parameter names and the
//	    address with its spaces stripped are the official request-link encoding
//	    (https://nimiq.dev/nimiq-utils/request-link-encoding, and the encoder
//	    itself, nimiq-utils `src/request-link-encoding/RequestLinkEncoding.ts`).
//	  - `amount` is **decimal NIM**, not Luna. The encoder converts a Luna amount
//	    with `moveDecimalSeparator(-DECIMALS[Currency.NIM])` where the NIM
//	    decimals are 5, i.e. Luna ÷ 100,000. Encoding Luna here would ask the
//	    customer to pay 100,000× the price.
//	  - `message` is capped at 64 UTF-8 bytes by the same encoder, which cites
//	    `BasicAccount.verifyIncomingTransaction` in Nimiq core. An `NP1:` payment
//	    reference is 36 ASCII bytes and fits.
//
// # What is not documented, and what follows from that
//
// No official Nimiq source states which QR payloads the Nimiq Pay in-app
// payment scanner accepts, nor whether a scanned link's `message` reaches the
// resulting transaction's `recipientData`. That is measured on a device, not
// assumed (docs/NIMIQ-PAYMENT-QR-INVESTIGATION-2026-09-16.md, ADR-006 gate G1).
//
// Two consequences are built in rather than hoped for:
//
//  1. The format is confined to this file, so a corrected syntax is a one-file
//     change and never a hunt through UI code.
//  2. The reference is carried **and** the backend can settle a payment that
//     arrives without one, because a scanner that drops `message` would
//     otherwise take the customer's money and strand it. See
//     `application.matchDiscovered`: a transaction that carries a Nimpass
//     reference must carry *this* purchase's reference, while an empty data
//     field falls back to the strict sender/recipient/value/window tuple. A
//     transaction bearing another purchase's reference never settles this one.
const paymentURIScheme = "nimiq"

// MaxRequestLinkMessageBytes is the encoder's documented `message` limit.
const MaxRequestLinkMessageBytes = 64

// PaymentRequestURI renders one payment instruction as a Nimiq request link.
//
// `address` must be a checksum-valid Nimiq address and `amountNIM` an exact
// decimal NIM string produced by domain.Luna.NIM() — this function formats, it
// never computes, so no rounding can enter a payment amount here.
func PaymentRequestURI(address, amountNIM, message string) (string, error) {
	normalized, err := ValidateAddress(address)
	if err != nil {
		return "", err
	}
	if !validDecimalNIM(amountNIM) {
		return "", errors.New("payment amount must be exact decimal NIM text")
	}
	params := url.Values{}
	params.Set("amount", amountNIM)
	if message != "" {
		if len(message) > MaxRequestLinkMessageBytes {
			return "", errors.New("payment reference exceeds the request-link message limit")
		}
		params.Set("message", message)
	}
	// Spaces are already stripped by ValidateAddress's normalization, matching
	// the official encoder's `normalizeAddress(recipient).replace(/ /g, '')`.
	return paymentURIScheme + ":" + normalized + "?" + params.Encode(), nil
}

// validDecimalNIM accepts only the shape Luna.NIM() emits: digits, at most one
// separator, at most five fractional digits and no trailing fractional zero.
func validDecimalNIM(value string) bool {
	if value == "" || value == "0" {
		return false
	}
	whole, fraction, hasFraction := strings.Cut(value, ".")
	if whole == "" || !onlyDigits(whole) {
		return false
	}
	if !hasFraction {
		return true
	}
	return fraction != "" && len(fraction) <= 5 && onlyDigits(fraction) && !strings.HasSuffix(fraction, "0")
}

func onlyDigits(value string) bool {
	for _, c := range value {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
