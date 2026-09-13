import { Camera, CameraOff, CheckCircle2, Keyboard, ScanLine, XCircle } from 'lucide-react'
import { useCallback, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'

import { ApiError, messageForApiError, queryKeys, redemptionsApi } from '@/api'
import { useQueryClient } from '@tanstack/react-query'
import { WorkspaceHeader } from '@/components/layout/provider-shell'
import { WorkspaceGate } from '@/components/provider/workspace-gate'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useCameraScanner, type CameraStatus } from '@/hooks/use-camera-scanner'
import { createIdempotencyKey } from '@/lib/utils'
import { formatSessions } from '@/lib/format'
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
  const [state, setState] = useState<ProviderRedemptionState>({ kind: 'IDLE' })
  const [code, setCode] = useState('')
  // Guards the confirm step: a double tap must never become two completions.
  // The backend is idempotent per redemption, but the UI should not rely on
  // that to avoid asking twice (docs/09-SECURITY.md §55).
  const completing = useRef(false)

  const lookup = useCallback(async (reference: string) => {
    const trimmed = reference.trim()
    if (!trimmed) return

    setState({ kind: 'LOOKING_UP', reference: trimmed })
    try {
      const found = await redemptionsApi.lookupRedemptionChallenge(trimmed)
      setState({
        kind: 'CONFIRMING',
        reference: trimmed,
        redemptionId: found.redemptionId,
        pass: found.pass,
      })
    } catch (error) {
      // A code the backend refuses is a domain answer — expired, already used,
      // another provider's customer — and reads as a rejection. Not being able
      // to ask at all is a different thing and says so.
      if (error instanceof ApiError && error.isDomainError) {
        setState({ kind: 'REJECTED', reason: messageForApiError(error) })
      } else {
        setState({ kind: 'UNAVAILABLE', message: messageForApiError(error) })
      }
    }
  }, [])

  const scanner = useCameraScanner(
    useCallback(
      (value) => {
        setCode(value)
        void lookup(value)
      },
      [lookup],
    ),
  )

  const confirm = useCallback(async () => {
    if (state.kind !== 'CONFIRMING') return
    if (completing.current) return
    completing.current = true

    const { reference, redemptionId, pass } = state
    setState({ kind: 'COMPLETING', reference, redemptionId })
    try {
      const result = await redemptionsApi.completeRedemption(redemptionId, {
        idempotencyKey: createIdempotencyKey(),
      })
      // The new balance is the backend's number, read back — never
      // `remaining - 1` computed here (docs/08-ARCHITECTURE.md §49).
      setState({
        kind: 'COMPLETED',
        remaining: result.remainingSessions,
        packageTitle: pass.packageTitle,
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.passes() })
    } catch (error) {
      if (error instanceof ApiError && error.isDomainError) {
        setState({ kind: 'REJECTED', reason: messageForApiError(error) })
      } else {
        setState({ kind: 'UNAVAILABLE', message: messageForApiError(error) })
      }
    } finally {
      completing.current = false
    }
  }, [queryClient, state])

  const reset = useCallback(() => {
    scanner.stop()
    setCode('')
    setState({ kind: 'IDLE' })
  }, [scanner])

  if (state.kind === 'COMPLETED') {
    return (
      <Card className="flex flex-col items-start gap-4 p-6">
        <p className="flex items-center gap-2 text-h3 text-ink">
          <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
          Session completed
        </p>
        <p className="text-body text-ink-muted">
          {state.packageTitle} — {formatSessions(state.remaining)} remaining.
        </p>
        <Button onClick={reset}>Redeem another</Button>
      </Card>
    )
  }

  if (state.kind === 'CONFIRMING' || state.kind === 'COMPLETING') {
    const pass = state.kind === 'CONFIRMING' ? state.pass : null
    return (
      <Card className="space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="text-h3 text-ink">{pass?.packageTitle ?? 'Confirming…'}</h2>
          {pass ? <p className="text-body text-ink-muted">{pass.serviceTitle}</p> : null}
        </div>

        {pass ? (
          <>
            {/* Human-readable consequence, not identifiers (docs/02 §52). */}
            <div className="rounded-md bg-surface-muted p-4">
              <p className="text-body text-ink">
                {formatSessions(pass.sessionsRemaining)} remaining. Use one?
              </p>
              <p className="mt-1 text-small text-ink-muted">
                After this: {formatSessions(Math.max(0, pass.sessionsRemaining - 1))} remaining.
              </p>
            </div>
          </>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={reset} disabled={state.kind === 'COMPLETING'}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} loading={state.kind === 'COMPLETING'}>
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
          {state.reason} Ask the customer to generate a new one.
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
          <Field label="Session code" hint="The code shown on the customer's pass.">
            {(props) => (
              <Input
                {...props}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="NP:…"
              />
            )}
          </Field>
          <Button
            type="submit"
            disabled={!code.trim()}
            loading={state.kind === 'LOOKING_UP'}
          >
            Look up code
          </Button>
        </form>
      </Card>

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
