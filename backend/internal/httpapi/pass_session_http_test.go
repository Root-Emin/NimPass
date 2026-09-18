package httpapi

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/config"
	"nimpass/backend/internal/database"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// The session surface over real HTTP.
//
// The repository tests prove the transactional rules; this proves the part
// only a server can: that two different authenticated accounts, arriving
// through the router with their own cookies, read and write the *same*
// records — and that a third gets nothing at all.

type httpActor struct {
	identity application.Identity
	token    string
	csrf     string
}

func httpLogin(t *testing.T, pool *pgxpool.Pool) httpActor {
	t.Helper()
	wallet, pub, key := httpKey(t)
	auth := application.Auth{Store: database.AuthRepository{Pool: pool}, Verifier: nimiq.Ed25519Verifier{}, Network: "TESTNET", Environment: "test", Now: time.Now}
	c, err := auth.NewChallenge(context.Background(), application.AuthLogin, wallet, "")
	if err != nil {
		t.Fatal(err)
	}
	identity, token, csrf, err := auth.Login(context.Background(), application.Proof{ChallengeID: c.ID, Wallet: wallet, PublicKey: pub, Signature: hex.EncodeToString(ed25519.Sign(key, []byte(c.Message())))})
	if err != nil {
		t.Fatal(err)
	}
	return httpActor{identity: identity.Identity, token: token, csrf: csrf}
}

// sessionWorldHTTP settles one purchase the ordinary way — intent, submitted
// hash, verified chain evidence — so the pass and its sessions exist because
// the real code created them, not because a fixture inserted them.
func sessionWorldHTTP(t *testing.T, pool *pgxpool.Pool) (buyer, provider, stranger httpActor, passID domain.ID) {
	t.Helper()
	ctx := context.Background()
	buyer = httpLogin(t, pool)
	provider = httpLogin(t, pool)
	stranger = httpLogin(t, pool)

	now := time.Now().UTC()
	providerID, serviceID, catalogPassID := mustID(t), mustID(t), mustID(t)
	// A checksum-valid address, because the verifier validates the recipient
	// it reads off the chain against the intent's snapshot.
	payout, _, _ := httpKey(t)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO providers(id,owner_identity_id,name,payout_wallet,payout_verified_at,created_at,updated_at) VALUES($1,$2,'Studio',$3,$4,$4,$4)`, providerID, provider.identity.ID, payout, now)
	exec(`INSERT INTO services(id,provider_id,name,status,created_at,updated_at) VALUES($1,$2,'Yoga','ACTIVE',$3,$3)`, serviceID, providerID, now)
	exec(`INSERT INTO passes(id,provider_id,service_id,title,session_count,price_luna,status,created_at,updated_at) VALUES($1,$2,$3,'Five sessions',5,12340000,'ACTIVE',$4,$4)`, catalogPassID, providerID, serviceID, now)

	repo := database.PaymentRepository{Pool: pool}
	chain := &fixedChain{}
	payments := application.Payments{Store: repo, Chain: chain, Network: domain.NimiqTestnet, Now: time.Now}
	intent, _, err := payments.Create(ctx, buyer.identity, catalogPassID, "")
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("d", 64)
	submitted, err := payments.Submit(ctx, buyer.identity, intent.Purchase.ID, hash)
	if err != nil {
		t.Fatal(err)
	}
	chain.evidence = chainEvidenceFor(submitted, hash)
	settled, err := payments.Reconcile(ctx, buyer.identity, intent.Purchase.ID)
	if err != nil {
		t.Fatal(err)
	}
	if settled.Purchase.Status != domain.PurchaseConfirmed || settled.PassID == "" {
		t.Fatalf("purchase did not settle: %s", settled.Purchase.Status)
	}
	return buyer, provider, stranger, settled.PassID
}

type fixedChain struct{ evidence nimiq.ChainEvidence }

func (c *fixedChain) Inspect(context.Context, string, string) (nimiq.ChainEvidence, error) {
	return c.evidence, nil
}

func chainEvidenceFor(p application.PurchaseRecord, hash string) nimiq.ChainEvidence {
	zero, net, yes := uint8(0), uint8(5), true
	value := uint64(p.Purchase.Snapshot.PriceLuna)
	block := uint32(100)
	tx := nimiq.ChainTransaction{Hash: hash, BlockNumber: &block, From: string(p.Purchase.ExpectedWallet), FromType: &zero, To: string(p.Purchase.Snapshot.Recipient), ToType: &zero, Value: &value, RecipientData: hex.EncodeToString([]byte(p.Purchase.PaymentReference)), Flags: &zero, Proof: "aa", NetworkID: &net, ExecutionResult: &yes}
	return nimiq.ChainEvidence{Transaction: tx, InclusionBlock: block, IncludedAt: p.Purchase.CreatedAt, Finalized: true, FinalityBlock: 120, FinalizedAt: p.Purchase.CreatedAt.Add(time.Second)}
}

func mustID(t *testing.T) domain.ID {
	t.Helper()
	id, err := domain.NewID()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestPassSessionsOverHTTPAreSharedBetweenBothParties(t *testing.T) {
	pool := httpTestPool(t)
	router := NewRouterWithConfig(pool, slog.New(slog.NewTextHandler(io.Discard, nil)), config.Config{Environment: "test", Network: "TESTNET", PublicOrigin: "http://localhost:5173"})
	buyer, provider, stranger, passID := sessionWorldHTTP(t, pool)

	call := func(actor httpActor, method, path, body string) (int, map[string]any) {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "http://localhost:5173")
		r.AddCookie(&http.Cookie{Name: "nimpass_session", Value: actor.token})
		r.Header.Set("X-CSRF-Token", actor.csrf)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		var decoded map[string]any
		if w.Body.Len() > 0 {
			_ = json.Unmarshal(w.Body.Bytes(), &decoded)
		}
		return w.Code, decoded
	}
	sessionsPath := "/api/v1/passes/" + string(passID) + "/sessions"

	// Both parties read the same rows, and are told which party they are.
	for _, actor := range []struct {
		who  httpActor
		role string
	}{{buyer, "OWNER"}, {provider, "PROVIDER"}} {
		status, body := call(actor.who, "GET", sessionsPath, "")
		if status != 200 {
			t.Fatalf("%s read sessions: %d %v", actor.role, status, body)
		}
		if body["role"] != actor.role {
			t.Fatalf("role for %s reported as %v", actor.role, body["role"])
		}
		if items, ok := body["items"].([]any); !ok || len(items) != 5 {
			t.Fatalf("%s saw %v sessions", actor.role, body["items"])
		}
		if body["remainingSessions"] != float64(5) || body["completedSessions"] != float64(0) {
			t.Fatalf("%s counters: %v", actor.role, body)
		}
	}

	// A third account learns nothing, including that the pass exists.
	if status, _ := call(stranger, "GET", sessionsPath, ""); status != 404 {
		t.Fatalf("stranger read another customer's sessions: %d", status)
	}
	if status, _ := call(stranger, "GET", "/api/v1/passes/"+string(passID), ""); status != 404 {
		t.Fatalf("stranger read another customer's pass: %d", status)
	}

	_, listed := call(buyer, "GET", sessionsPath, "")
	first := listed["items"].([]any)[0].(map[string]any)
	second := listed["items"].([]any)[1].(map[string]any)
	firstID := first["id"].(string)
	secondID := second["id"].(string)

	// The buyer books a date; the provider sees the same date.
	when := time.Now().UTC().Add(48 * time.Hour).Format(time.RFC3339)
	if status, body := call(buyer, "PATCH", "/api/v1/pass-sessions/"+firstID+"/schedule", `{"scheduledAt":"`+when+`"}`); status != 200 || body["status"] != "SCHEDULED" {
		t.Fatalf("buyer schedule: %d %v", status, body)
	}
	_, providerView := call(provider, "GET", sessionsPath, "")
	if providerView["items"].([]any)[0].(map[string]any)["status"] != "SCHEDULED" {
		t.Fatal("the provider does not see the date the buyer set")
	}

	// A stranger cannot touch either session.
	if status, _ := call(stranger, "PATCH", "/api/v1/pass-sessions/"+firstID+"/schedule", `{"scheduledAt":null}`); status != 404 {
		t.Fatalf("stranger rescheduled somebody's session: %d", status)
	}
	if status, _ := call(stranger, "POST", "/api/v1/pass-sessions/"+secondID+"/complete", ""); status != 404 {
		t.Fatalf("stranger completed somebody's session: %d", status)
	}

	// The owner may not complete by plain request: their route is the signed
	// redemption, which is the whole of ADR-007.
	if status, _ := call(buyer, "POST", "/api/v1/pass-sessions/"+secondID+"/complete", ""); status != 403 {
		t.Fatalf("owner completed a session without a signature: %d", status)
	}

	// The provider records the delivery, and the counter moves once.
	status, done := call(provider, "POST", "/api/v1/pass-sessions/"+secondID+"/complete", "")
	if status != 200 {
		t.Fatalf("provider complete: %d %v", status, done)
	}
	session := done["session"].(map[string]any)
	pass := done["pass"].(map[string]any)
	if session["status"] != "COMPLETED" || session["completedBy"] != "PROVIDER" {
		t.Fatalf("completed session: %v", session)
	}
	if pass["remainingSessions"] != float64(4) || pass["usedSessions"] != float64(1) {
		t.Fatalf("counters after one completion: %v", pass)
	}

	// The same session again changes nothing.
	if status, _ := call(provider, "POST", "/api/v1/pass-sessions/"+secondID+"/complete", ""); status != 409 {
		t.Fatalf("second completion of one session: %d", status)
	}

	// And the buyer, reading their own pass, sees the provider's write.
	status, buyerView := call(buyer, "GET", sessionsPath, "")
	if status != 200 || buyerView["remainingSessions"] != float64(4) || buyerView["completedSessions"] != float64(1) {
		t.Fatalf("buyer view after provider completion: %d %v", status, buyerView)
	}
	if buyerView["items"].([]any)[1].(map[string]any)["status"] != "COMPLETED" {
		t.Fatal("the buyer does not see the session the provider completed")
	}
	statusCode, passBody := call(buyer, "GET", "/api/v1/passes/"+string(passID), "")
	if statusCode != 200 || passBody["remainingSessions"] != float64(4) || passBody["viewerRole"] != "OWNER" {
		t.Fatalf("buyer pass read: %d %v", statusCode, passBody)
	}
}
