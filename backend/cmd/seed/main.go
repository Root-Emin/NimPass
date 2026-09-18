// Command seed fills a local development database with a browsable Nimpass
// account, and mints a session cookie for it.
//
// Why this exists: every customer-owned screen (My Passes, pass detail,
// history) is gated on a backend-issued session, and a session is only issued
// against a real Ed25519 signature from Nimiq Pay (docs/09-SECURITY.md
// §13-§20). In a desktop browser there is no wallet to produce one, so those
// screens cannot be opened at all — not even to look at them.
//
// What this does NOT do is fabricate anything inside the app. The frontend's
// fixture layer is catalogue-only and refuses to invent passes, purchases or
// redemptions on purpose (frontend/web/src/dev/README.md, rule 3), and that
// stays true: this writes ordinary rows into the real database, which the real
// endpoints then serve. Nothing here ships in any bundle — it is a separate
// binary that a build never imports.
//
// Usage:
//
//	DATABASE_URL=postgres://…/nimpass_dev go run ./cmd/seed
//	DATABASE_URL=… go run ./cmd/seed -wallet NQ… -clear
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/nimiq"
)

// Fixed ids, so re-running replaces the same rows instead of growing the
// database a fifth copy of Alex Mehr.
const idPrefix = "5eed0000-0000-4000-8000-"

// Runs of anything that cannot appear in a slug, for deriving one from a name.
var slugSeparators = regexp.MustCompile(`[^a-z0-9]+`)

// The provider row for the workspace the seeded wallet sells under.
const ownWorkspaceProviderID = 900

/*
The public identity a seeded wallet sells under.

`renamed` marks a name the operator asked for on this run (`-display-name`),
which is the one case where the seed may replace a name already in the
database. Without it the stored name always wins.
*/
type ownWorkspace struct {
	name    string
	slug    string
	renamed bool
}

/*
Set by -payout-wallet: one address every seeded provider is paid to.

Empty means each provider keeps its own derived development address. Both are
real addresses; the override is the one a person can actually watch, which is
what a Testnet payment run needs.
*/
var payoutOverride string

// The address seeded providers are paid to, honouring the override.
func seedPayoutWallet(tag string) string {
	if payoutOverride != "" {
		return payoutOverride
	}
	return devWallet(tag)
}

/*
A seeded wallet must be a REAL Nimiq address, not merely a string shaped like
one.

This used to be a `^NQ[A-Z0-9]{34}$` regex, and the difference cost a whole
evening of "payment doesn't work". `NQ11PROVIDER200000000000000000000000`
satisfies that regex and the database CHECK constraint, and is not an address:
its IBAN check digits are wrong, and `I` and `O` are not even in Nimiq's base32
alphabet. Nimiq Pay cannot build a transaction to it, so every seeded Pass was
unpayable on both checkouts — while the provider row claimed a *verified* payout
wallet, which is what let it reach the catalog at all.

`nimiq.ValidateAddress` is the same function the payment verifier uses, so
anything this file writes is an address the rest of the system agrees is one.
*/
func validWallet(value string) (string, error) {
	return nimiq.ValidateAddress(value)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "seed failed: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	wallet := flag.String("wallet", devWallet("07DEVCUSTOMER"), "customer wallet address the seeded passes belong to")
	payoutWallet := flag.String("payout-wallet", "", "Nimiq address every seeded provider is paid to; defaults to per-provider development addresses nobody can spend from")
	displayName := flag.String("display-name", "", "public name this wallet sells under; set once, never overwritten, and left to the app's own workspace setup when empty")
	clear := flag.Bool("clear", false, "remove previously seeded rows and exit")
	flag.Parse()

	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		return errors.New("DATABASE_URL is required")
	}
	if err := refuseNonLocal(dsn); err != nil {
		return err
	}
	customerWallet, err := validWallet(*wallet)
	if err != nil {
		return fmt.Errorf("wallet %q is not a valid Nimiq address: %w", *wallet, err)
	}
	*wallet = customerWallet

	// An address the operator controls, so a real Testnet payment can be
	// watched arriving instead of being burned on a key nobody holds.
	if strings.TrimSpace(*payoutWallet) != "" {
		verified, err := validWallet(*payoutWallet)
		if err != nil {
			return fmt.Errorf("payout wallet %q is not a valid Nimiq address: %w", *payoutWallet, err)
		}
		payoutOverride = verified
	}

	// A public creator name, so it is held to the same length the API enforces
	// (`ProviderInput.name`). Nothing else about it is guessed.
	*displayName = strings.TrimSpace(*displayName)
	if len(*displayName) > 160 {
		return errors.New("display name is longer than the 160 characters a provider name allows")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Read before clearing. The clear step removes seeded services and passes
	// and then the provider that is left holding nothing, so a workspace this
	// wallet has already made its own — renamed on Profile, linked to from
	// somewhere — would otherwise vanish on a reseed, or come back under a name
	// nobody chose. The flag wins when it is given; otherwise the workspace
	// keeps the identity it already had.
	own, err := currentWorkspace(ctx, tx)
	if err != nil {
		return fmt.Errorf("reading the current workspace: %w", err)
	}
	if *displayName != "" {
		own.name, own.renamed = *displayName, true
	}

	if err := removeSeed(ctx, tx); err != nil {
		return fmt.Errorf("clearing previous seed: %w", err)
	}
	if *clear {
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		fmt.Println("seeded rows removed")
		return nil
	}

	customerID, workspace, err := insertSeed(ctx, tx, *wallet, own)
	if err != nil {
		return fmt.Errorf("inserting seed: %w", err)
	}

	token, err := mintSession(ctx, tx, customerID)
	if err != nil {
		return fmt.Errorf("minting session: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	report(*wallet, token, workspace)
	return nil
}

/*
A data-writing tool pointed at the wrong database is the kind of mistake that
is only obvious afterwards, so the guard is a refusal rather than a warning:
this runs against a local host, and never with APP_ENV=production.
*/
func refuseNonLocal(dsn string) error {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "production") {
		return errors.New("refusing to seed with APP_ENV=production")
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		return fmt.Errorf("DATABASE_URL is not a URL: %w", err)
	}
	switch parsed.Hostname() {
	case "localhost", "127.0.0.1", "::1":
		return nil
	default:
		return fmt.Errorf("refusing to seed non-local database host %q", parsed.Hostname())
	}
}

func id(n int) string { return fmt.Sprintf("%s%012d", idPrefix, n) }

// devWallet builds an address-shaped string from a tag. Not a real key pair and
// not spendable — it is an identifier for local rows.
/*
A deterministic, checksum-valid development address for a tag.

The tag is hashed to 32 bytes and run through the product's own
`AddressFromPublicKey`, so the result is a genuine Nimiq address: correct check
digits, correct base32 body, and stable across re-seeds so re-running replaces
rows rather than multiplying them.

The readable "PROVIDER1" vanity is gone on purpose. An address that spells
something and cannot receive money is worth strictly less than an opaque one
that can.

Nobody holds the private key for these, so they can receive NIM and never spend
it. That is correct for seeded demo providers and wrong for a real Testnet
payment test — pass `-payout-wallet` with an address you control for that.
*/
func devWallet(tag string) string {
	seed := sha256.Sum256([]byte("nimpass-dev-wallet:" + strings.ToUpper(tag)))
	address, err := nimiq.AddressFromPublicKey(seed[:])
	if err != nil {
		// Unreachable: the input is always 32 bytes.
		panic("seed: could not derive a development address: " + err.Error())
	}
	return address
}

func randomHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

/*
A session, minted exactly the way application.Auth.Login mints one: a random
token, stored only as its SHA-256 digest, with the CSRF token derived from the
token by the product's own function. Nothing about the session is weaker than a
real one — the only step skipped is the wallet signature that would normally
precede it.
*/
func mintSession(ctx context.Context, tx pgx.Tx, identityID string) (string, error) {
	token, err := randomHex(32)
	if err != nil {
		return "", err
	}
	tokenDigest := sha256.Sum256([]byte(token))
	csrfDigest := sha256.Sum256([]byte(application.CSRFToken(token)))
	now := time.Now().UTC()

	_, err = tx.Exec(ctx,
		`INSERT INTO auth_sessions(id,identity_id,token_digest,csrf_digest,created_at,expires_at,last_used_at)
		 VALUES($1,$2,$3,$4,$5,$6,$5)`,
		id(90), identityID, tokenDigest[:], csrfDigest[:], now, now.Add(application.SessionTTL))
	return token, err
}

/*
Removes what this command created, in reverse dependency order.

Two classes of row, and the difference matters. The purchase/pass/redemption
chain is created here and referenced by nothing else, so it is deleted outright.
The catalogue underneath it — providers, services, passes — can by then be
referenced by a purchase *a person actually started in the app*, and that is a
real record: it is never deleted to make room for a reseed. Those deletes are
guarded, the rows survive, and the inserts below upsert over them instead.
*/
func removeSeed(ctx context.Context, tx pgx.Tx) error {
	statements := []string{
		// Ours outright.
		// Scoped by the *pass*, not by the row's own id.
		//
		// A redemption the operator actually performed in the browser has a
		// random id, so `id LIKE '5eed0000%'` never matched it — while its
		// foreign key still pinned the seeded pass in place, and -clear died on
		// `redemption_challenges_pass_id_fkey`. Anything hanging off a seeded
		// pass has to go when that pass goes, whoever created it.
		// Deepest dependant first: events reference redemptions, redemptions
		// reference challenges, and all three reference the purchased pass.
		`DELETE FROM redemption_events WHERE pass_id::text LIKE $1`,
		`DELETE FROM redemptions WHERE id::text LIKE $1 OR pass_id::text LIKE $1`,
		`DELETE FROM redemption_challenges WHERE id::text LIKE $1 OR pass_id::text LIKE $1`,
		`DELETE FROM purchased_passes WHERE id::text LIKE $1`,
		`DELETE FROM payment_candidates WHERE purchase_id::text LIKE $1`,
		`DELETE FROM verified_payments WHERE purchase_id::text LIKE $1`,
		`DELETE FROM purchase_events WHERE purchase_id::text LIKE $1`,
		`DELETE FROM purchases WHERE id::text LIKE $1`,
		`DELETE FROM auth_sessions WHERE id::text LIKE $1 OR identity_id::text LIKE $1`,
		`DELETE FROM auth_challenges WHERE provider_id::text LIKE $1`,
		`DELETE FROM provider_payout_audit WHERE provider_id::text LIKE $1`,

		// Kept whenever something real still points at them.
		`DELETE FROM passes WHERE id::text LIKE $1 AND id NOT IN (SELECT pass_id FROM purchases)`,
		`DELETE FROM services WHERE id::text LIKE $1 AND id NOT IN (SELECT service_id FROM passes)`,
		`DELETE FROM providers WHERE id::text LIKE $1
		   AND id NOT IN (SELECT provider_id FROM passes)
		   AND id NOT IN (SELECT provider_id FROM services)
		   AND id NOT IN (SELECT provider_id FROM purchases)`,
		`DELETE FROM identities WHERE id::text LIKE $1 AND id NOT IN (SELECT owner_identity_id FROM providers)`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement, idPrefix+"%"); err != nil {
			return fmt.Errorf("%s: %w", statement, err)
		}
	}
	return nil
}

// One seeded provider and the pass its customer bought from them.
type seedRow struct {
	n           int // index, drives every fixed id in the row
	provider    string
	slug        string
	headline    string
	location    string
	service     string
	category    string
	passTitle   string
	description string
	// Accent is the provider's chosen tone. Empty means they never picked one,
	// which is the common case and the one the pass cover derives from.
	accent     string
	sessions   int
	used       int
	priceLuna  int64
	status     string
	boughtDays int // how long ago the purchase happened
	// Set for EXPIRED rows; ignored otherwise.
	expiresDays int
}

func seedRows() []seedRow {
	return []seedRow{
		{n: 1, provider: "Alex Mehr", slug: "alex-mehr", headline: "Strength and conditioning coach", location: "Kadıköy, İstanbul",
			service: "Personal Training", category: "fitness", passTitle: "5 Personal Training Sessions",
			description: "Five private one-to-one strength sessions, booked around your week.",
			accent:      "", sessions: 5, used: 2, priceLuna: 12_000_000, status: "ACTIVE", boughtDays: 13},
		{n: 2, provider: "Lucía Ortega", slug: "lucia-ortega", headline: "Spanish tutor, DELE examiner", location: "Valencia",
			service: "Spanish Conversation", category: "languages", passTitle: "10 Spanish Conversation Sessions",
			description: "Ten conversation hours at your level, with notes after each one.",
			accent:      "SLATE", sessions: 10, used: 9, priceLuna: 25_000_000, status: "ACTIVE", boughtDays: 63},
		{n: 3, provider: "Kenji Aoto", slug: "kenji-aoto", headline: "Pianist and teacher", location: "Berlin",
			service: "Piano Lessons", category: "music", passTitle: "8 Piano Lessons",
			description: "Eight lessons for players who already read music.",
			accent:      "PLUM", sessions: 8, used: 8, priceLuna: 20_000_000, status: "COMPLETED", boughtDays: 190},
		{n: 4, provider: "Dana Roth", slug: "dana-roth", headline: "Career coach for engineers", location: "Remote",
			service: "Career Coaching", category: "coaching", passTitle: "6 Career Coaching Sessions",
			description: "Six sessions on positioning, interviewing and negotiation.",
			accent:      "", sessions: 6, used: 3, priceLuna: 18_000_000, status: "EXPIRED", boughtDays: 220, expiresDays: 15},
		{n: 5, provider: "Mira Sol", slug: "mira-sol", headline: "Yoga and mobility", location: "Lisbon",
			service: "Yoga", category: "wellness", passTitle: "12 Yoga Sessions",
			description: "Twelve studio sessions, mats provided.",
			accent:      "OLIVE", sessions: 12, used: 12, priceLuna: 30_000_000, status: "COMPLETED", boughtDays: 255},
	}
}

func insertSeed(ctx context.Context, tx pgx.Tx, wallet string, own ownWorkspace) (string, string, error) {
	now := time.Now().UTC()

	// The customer. Every seeded purchase is attributed to this identity, which
	// is what `GET /passes` filters on.
	//
	// The id is read back rather than assumed: if this wallet already has an
	// identity, the insert resolves to *that* row, and every purchase below has
	// to point at it or the foreign key fails.
	var customerID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO identities(id,wallet_address,created_at) VALUES($1,$2,$3)
		 ON CONFLICT(wallet_address) DO UPDATE SET wallet_address=EXCLUDED.wallet_address
		 RETURNING id`,
		id(1), wallet, now.AddDate(0, 0, -300)).Scan(&customerID); err != nil {
		return "", "", err
	}

	for _, row := range seedRows() {
		if err := insertRow(ctx, tx, row, customerID, wallet, now); err != nil {
			return "", "", fmt.Errorf("%s: %w", row.passTitle, err)
		}
	}

	workspace, err := insertWorkspace(ctx, tx, customerID, own, now)
	if err != nil {
		return "", "", fmt.Errorf("workspace: %w", err)
	}
	return customerID, workspace, nil
}

/*
A provider account owned by the *same* identity the session belongs to.

Without this the workspace is unreachable: /provider is gated on the signed-in
identity owning a provider, so a seeded customer lands on "You don't have a
provider account yet" and the pass creation screen can never be opened. The
services exist for the same reason — a pass belongs to a service, and the
creation form has nothing to offer if the account has none.

The name is not the seed's to invent. It is a *public creator name*: every pass
this wallet publishes carries it on Discover, to every visitor, signed in or
not. A placeholder written here ("Your Studio") therefore does not stay in
development — it becomes the name a real person is selling under, and it
survives logout because the relation behind it is genuinely persisted. So:
`-display-name` sets it on the first run, and without one no workspace is
created at all, leaving the product's own "Set up your workspace" step to ask
the person for their name.

A name already in the database is never overwritten either, because re-running
the seed must not rename someone who has since renamed themselves on Profile.
The headline, bio and location stay empty for the same reason — invented
biography about the operator is public copy nobody wrote.

The payout wallet is marked verified, because an unverified provider cannot
publish and half the workspace would be inert.

Returns the name the workspace ended up with, or "" when none was seeded.
*/
func insertWorkspace(ctx context.Context, tx pgx.Tx, customerID string, own ownWorkspace, now time.Time) (string, error) {
	const (
		providerID = ownWorkspaceProviderID
		training   = 901
		mobility   = 902
	)
	payout := seedPayoutWallet("11YOURSTUDIO")
	created := now.AddDate(0, 0, -90)

	// The row survives the clear when something real still points at it — a
	// pass this wallet published itself. Its stored name is then the one that
	// counts, ahead of anything read before the clear.
	var existing, slug string
	err := tx.QueryRow(ctx, `SELECT name,slug FROM providers WHERE id=$1`, id(providerID)).Scan(&existing, &slug)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	// Never a second selling identity: a wallet that already sells under a
	// provider it created in the app keeps that one, and the seeded workspace
	// is not added beside it — `GET /providers` returns the newest first, so
	// the app would switch to this one behind the person's back.
	if existing == "" {
		var others int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM providers WHERE owner_identity_id=$1 AND id<>$2`,
			customerID, id(providerID)).Scan(&others); err != nil {
			return "", err
		}
		if others > 0 {
			return "", nil
		}
	}

	name := existing
	if own.renamed || name == "" {
		name = own.name
	}
	if name == "" {
		return "", nil
	}
	if slug == "" {
		slug = own.slug
	}
	if slug == "" {
		slug, err = freeSlug(ctx, tx, name, id(providerID))
		if err != nil {
			return "", err
		}
	}

	// name=$3 is either the name already stored or one the operator asked for
	// by flag, so this can never introduce a public name nobody chose. The slug
	// is left out of the update entirely: it is immutable by trigger, and by
	// ADR-010 it is the stable public link.
	if _, err := tx.Exec(ctx,
		`INSERT INTO providers(id,owner_identity_id,name,slug,headline,bio,avatar_url,location,payout_wallet,payout_verified_at,created_at,updated_at)
		 VALUES($1,$2,$3,$4,'','','','',$5,$6,$6,$6)
		 ON CONFLICT(id) DO UPDATE SET name=$3,
		   payout_wallet=EXCLUDED.payout_wallet,payout_verified_at=EXCLUDED.payout_verified_at,
		   updated_at=EXCLUDED.updated_at`,
		id(providerID), customerID, name, slug, payout, created); err != nil {
		return "", err
	}

	services := []struct {
		n        int
		name     string
		category string
		about    string
	}{
		{training, "Personal Training", "fitness", "One-to-one strength work, planned around your week."},
		{mobility, "Mobility Coaching", "wellness", "Movement and mobility sessions, in studio or online."},
	}
	for _, service := range services {
		if _, err := tx.Exec(ctx,
			`INSERT INTO services(id,provider_id,name,description,category,status,created_at,updated_at)
			 VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$6)
			 ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
			   category=EXCLUDED.category,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
			id(service.n), id(providerID), service.name, service.about, service.category, created); err != nil {
			return "", err
		}
	}

	// One published pass and one draft, so the list has both states and the
	// edit route has something to open.
	catalog := []struct {
		n         int
		serviceN  int
		title     string
		about     string
		sessions  int
		priceLuna int64
		accent    any
		status    string
	}{
		{910, training, "10 Personal Training Sessions", "Ten private sessions, valid until you use them.", 10, 25_000_000, "PINE", "ACTIVE"},
		{911, mobility, "5 Mobility Sessions", "A shorter block for people starting out.", 5, 11_000_000, nil, "DRAFT"},
	}
	for _, item := range catalog {
		if _, err := tx.Exec(ctx,
			`INSERT INTO passes(id,provider_id,service_id,title,description,session_count,price_luna,currency,accent,status,created_at,updated_at)
			 VALUES($1,$2,$3,$4,$5,$6,$7,'NIM',$8,$9,$10,$10)
			 ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,
			   session_count=EXCLUDED.session_count,price_luna=EXCLUDED.price_luna,accent=EXCLUDED.accent,
			   status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
			id(item.n), id(providerID), id(item.serviceN), item.title, item.about,
			item.sessions, item.priceLuna, item.accent, item.status, created.AddDate(0, 0, 5)); err != nil {
			return "", err
		}
	}
	return name, nil
}

/*
What the seeded wallet already sells under, read before anything is cleared.

Empty when there is no such workspace yet, which is the first-run case.
*/
func currentWorkspace(ctx context.Context, tx pgx.Tx) (ownWorkspace, error) {
	var own ownWorkspace
	err := tx.QueryRow(ctx, `SELECT name,slug FROM providers WHERE id=$1`, id(ownWorkspaceProviderID)).Scan(&own.name, &own.slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return ownWorkspace{}, nil
	}
	return own, err
}

/*
A readable slug for a workspace being created for the first time.

The product generates one from the name and appends the id when it creates a
provider (`domain.GeneratedSlug`), which is collision-free but unreadable. A
seeded workspace can usually have the readable form — so take it when the name
reduces to a valid slug that nobody holds, and fall back to the product's own
generator when it does not.
*/
func freeSlug(ctx context.Context, tx pgx.Tx, name, providerID string) (string, error) {
	readable, err := domain.NormalizeSlug(slugSeparators.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "-"))
	if err != nil {
		return domain.GeneratedSlug(name, domain.ID(providerID)), nil
	}
	var taken bool
	if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM providers WHERE slug=$1)`, readable).Scan(&taken); err != nil {
		return "", err
	}
	if taken {
		return domain.GeneratedSlug(name, domain.ID(providerID)), nil
	}
	return readable, nil
}

func insertRow(ctx context.Context, tx pgx.Tx, row seedRow, customerID, wallet string, now time.Time) error {
	var (
		ownerIdentity = id(10 + row.n)
		providerID    = id(20 + row.n)
		serviceID     = id(30 + row.n)
		catalogPassID = id(40 + row.n)
		purchaseID    = id(50 + row.n)
		ownedPassID   = id(60 + row.n)
	)
	providerWallet := devWallet(fmt.Sprintf("11PROVIDER%d", row.n))
	providerPayout := seedPayoutWallet(fmt.Sprintf("11PROVIDER%d", row.n))
	created := now.AddDate(0, 0, -row.boughtDays)

	// The provider's own identity, separate from the customer's.
	if _, err := tx.Exec(ctx,
		`INSERT INTO identities(id,wallet_address,created_at) VALUES($1,$2,$3)
		 ON CONFLICT(id) DO UPDATE SET wallet_address=EXCLUDED.wallet_address`,
		ownerIdentity, providerWallet, created.AddDate(0, 0, -30)); err != nil {
		return err
	}

	// Payout wallet and its verification timestamp are set together — the
	// schema requires the pair, and an unverified provider cannot publish.
	if _, err := tx.Exec(ctx,
		`INSERT INTO providers(id,owner_identity_id,name,slug,headline,bio,avatar_url,location,payout_wallet,payout_verified_at,created_at,updated_at)
		 VALUES($1,$2,$3,$4,$5,$6,'',$7,$8,$9,$9,$9)
		 ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,slug=EXCLUDED.slug,headline=EXCLUDED.headline,
		   bio=EXCLUDED.bio,location=EXCLUDED.location,payout_wallet=EXCLUDED.payout_wallet,
		   payout_verified_at=EXCLUDED.payout_verified_at,updated_at=EXCLUDED.updated_at`,
		providerID, ownerIdentity, row.provider, row.slug, row.headline,
		row.headline+".", row.location, providerPayout, created.AddDate(0, 0, -20)); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO services(id,provider_id,name,description,category,status,created_at,updated_at)
		 VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$6)
		 ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
		   category=EXCLUDED.category,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
		serviceID, providerID, row.service, row.description, row.category, created.AddDate(0, 0, -20)); err != nil {
		return err
	}

	var accent any
	if row.accent != "" {
		accent = row.accent
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO passes(id,provider_id,service_id,title,description,session_count,price_luna,currency,accent,status,created_at,updated_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,'NIM',$8,'ACTIVE',$9,$9)
		 ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,
		   session_count=EXCLUDED.session_count,price_luna=EXCLUDED.price_luna,accent=EXCLUDED.accent,
		   status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
		catalogPassID, providerID, serviceID, row.passTitle, row.description,
		row.sessions, row.priceLuna, accent, created.AddDate(0, 0, -10)); err != nil {
		return err
	}

	reference, err := randomHex(16)
	if err != nil {
		return err
	}
	txHash, err := randomHex(32)
	if err != nil {
		return err
	}
	// CONFIRMED, which the schema only accepts with a transaction hash, a
	// verified sender and a confirmation time. The pass's foreign key then ties
	// its owner to that verified sender.
	if _, err := tx.Exec(ctx,
		`INSERT INTO purchases(id,customer_context_id,expected_wallet,pass_id,provider_id,service_id,
		   pass_title_snapshot,service_name_snapshot,provider_name_snapshot,purchased_sessions,
		   expected_price_luna,currency,recipient_wallet,network,payment_reference,status,
		   transaction_hash,verified_sender_wallet,created_at,expires_at,submitted_at,confirmed_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'NIM',$12,'TESTNET',$13,'CONFIRMED',$14,$3,$15,$16,$15,$17)`,
		purchaseID, customerID, wallet, catalogPassID, providerID, serviceID,
		row.passTitle, row.service, row.provider, row.sessions,
		row.priceLuna, providerPayout, "NP1:"+reference,
		txHash, created, created.Add(30*time.Minute), created.Add(4*time.Minute)); err != nil {
		return err
	}

	remaining := row.sessions - row.used
	var expiresAt, completedAt any
	if row.status == "EXPIRED" {
		expiresAt = now.AddDate(0, 0, -row.expiresDays)
	}
	if row.status == "COMPLETED" {
		completedAt = now.AddDate(0, 0, -7)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO purchased_passes(id,purchase_id,pass_id,provider_id,service_id,owner_wallet,
		   owner_identity_id,provider_identity_id,
		   pass_title_snapshot,service_name_snapshot,provider_name_snapshot,price_luna_snapshot,currency,
		   original_sessions,used_sessions,remaining_sessions,status,created_at,expires_at,completed_at)
		 VALUES($1,$2,$3,$4,$5,$6,$18,$19,$7,$8,$9,$10,'NIM',$11,$12,$13,$14,$15,$16,$17)`,
		ownedPassID, purchaseID, catalogPassID, providerID, serviceID, wallet,
		row.passTitle, row.service, row.provider, row.priceLuna,
		row.sessions, row.used, remaining, row.status,
		created.Add(5*time.Minute), expiresAt, completedAt, customerID, ownerIdentity); err != nil {
		return err
	}

	if err := insertPassSessions(ctx, tx, row, ownedPassID, created.Add(5*time.Minute), now); err != nil {
		return err
	}

	return insertRedemptions(ctx, tx, row, ownedPassID, providerID, wallet, now)
}

/*
One session record per session the pass was sold with.

The seeded pass has to look like a real one, and a real pass carries its whole
session list from the moment it is created: the used ones COMPLETED, the rest
open, and a couple of the open ones given dates so the timeline on the pass
screen shows what a scheduled session looks like rather than only what an
empty one does.

Completion times are left to `insertRedemptions`, which owns the history and
knows when each session was consumed; this inserts the rows and marks the used
ones, then that function links them.
*/
func insertPassSessions(ctx context.Context, tx pgx.Tx, row seedRow, passID string, createdAt, now time.Time) error {
	for ordinal := 1; ordinal <= row.sessions; ordinal++ {
		sessionID, err := domain.NewID()
		if err != nil {
			return err
		}
		status, completedAt, completedBy, scheduledAt := "UNSCHEDULED", any(nil), any(nil), any(nil)
		switch {
		case ordinal <= row.used:
			// Matched to its redemption below; the time here is a placeholder
			// the redemption pass overwrites.
			status, completedAt, completedBy = "COMPLETED", createdAt, "OWNER"
		case ordinal == row.used+1:
			status, scheduledAt = "SCHEDULED", now.AddDate(0, 0, 3).Truncate(time.Hour)
		case ordinal == row.used+2:
			status, scheduledAt = "SCHEDULED", now.AddDate(0, 0, 10).Truncate(time.Hour)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO pass_sessions(id,purchased_pass_id,sequence_number,status,scheduled_at,completed_at,completed_by,created_at,updated_at)
			 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
			sessionID, passID, ordinal, status, scheduledAt, completedAt, completedBy, createdAt); err != nil {
			return err
		}
	}
	return nil
}

/*
One consumed session per used session, each with the challenge it was
authorised through — the schema ties the two together, and the activity feed
reads the redemption rows rather than the pass counter.

Sessions are spread backwards from a recent date so the newest rows are the
ones the "Recent activity" teaser shows.
*/
func insertRedemptions(ctx context.Context, tx pgx.Tx, row seedRow, passID, providerID, wallet string, now time.Time) error {
	for ordinal := 1; ordinal <= row.used; ordinal++ {
		// Newest session first, then stepping back a week at a time. The hour is
		// varied per row so a seeded history does not read as a script run: every
		// session landing at the same minute is the first thing that gives it away.
		age := (row.used - ordinal) * 7
		day := now.AddDate(0, 0, -(row.n + age))
		at := time.Date(day.Year(), day.Month(), day.Day(),
			9+(row.n*3+ordinal)%10, (ordinal*13)%60, 0, 0, time.UTC)
		challengeID := id(700_000 + row.n*1_000 + ordinal)
		redemptionID := id(800_000 + row.n*1_000 + ordinal)

		if _, err := tx.Exec(ctx,
			`INSERT INTO redemption_challenges(id,pass_id,provider_id,owner_wallet,nonce,status,purpose,network,environment,
			   expected_used_sessions,expected_remaining_sessions,created_at,expires_at,authorized_at,consumed_at)
			 VALUES($1,$2,$3,$4,gen_random_uuid(),'CONSUMED','AUTHORIZE_REDEMPTION','TESTNET','development',$5,$6,$7,$8,$9,$9)`,
			challengeID, passID, providerID, wallet,
			ordinal-1, row.sessions-(ordinal-1),
			at.Add(-2*time.Minute), at.Add(3*time.Minute), at); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx,
			`INSERT INTO redemptions(id,challenge_id,pass_id,provider_id,owner_wallet,session_ordinal,sessions_consumed,consumed_at)
			 VALUES($1,$2,$3,$4,$5,$6,1,$7)`,
			redemptionID, challengeID, passID, providerID, wallet, ordinal, at); err != nil {
			return err
		}

		// Tie the session record to the redemption that spent it, and give it
		// the real time. The two are one fact seen twice, so seeded data that
		// let them disagree would be seeded data that cannot happen.
		if _, err := tx.Exec(ctx,
			`UPDATE pass_sessions SET completed_at=$3,redemption_id=$4,updated_at=$3
			  WHERE purchased_pass_id=$1 AND sequence_number=$2`,
			passID, ordinal, at, redemptionID); err != nil {
			return err
		}
	}
	return nil
}

func report(wallet, token, workspace string) {
	fmt.Println()
	fmt.Println("Seeded 5 providers, services, catalog passes, purchases and purchased passes.")
	fmt.Println("  customer wallet :", wallet)
	fmt.Println("  purchased passes: 2 active, 2 completed, 1 expired")
	if workspace == "" {
		fmt.Println("  own workspace   : none — open Create Pass in the app and name it there,")
		fmt.Println("                    or re-run with -display-name \"Your Name\"")
	} else {
		fmt.Printf("  own workspace   : %s — 2 services, 1 published pass, 1 draft\n", workspace)
	}
	fmt.Println()
	fmt.Println("To browse as that customer, open the frontend, then paste this into the")
	fmt.Println("browser console once (same host as the app, any port):")
	fmt.Println()
	fmt.Printf("  document.cookie = 'nimpass_session=%s; path=/; max-age=%d'\n", token, int(application.SessionTTL.Seconds()))
	fmt.Println()
	fmt.Println("Then reload. The cookie is host-scoped, so the app on :5173 and the API on")
	fmt.Println(":8080 both receive it. It expires in 24h; re-run this command for a new one.")
	fmt.Println()
	fmt.Println("Undo everything with: go run ./cmd/seed -clear")
}
