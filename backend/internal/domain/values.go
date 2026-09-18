package domain

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

type ID string

func NewID() (ID, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate ID: %w", err)
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(raw[:])
	return ID(encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:]), nil
}

func ParseID(value string) (ID, error) {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return "", errors.New("invalid ID")
	}
	for i, c := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			continue
		}
		if !strings.ContainsRune("0123456789abcdef", c) {
			return "", errors.New("invalid ID")
		}
	}
	return ID(value), nil
}

type WalletAddress string

// NewWalletAddress normalizes the public address shape. It does not prove wallet
// control or validate the Nimiq checksum; signature and chain checks are separate.
func NewWalletAddress(value string) (WalletAddress, error) {
	value = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(value), " ", ""))
	if len(value) != 36 || !strings.HasPrefix(value, "NQ") {
		return "", errors.New("invalid Nimiq wallet address shape")
	}
	for _, c := range value[2:] {
		if !strings.ContainsRune("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", c) {
			return "", errors.New("invalid Nimiq wallet address shape")
		}
	}
	return WalletAddress(value), nil
}

type Luna int64

const LunaPerNIM Luna = 100_000
const MaxSafeLuna Luna = 9_007_199_254_740_991 // Nimiq Pay SDK value is a JavaScript number.

func NewLuna(value int64) (Luna, error) {
	if value <= 0 || value > int64(MaxSafeLuna) {
		return 0, errors.New("Luna amount must be positive and exactly representable by Nimiq Pay")
	}
	return Luna(value), nil
}

// ParseNIM converts decimal NIM text to integer Luna without floating point.
func ParseNIM(value string) (Luna, error) {
	parts := strings.Split(strings.TrimSpace(value), ".")
	if len(parts) < 1 || len(parts) > 2 || parts[0] == "" {
		return 0, errors.New("invalid NIM amount")
	}
	for _, part := range parts {
		for _, c := range part {
			if !strings.ContainsRune("0123456789", c) {
				return 0, errors.New("invalid NIM amount")
			}
		}
	}
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || whole < 0 {
		return 0, errors.New("invalid NIM amount")
	}
	var fraction int64
	if len(parts) == 2 {
		if len(parts[1]) == 0 || len(parts[1]) > 5 {
			return 0, errors.New("NIM amount has fractional Luna")
		}
		fraction, err = strconv.ParseInt(parts[1]+strings.Repeat("0", 5-len(parts[1])), 10, 64)
		if err != nil {
			return 0, errors.New("invalid NIM amount")
		}
	}
	if whole > (math.MaxInt64-fraction)/int64(LunaPerNIM) {
		return 0, errors.New("NIM amount overflows Luna")
	}
	return NewLuna(whole*int64(LunaPerNIM) + fraction)
}

type SessionCount int32

// MaxSessionsPerPass is the largest number of sessions one Pass may be sold
// with, and it is a safety bound before it is a product one.
//
// Every session a Pass is sold with becomes a row at purchase time — that is
// ADR-012's decision and the reason a session has an identity at all. The
// count therefore stops being a number on a form the moment somebody buys:
// `NewPassSessions` allocates one struct per session and the repository
// writes one row per session, inside the transaction that issues the Pass.
//
// Unbounded, that is a way to kill the server with a purchase. A Pass created
// with two billion sessions costs a provider nothing and one Luna to buy, and
// the allocation alone is hundreds of gigabytes — a fatal out-of-memory in the
// settlement worker, which no recover() can catch. Smaller-but-large values do
// not crash it; they exceed `ReconcileDue`'s eight-second budget, so the
// purchase never confirms and the customer has paid for a Pass that cannot
// issue while the retry burns a worker slot on every sweep.
//
// 500 is the number the Pass form has always shown providers
// ("That looks too high. Enter 500 or fewer."). Until now it was enforced
// only there, which made it a suggestion to anybody posting the request
// directly.
const MaxSessionsPerPass SessionCount = 500

func NewSessionCount(value int32) (SessionCount, error) {
	if value <= 0 {
		return 0, errors.New("session count must be positive")
	}
	if SessionCount(value) > MaxSessionsPerPass {
		return 0, fmt.Errorf("session count must be at most %d", MaxSessionsPerPass)
	}
	return SessionCount(value), nil
}

type PaymentReference string

func ParsePaymentReference(value string) (PaymentReference, error) {
	prefix := "NP1:"
	if strings.HasPrefix(value, "NP:") && len(value) == 35 {
		prefix = "NP:"
	}
	if len(value) != len(prefix)+32 || !strings.HasPrefix(value, prefix) {
		return "", errors.New("invalid payment reference")
	}
	for _, c := range value[len(prefix):] {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return "", errors.New("invalid payment reference")
		}
	}
	return PaymentReference(value), nil
}

func NewPaymentReference() (PaymentReference, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate payment reference: %w", err)
	}
	return PaymentReference("NP1:" + hex.EncodeToString(raw[:])), nil
}

// NIM renders Luna as exact decimal NIM text, with no trailing fractional
// zeros and no floating point anywhere. It is the inverse of ParseNIM and the
// only place a Luna amount becomes a decimal string for a payment instruction:
// the Nimiq request-link encoder carries `amount` in decimal NIM, not Luna
// (nimiq-utils RequestLinkEncoding.ts moves the separator by DECIMALS[NIM]=5).
func (l Luna) NIM() string {
	if l < 0 {
		return "0"
	}
	whole := int64(l) / int64(LunaPerNIM)
	fraction := int64(l) % int64(LunaPerNIM)
	if fraction == 0 {
		return strconv.FormatInt(whole, 10)
	}
	digits := strings.TrimRight(fmt.Sprintf("%05d", fraction), "0")
	return strconv.FormatInt(whole, 10) + "." + digits
}
