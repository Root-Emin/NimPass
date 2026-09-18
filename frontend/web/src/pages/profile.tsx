import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  LogIn,
  LogOut,
  Store,
  Ticket,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { CreatedPassCard, CreatedPassCardSkeleton } from '@/components/catalog/created-pass-card'
import { PublicProfileCard } from '@/components/provider/public-profile-card'
import { Page, PageHeader, Subsection } from '@/components/layout/page'
import { PurchaseAttentionList } from '@/components/payment/purchase-attention-list'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { Identicon } from '@/components/wallet/identicon'
import { SignInDialog } from '@/components/wallet/sign-in-dialog'
import { useMyPasses } from '@/hooks/use-passes'
import { useMyCatalogPasses, useMyProviderProfile, useProviderAccount } from '@/hooks/use-provider-workspace'
import { needsAttention, useMyPurchases } from '@/hooks/use-purchases'
import { useSession } from '@/hooks/use-session'
import { useActiveWalletMismatch, useCanUseWallet, useWallet } from '@/hooks/use-wallet'
import { formatDate, shortenAddress } from '@/lib/format'
import { miniAppOpenerUrl, networkLabel } from '@/lib/nimiq'
import type { AuthSession } from '@/types/auth'
import type { PurchasedPass } from '@/types/domain'

/**
 * The customer's account page.
 *
 * Nimpass has no username, password or email — the wallet is the account
 * (docs/01-PRODUCT.md §53, docs/02-USER-FLOWS.md §7), so this page answers the
 * three questions that identity actually raises here:
 *
 *   who am I signed in as        → identity, verified by signature, not claimed
 *   what do I own                → passes and purchases, counted from real data
 *   what else can I do with this → sell on Nimpass, or sign out
 *
 * It is not a wallet screen: no balance, no transactions, no network switching.
 * "Nimpass ≠ Wallet Application" (docs/01-PRODUCT.md §16), and the design brief
 * is explicit that payment enables the experience without being the experience
 * (docs/03-DESIGN-SYSTEM.md, "Product Character").
 *
 * Every number here comes from a backend response. Nothing is estimated, and
 * nothing that has not been loaded is rendered as a zero
 * (docs/08-ARCHITECTURE.md §11).
 */
export function ProfilePage() {
  const { session, isRecovering } = useSession()

  return (
    <Page>
      <PageHeader
        eyebrow="Your account"
        title="Profile"
        description="Your Nimiq wallet is your Nimpass account. No username, no password."
      />

      <div className="mt-10">
        {isRecovering ? (
          <ProfileSkeleton />
        ) : session ? (
          <SignedInProfile session={session} />
        ) : (
          <LoginPrompt />
        )}
      </div>
    </Page>
  )
}

function SignedInProfile({ session }: { session: AuthSession }) {
  const wallet = useWallet()
  const mismatch = useActiveWalletMismatch()
  const navigate = useNavigate()
  const { signOut } = useSession()
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  return (
    // No `space-y` here: it would out-specify the section rhythm each
    // `Subsection` sets for itself.
    <div>
      <Card variant="plain" className="p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Identicon address={session.identity.wallet} size={64} />
          <div className="min-w-0 space-y-1">
            <p className="text-h3 text-ink">{shortenAddress(session.identity.wallet)}</p>
            <p className="text-body text-ink-muted">
              Logged in with your wallet · {networkLabel(wallet.network)} · joined{' '}
              {formatDate(session.identity.createdAt)}
            </p>
          </div>
        </div>

        <WalletAddress address={session.identity.wallet} />
      </Card>

      {mismatch ? (
        <Alert
          tone="warning"
          className="mt-6"
          icon={<AlertTriangle aria-hidden="true" />}
          title="You've switched wallets"
        >
          {/*
            The session stays bound to the wallet that signed for it, and the
            backend checks every consequential operation against that identity
            (docs/09-SECURITY.md §11, §19). Saying so turns two mystifying
            failures — a refused payment and a refused session code — into one
            obvious fix.
          */}
          <p>
            Nimpass is logged in with {shortenAddress(session.identity.wallet)}, but your wallet is
            now on {shortenAddress(mismatch)}. Log out and back in to use this one — otherwise
            payments and session codes will be refused.
          </p>
        </Alert>
      ) : null}

      <PublicProfileSection wallet={session.identity.wallet} />

      <PassSummary />
      <SellingSection />

      {/*
        Never "Session": a session is a unit of a pass in this product.

        Leaving the account is the one destructive thing on this page, so it is
        the one thing wearing the danger tone — a red action inside a quietly
        tinted card, at the end of the page where it cannot be hit by accident.
        The rest of Profile stays calm; the weight is on the control itself, not
        on the screen around it (docs/03-DESIGN-SYSTEM.md §19, §78).
      */}
      <Subsection title="Log out">
        <Card
          variant="plain"
          className="flex flex-col gap-4 border-danger/30 bg-danger-soft/40 p-6 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="max-w-lg text-body text-ink-muted">
            Logging out clears this device only. Your passes stay with your wallet, and logging
            back in brings them straight back.
          </p>
          <Button
            variant="danger"
            className="shrink-0 max-sm:w-full"
            loading={signingOut}
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true)
              setLogoutError(null)
              try {
                await signOut()
                // Logout is leaving, not a deep-link stay: the signed-out
                // Profile prompt is for someone who opened /profile on purpose
                // (docs/02-USER-FLOWS.md §6, §28). Replace so Back does not
                // return to an account page that no longer belongs to anyone.
                navigate('/', { replace: true })
              } catch {
                setLogoutError('Logout could not be confirmed. You are still signed in. Check your connection and try again.')
              } finally {
                setSigningOut(false)
              }
            }}
          >
            <LogOut aria-hidden="true" />
            Log out
          </Button>
        </Card>
        {logoutError ? (
          <p role="alert" className="mt-4 text-body text-danger">
            {logoutError}
          </p>
        ) : null}
      </Subsection>
    </div>
  )
}

/**
 * The full address, on request.
 *
 * The header deliberately never shows it, and secondary copy shortens it — but
 * this is the one screen where the person is asking who they are signed in as,
 * and a truncated address cannot be checked against a wallet app
 * (docs/03-DESIGN-SYSTEM.md §33, §92).
 */
function WalletAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      // Clipboard access can be blocked — notably on a LAN HTTP origin, which
      // is not a secure context (docs/04-NIMIQ-MINI-APPS.md §47).
      window.prompt('Copy your address', address)
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-xl bg-surface-inset p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-micro uppercase tracking-wide text-ink-subtle">Wallet address</p>
        <p className="numeric mt-1 break-all text-small text-ink">{address}</p>
      </div>
      <Button variant="secondary" size="sm" className="shrink-0" onClick={() => void copy()}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/**
 * What this identity owns, counted from the passes the backend returned.
 *
 * Purchases that produced no pass are shown as themselves rather than folded
 * into a count — a `COMPENSATION_REQUIRED` payment is the one case where
 * silence looks exactly like a lost payment (docs/05 §62, and the same list the
 * My Passes screen uses).
 */
function PassSummary() {
  const passes = useMyPasses()
  const purchases = useMyPurchases()
  const unresolved = purchases.data ? needsAttention(purchases.data) : []

  return (
    <Subsection
      title="Your passes"
      action={
        <Button asChild variant="ghost" size="sm">
          <Link to="/passes">
            Open My Passes
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      }
    >
      {passes.isPending ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : passes.isError ? (
        <ErrorState error={passes.error} onRetry={() => void passes.refetch()} />
      ) : (
        <>
          <PurchaseAttentionList purchases={unresolved} />
          <PassCounts passes={passes.data ?? []} />
        </>
      )}
    </Subsection>
  )
}

function PassCounts({ passes }: { passes: PurchasedPass[] }) {
  const active = passes.filter((pass) => pass.status === 'ACTIVE')
  // The counters are the backend's; they are summed for display, never derived
  // into a new authoritative value.
  const remaining = active.reduce((total, pass) => total + pass.remainingSessions, 0)

  if (passes.length === 0) {
    return (
      <Card variant="muted" className="flex flex-col items-start gap-3 p-6">
        <p className="text-body text-ink-muted">
          You don't own a pass yet. Buying a session pass puts one here.
        </p>
        <Button asChild size="sm">
          <Link to="/discover">
            <Ticket aria-hidden="true" />
            Find a Pass
          </Link>
        </Button>
      </Card>
    )
  }

  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-line">
      <Count label="Active passes" value={active.length} />
      <Count label="Sessions left" value={remaining} />
      <Count label="Finished" value={passes.length - active.length} />
    </dl>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface px-5 py-5">
      <dt className="text-small text-ink-muted">{label}</dt>
      <dd className="numeric mt-1 font-display text-h1 font-semibold text-ink">{value}</dd>
    </div>
  )
}

/**
 * Name, headline and face — the public half of this wallet, edited here rather
 * than buried under the store preview. On a phone that used to put a grid of
 * identicons between the person and the fields they came to change.
 *
 * Whether this wallet owns a provider record is an authorisation question the
 * backend answers (docs/09-SECURITY.md §33, §67-§68), so every answer it can
 * give is rendered as itself. The section used to return `null` for all three
 * of "no record", "the request failed" and "no session" — which is how a
 * failed load and a wallet that simply has no store both arrived on screen as
 * a missing feature, reported as "Public profile is not in the mobile view".
 * A section that disappears silently cannot be told apart from one that was
 * never built.
 */
function PublicProfileSection({ wallet }: { wallet: string }) {
  const account = useProviderAccount()
  const profile = useMyProviderProfile()

  // Signed out this component is not reachable — `SignedInProfile` renders it —
  // but the status exists, and there is nothing public to show for nobody.
  if (account.status === 'unauthenticated') return null

  if (account.status === 'loading' || (account.status === 'ready' && profile.isPending)) {
    return (
      <Subsection title="Public profile">
        <Skeleton className="h-64 rounded-xl" />
      </Subsection>
    )
  }

  if (account.status === 'error') {
    return (
      <Subsection title="Public profile">
        <ErrorState error={account.error} onRetry={() => void profile.refetch()} />
      </Subsection>
    )
  }

  if (account.status !== 'ready' || !profile.data) {
    return (
      <Subsection title="Public profile">
        {/*
          No provider record on this wallet — the ordinary state for a customer,
          and the one a seller lands in after signing in with a different wallet
          from the one that made their Passes. It carries no call to action of
          its own: "Selling on Nimpass" sits directly below with the single
          Create a Pass button, and two of them would be one too many.
        */}
        <Card variant="muted" className="p-6">
          <p className="text-body text-ink-muted">
            This wallet has no public profile yet. One is created with your first Pass — a name
            and a face customers see as “Provided by”. If you already sell on Nimpass, check that
            you are signed in with the wallet that made those Passes.
          </p>
        </Card>
      </Subsection>
    )
  }

  return (
    <Subsection title="Public profile">
      <PublicProfileCard provider={profile.data} wallet={wallet} />
    </Subsection>
  )
}

/**
 * The selling side of the same identity: a look at My Store, not a copy of it.
 *
 * Whether this wallet has a provider record is an authorisation question only
 * the backend answers, and it answers it with a record rather than with a flag
 * on the session (docs/09-SECURITY.md §67-§68). So this reads that record and
 * says what is actually true — never "you are a provider" because a session
 * exists.
 *
 * What it shows is at most three of the Passes this wallet made, in the same
 * card the store itself uses, and a way through to the rest. A profile should
 * give a glance and a door, not a second dashboard.
 */
function SellingSection() {
  const account = useProviderAccount()

  return (
    <Subsection
      title="Selling on Nimpass"
      action={
        account.status === 'ready' ? (
          <Button asChild variant="ghost" size="sm">
            <Link to="/my-store">
              View all Passes
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : undefined
      }
    >
      {account.status === 'loading' ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : account.status === 'error' ? (
        <ErrorState error={account.error} />
      ) : account.status === 'ready' ? (
        <CreatedPassPreview />
      ) : (
        <Card variant="muted" className="flex flex-col items-start gap-3 p-6">
          <p className="text-body text-ink-muted">
            You buy passes with this wallet. Trainers, tutors and coaches can also sell prepaid
            sessions with it and get paid in NIM.
          </p>
          <Button asChild size="sm" variant="secondary">
            <Link to="/provider/passes/new">
              <Store aria-hidden="true" />
              Create a Pass
            </Link>
          </Button>
        </Card>
      )}
    </Subsection>
  )
}

/** The newest three Passes this wallet made. The rest are in My Store. */
const PROFILE_STORE_PREVIEW = 3

function CreatedPassPreview() {
  const catalog = useMyCatalogPasses()

  if (catalog.isPending) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <CreatedPassCardSkeleton />
        <CreatedPassCardSkeleton />
        <CreatedPassCardSkeleton />
      </div>
    )
  }

  if (catalog.isError) {
    return <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
  }

  const items = catalog.data.items.slice(0, PROFILE_STORE_PREVIEW)

  if (items.length === 0) {
    return (
      <Card variant="muted" className="flex flex-col items-start gap-3 p-6">
        <p className="text-body text-ink-muted">
          This wallet sells on Nimpass. The Passes you make will live in My Store.
        </p>
        <Button asChild size="sm">
          <Link to="/provider/passes/new">
            <Store aria-hidden="true" />
            Create a Pass
          </Link>
        </Button>
      </Card>
    )
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((pass) => (
        <CreatedPassCard key={pass.id} pass={pass} />
      ))}
    </div>
  )
}

/**
 * Nobody is signed in.
 *
 * The page still exists and still explains itself — a profile that 404s for a
 * visitor teaches them nothing about what an account here even is. The action
 * is the same one the header offers, and it works in every runtime: Nimiq Pay
 * inside the Mini App, the Nimiq Hub in a browser. Only a runtime where neither
 * can be reached falls back to explaining (docs/08-ARCHITECTURE.md §87).
 */
function LoginPrompt() {
  const wallet = useWallet()
  const [signInOpen, setSignInOpen] = useState(false)
  const canSignIn = useCanUseWallet()
  const opener = canSignIn ? null : miniAppOpenerUrl()

  return (
    <Card variant="muted" className="flex flex-col items-start gap-4 p-6 sm:p-8">
      <h2 className="text-h3 text-ink">You're not logged in</h2>
      <p className="max-w-lg text-body text-ink-muted">
        Logging in takes one signature from your Nimiq wallet — no password, no email, nothing to
        remember. Signing in for the first time creates your Nimpass account; after that the same
        wallet always brings back the same passes.
      </p>
      <p className="max-w-lg text-small text-ink-subtle">
        {canSignIn
          ? `Connected to ${networkLabel(wallet.network)}.`
          : "We couldn't reach a Nimiq wallet from this page. Browsing works fine here."}
      </p>

      {canSignIn ? (
        <>
          <Button onClick={() => setSignInOpen(true)}>
            <LogIn aria-hidden="true" />
            Login
          </Button>
          <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
        </>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          {opener ? (
            <Button asChild>
              <a href={opener} rel="noreferrer">
                <LogIn aria-hidden="true" />
                Open in Nimiq Pay
              </a>
            </Button>
          ) : null}
          <Button asChild variant="secondary">
            <Link to="/discover">Browse passes</Link>
          </Button>
        </div>
      )}
    </Card>
  )
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
    </div>
  )
}
