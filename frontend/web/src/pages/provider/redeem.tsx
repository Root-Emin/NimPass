import { Camera, CameraOff, CheckCircle2, Keyboard, ScanLine, XCircle } from 'lucide-react'
import { useCallback, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'

import { ApiError, messageForApiError, queryKeys, redemptionsApi } from '@/api'
import {
  looksLikeRedemptionReference,
  normaliseRedemptionReference,
} from '@/api/redemptions'
import { useQueryClient } from '@tanstack/react-query'
import { WorkspaceHeader } from '@/components/layout/provider-shell'
import { WorkspaceGate } from '@/components/provider/workspace-gate'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useCameraScanner, type CameraStatus } from '@/hooks/use-camera-scanner'
import { useProviderAccount, useProviderRedemptions } from '@/hooks/use-provider-workspace'
import { formatDateTime, formatSessions, shortenAddress } from '@/lib/format'
import type { ProviderRedemptionState } from '@/types/redemption'

/**
 * The provider's session validation screen (docs/02-USER-FLOWS.md §49-§54).
 *
 * Two ways in, deliberately equal: scan the customer's QR, or type the code.
 * Nimpass is web-first and a provider may well be at a laptop with no camera,
 * so redemption must never depend on one (docs/01-PRODUCT.md §25, §40).
 *
 * What the provider is *not* given is as important as what they are: there is
 * no field here for editing a remaining count, no way to set a pass status, and
 * no way to consume a session outside an authorised redemption. Balances change
 * through one backend operation and no other (docs/09-SECURITY.md §41, §137).
 */
export function ProviderRedeemPage() {
  return (
    <>
      <WorkspaceHeader
        title="Redeem a session"
        description="Scan or type the code your customer is showing to use one session from their pass."
      />
      <div className="mt-8">
        <WorkspaceGate>
          <RedeemFlow />
        </WorkspaceGate>
      </div>
    </>
  )
}

function RedeemFlow() {
  const queryClient = useQueryClient()
  const providerId = useProviderAccount().providerId
  const [state, setState] = useState<ProviderRedemptionState>({ kind: 'IDLE' })
  const [code, setCode] = useState('')
  /*
   * Guards the confirm step. A double tap must never become two confirmations.
   *
   * This is a UX lock and nothing more: the reference is single-use and the
   * backend enforces that inside the consuming transaction. Presenting this
   * ref as the protection would be presenting the wrong thing as the guarantee
   * (§34).
   */
  const completing = useRef(false)

  /** Turns a backend rejection into provider-facing copy. */
  const reject = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.isDomainError) {
      setState({ kind: 'REJECTED', reason: messageForApiError(error), code: error.code })
      return
    }
    setState({ kind: 'UNAVAILABLE', message: messageForApiError(error) })
  }, [])

  /**
   * Resolves a reference to context. **Consumes nothing.**
   *
   * A successful lookup is not a redemption and must never be rendered as one.
   * It exists so the provider can see what they are about to spend before they
   * spend it (§18).
   */
  const lookup = useCallback(
    async (reference: string) => {
      if (!providerId) return
      const trimmed = normaliseRedemptionReference(reference)
      if (!trimmed) return

      setState({ kind: 'LOOKING_UP', reference: trimmed })
      try {
        const found = await redemptionsApi.lookupRedemption(providerId, {
          redemptionReference: trimmed,
        })
        setState({ kind: 'CONFIRMING', reference: trimmed, lookup: found })
      } catch (error) {
        reject(error)
      }
    },
    [providerId, reject],
  )

  const scanner = useCameraScanner(
    useCallback(
      (value) => {
        setCode(value)
        // A scan fills the field and looks the code up. It deliberately stops
        // there: the confirm step below is a separate, human decision (§22).
        void lookup(value)
      },
      [lookup],
    ),
  )

  /** The one call that consumes a session. */
  const confirm = useCallback(async () => {
    if (state.kind !== 'CONFIRMING') return
    if (completing.current || !providerId) return
    completing.current = true

    const { reference, lookup: context } = state
    setState({ kind: 'COMPLETING', reference, lookup: context })
    try {
      const result = await redemptionsApi.confirmRedemption(providerId, {
        redemptionReference: reference,
      })
      // Every number here is the backend's, read back from the transaction that
      // wrote it. Nothing computes `remaining - 1` (§24).
      setState({ kind: 'COMPLETED', result, lookup: context })
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.passes() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.redemptions.provider(providerId) })
    } catch (error) {
      reject(error)
    } finally {
      completing.current = false
    }
  }, [providerId, queryClient, reject, state])

  const reset = useCallback(() => {
    scanner.stop()
    setCode('')
    setState({ kind: 'IDLE' })
  }, [scanner])

  if (state.kind === 'COMPLETED') {
    const { result } = state
    return (
      <Card className="flex flex-col items-start gap-4 p-6">
        <p className="flex items-center gap-2 text-h3 text-ink">
          <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
          {result.completed ? 'Session used — pass complete' : 'Session used'}
        </p>
        <p className="text-body text-ink-muted">
          {state.lookup ? `${state.lookup.packageTitle} — ` : ''}
          {result.completed
            ? 'That was the last session on this pass.'
            : `${formatSessions(result.remainingSessions)} remaining.`}
        </p>
        <Button onClick={reset}>Redeem another</Button>
      </Card>
    )
  }

  if (state.kind === 'CONFIRMING' || state.kind === 'COMPLETING') {
    const context = state.lookup
    const busy = state.kind === 'COMPLETING'
    return (
      <Card className="space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="text-h3 text-ink">{context.packageTitle}</h2>
          <p className="text-body text-ink-muted">{context.serviceName}</p>
        </div>

        {/*
          What confirming will actually do, in the provider's terms.

          Only fields the lookup returned. There is no customer name, wallet or
          identity here because the backend does not send one — the lookup is
          privacy-minimised on purpose and this screen keeps it that way (§20).
        */}
        <dl className="grid grid-cols-2 gap-4 rounded-md bg-surface-muted p-4">
          <div>
            <dt className="text-small text-ink-subtle">About to use</dt>
            <dd className="mt-0.5 text-body-lg font-medium text-ink">
              Session {context.nextSessionOrdinal}
            </dd>
          </div>
          <div>
            <dt className="text-small text-ink-subtle">Remaining now</dt>
            <dd className="mt-0.5 text-body-lg font-medium text-ink">
              {context.remainingSessions}
            </dd>
          </div>
          <div>
            <dt className="text-small text-ink-subtle">Already used</dt>
            <dd className="mt-0.5 text-body text-ink">{context.usedSessions}</dd>
          </div>
          <div>
            <dt className="text-small text-ink-subtle">Code valid until</dt>
            <dd className="mt-0.5 text-body text-ink">
              {formatDateTime(context.referenceExpiresAt ?? context.challengeExpiresAt)}
            </dd>
          </div>
          {/*
            Pass status and its expiry, straight from the lookup.
            
            The backend only returns this shape for an ACTIVE pass, so the
            status is not a warning here — it is the provider's confirmation
            that the thing they are about to charge against is in good standing.
            The expiry matters more: a pass valid until next week and one valid
            until tonight look identical without it.
          */}
          <div>
            <dt className="text-small text-ink-subtle">Pass status</dt>
            <dd className="mt-0.5 text-body text-ink">{PASS_STATUS_COPY[context.passStatus]}</dd>
          </div>
          <div>
            <dt className="text-small text-ink-subtle">Pass valid until</dt>
            <dd className="mt-0.5 text-body text-ink">
              {context.passExpiresAt ? formatDateTime(context.passExpiresAt) : 'No expiry'}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={reset} disabled={busy}>
            Cancel
          </Button>
          {/* Explicit, and never triggered by the scanner itself (§22). */}
          <Button onClick={() => void confirm()} loading={busy} disabled={busy}>
            Confirm session
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      {state.kind === 'REJECTED' ? (
        <Alert tone="warning" icon={<XCircle />} title="That code wasn't accepted">
          {state.reason}
        </Alert>
      ) : null}

      {state.kind === 'UNAVAILABLE' ? (
        <Alert tone="danger" icon={<XCircle />} title="Session validation is unavailable">
          {state.message} No session was used.
        </Alert>
      ) : null}

      <Card className="space-y-5 p-6">
        <ScannerPanel
          status={scanner.status}
          supported={scanner.supported}
          videoRef={scanner.videoRef}
          onStart={() => void scanner.start()}
          onStop={scanner.stop}
        />
      </Card>

      <Card className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <Keyboard className="mt-0.5 size-5 shrink-0 text-ink-subtle" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="text-h3 text-ink">Or type the code</h2>
            <p className="text-body text-ink-muted">
              Works everywhere, including on a desktop with no camera.
            </p>
          </div>
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void lookup(code)
          }}
        >
          <Field
            label="Session code"
            hint="Starts with NR1: — the code shown on the customer's pass."
          >
            {(props) => (
              <Input
                {...props}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="NR1:…"
              />
            )}
          </Field>
          <Button
            type="submit"
            // Shape only. A well-formed code is not a valid one — expiry,
            // authorisation, ownership and single use are all invisible in the
            // string, and all decided by the backend (§37).
            disabled={!looksLikeRedemptionReference(code)}
            loading={state.kind === 'LOOKING_UP'}
          >
            Look up code
          </Button>
        </form>
      </Card>

      <RecentRedemptions />

      <p className="text-small text-ink-subtle">
        Sessions can only be used through a valid, unexpired code. You can't change a
        customer's remaining count from here — and neither can anyone else.{' '}
        <Link to="/provider/passes" className="underline underline-offset-2">
          See all passes
        </Link>
      </p>
    </div>
  )
}

/**
 * The sessions this provider has actually redeemed.
 *
 * Real rows from the backend, newest first — no counts, no charts, no
 * "sessions this week". The contract returns consumed redemptions and nothing
 * else, so inventing a metric on top would be inventing data (§39).
 *
 * `ownerWallet` is the one identifying field the history carries, and it is
 * shown truncated: the provider needs to recognise a returning customer, not to
 * hold their address.
 */
function RecentRedemptions() {
  const history = useProviderRedemptions()

  if (history.isPending || history.isError) return null
  const items = history.data ?? []
  if (items.length === 0) return null

  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-h3 text-ink">Recently redeemed</h2>
      <ul className="space-y-3">
        {items.slice(0, 10).map((item) => (
          <li key={item.redemptionId} className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 text-body text-ink">
              Session {item.sessionOrdinal}
              <span className="ml-2 font-mono text-micro text-ink-subtle">
                {shortenAddress(item.ownerWallet)}
              </span>
            </span>
            <span className="shrink-0 text-small text-ink-subtle">
              {formatDateTime(item.redeemedAt)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * The camera half.
 *
 * Every state here is a distinct message, because "allow camera access" and
 * "this device has no camera" and "this page isn't on HTTPS" need three
 * different responses from the provider (milestone brief §23). The camera is
 * only ever touched by the button below.
 */
function ScannerPanel({
  status,
  supported,
  videoRef,
  onStart,
  onStop,
}: {
  status: CameraStatus
  supported: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  onStart: () => void
  onStop: () => void
}) {
  const message = CAMERA_COPY[status]
  const scanning = status === 'scanning'

  return (
    <>
      <div className="flex items-start gap-3">
        <ScanLine className="mt-0.5 size-5 shrink-0 text-ink-subtle" aria-hidden="true" />
        <div className="space-y-1">
          <h2 className="text-h3 text-ink">Scan the customer's code</h2>
          <p className="text-body text-ink-muted">
            The camera only turns on when you start a scan.
          </p>
        </div>
      </div>

      {scanning ? (
        <div className="overflow-hidden rounded-lg bg-ink">
          <video
            ref={videoRef}
            className="aspect-[4/3] w-full object-cover"
            muted
            playsInline
            // Decorative: the status line below carries the information.
            aria-hidden="true"
          />
        </div>
      ) : null}

      {message ? (
        <p className="flex gap-2.5 text-body text-ink-muted" role="status" aria-live="polite">
          <CameraOff className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          {message}
        </p>
      ) : null}

      {scanning ? (
        <Button variant="secondary" onClick={onStop}>
          Stop scanning
        </Button>
      ) : (
        <Button
          onClick={onStart}
          loading={status === 'requesting'}
          disabled={!supported && status !== 'idle'}
        >
          <Camera aria-hidden="true" />
          {status === 'idle' ? 'Start scanning' : 'Try again'}
        </Button>
      )}
    </>
  )
}

/** Pass status in the provider's words, never the raw enum. */
const PASS_STATUS_COPY: Record<string, string> = {
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
}

/** Null where there is nothing worth saying yet. */
const CAMERA_COPY: Record<CameraStatus, string | null> = {
  idle: null,
  requesting: null,
  scanning: null,
  denied:
    'Camera access was blocked. Allow it in your browser settings, or type the code instead.',
  'no-camera': "This device doesn't have a camera available. Type the code instead.",
  'insecure-context':
    'Camera scanning needs a secure (HTTPS) connection. Type the code instead.',
  unsupported: "This browser can't scan QR codes. Type the code instead.",
  error: "The camera couldn't be started. Type the code instead.",
}
