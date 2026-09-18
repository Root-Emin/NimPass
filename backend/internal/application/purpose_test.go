package application

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
	"testing"
	"time"
)

func TestSigningPurposesNeverInterchange(t *testing.T) {
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	wallet, err := nimiq.AddressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	id := domain.ID("00000000-0000-4000-8000-000000000001")
	c := Challenge{ID: id, Nonce: string(id), Wallet: wallet, Network: "TESTNET", Environment: "test", IssuedAt: now, ExpiresAt: now.Add(time.Minute)}
	c.Purpose = AuthLogin
	login := c.Message()
	c.Purpose = VerifyProviderWallet
	c.ProviderID = id
	payout := c.Message()
	r := domain.RedemptionChallenge{ID: id, Nonce: id, PassID: id, ProviderID: id, OwnerWallet: domain.WalletAddress(wallet), Purpose: "AUTHORIZE_REDEMPTION", Network: domain.NimiqTestnet, Environment: "test", CreatedAt: now, ExpiresAt: now.Add(time.Minute)}
	messages := []string{login, payout, string(r.SigningMessage())}
	for _, pre := range []nimiq.MessagePreprocessor{nimiq.RawMessage, nimiq.HubSignedMessage} {
		verifier := nimiq.Ed25519Verifier{Preprocess: pre}
		for i, message := range messages {
			signature := hex.EncodeToString(ed25519.Sign(key, pre(message)))
			for j, other := range messages {
				err := verifier.Verify(other, wallet, hex.EncodeToString(pub), signature)
				if (err == nil) != (i == j) {
					t.Fatalf("purpose %d accepted as %d", i, j)
				}
			}
		}
	}
}
