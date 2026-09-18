import { useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  AlignLeft,
  ChevronLeft,
  Coins,
  Divide,
  Globe,
  Layers,
  MapPin,
  ShieldCheck,
  Store,
} from 'lucide-react'

import { messageForApiError, mediaApi } from '@/api'
import { Container } from '@/components/layout/container'
import { AppearancePanel } from '@/components/catalog/appearance-panel'
import { CoverControl } from '@/components/catalog/cover-control'
import { DeletePassAction } from '@/components/catalog/delete-pass-action'
import { UnpublishPassAction } from '@/components/catalog/unpublish-pass-action'
import { PassConfirmDialog } from '@/components/catalog/pass-confirm-dialog'
import { PassPreview } from '@/components/catalog/pass-preview'
import { ThemeGround } from '@/components/catalog/theme-ground'
import { ProviderAccountBoundary } from '@/components/provider/account-boundary'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { Field } from '@/components/ui/field'
import { Input, InputAffix, Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import {
  useEnsureProvider,
  useEnsureService,
  useMyCatalogPass,
  useMyProviderProfile,
  useMyServices,
  usePublishPass,
  useSavePass,
} from '@/hooks/use-provider-workspace'
import { civilToIso, DEFAULT_EXPIRY_TIME, isoToCivil } from '@/lib/civil-date'
import { formatNim, lunaToNimInput, nimToLuna, perSessionLuna } from '@/lib/format'
import { randomAccent, resolveAccent, type PassAccent } from '@/lib/pass-accent'
import { serviceKind } from '@/lib/service-kind'
import { cn } from '@/lib/utils'
import type { Pass, PassStatus, Service } from '@/types/domain'
import { validatePassDraft } from '@/pages/provider/pass-validation'

/**
 * Create and edit a pass — one calm screen composed on a soft, themed
 * ground.
 *
 * The shape is the one Luma uses to create a thing: the object held large on
 * the left, and on the right a named title at headline size, then short settled
 * rows rather than a stack of boxed inputs — ending in one unmissable action.
 * What is *not* borrowed is the chrome or the palette. The ground is mixed from
 * the pass's own tone (`lib/pass-accent`), so the screen opens in a different,
 * quiet colour each time rather than in one fixed purple, and
 * `docs/03-DESIGN-SYSTEM.md` is explicit that Luma is a reference rather than a
 * skin to copy.
 *
 * Every row on this screen is wired to something the contract actually
 * stores. A cover photo is optional (`PassInput.coverMediaId`); the other
 * reference event fields that Nimpass does not have — a start instant, a
 * venue, an attendee cap — are either the product's real behaviour or a
 * pointer at the profile that does hold them. It never renders a control that
 * quietly drops what it collects.
 *
 * The form does not ask what the pass is for. A pass still belongs to a service
 * — `POST /providers/{id}/services/{serviceId}/passes` has nowhere else to put
 * it — but that relation is now resolved from the pass's own name when it is
 * saved (`useEnsureService`, `{ kind: 'auto' }`), so the screen is the pass and
 * nothing else.
 *
 * The price is typed in NIM because that is what a provider thinks in, and
 * converted to integer Luna before it leaves the browser
 * (docs/05-NIMIQ-PAY-INTEGRATION.md §6-9). It is still only *input*: the
 * backend decides what a pass actually costs (docs/08-ARCHITECTURE.md §71).
 */
export function PassFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id } = useParams<{ id: string }>()

  return (
    <Container width="wide" className="py-8 sm:py-12">
      <header className="mb-5 flex items-center justify-between gap-4">
        {/*
          The name field is the visual headline. A second large title above
          the cover would say the same thing twice, so on a phone the h1
          stays in the document outline and the back link sits on the left.
        */}
        <Link
          to="/my-store"
          className="inline-flex min-h-11 sm:min-h-0 items-center gap-1 text-small text-ink-muted transition-colors duration-[--nimpass-duration-fast] hover:text-ink lg:order-last"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          My Store
        </Link>
        <h1 className="text-h3 text-ink max-lg:sr-only">
          {mode === 'create' ? 'Create Pass' : 'Edit Pass'}
        </h1>
      </header>

      <ProviderAccountBoundary>
        <PassForm mode={mode} passId={mode === 'edit' ? id : undefined} />
      </ProviderAccountBoundary>
    </Container>
  )
}

export interface PassDraft {
  title: string
  /**
   * The seller's public name — collected only on a first sale, and only
   * because the provider record has to be created before the pass can be
   * (`useEnsureProvider`). Empty on every later pass and in edit mode, where
   * the record already exists and the name is not this form's to change.
   */
  storeName: string
  sessionCount: string
  priceNim: string
  expiresOn: string
  expiresAtTime: string
  description: string
  accent: PassAccent
  coverMediaId: string | null
}

function emptyDraft(): PassDraft {
  return {
    title: '',
    storeName: '',
    sessionCount: '',
    priceNim: '',
    expiresOn: '',
    expiresAtTime: '',
    description: '',
    // Not pine every time. Pine is the product's chrome; a new pass opens
    // somewhere in the range and settles on a name-derived tone as the provider
    // types.
    accent: randomAccent(),
    coverMediaId: null,
  }
}

function PassForm({ mode, passId }: { mode: 'create' | 'edit'; passId?: string }) {
  const services = useMyServices()
  const existing = useMyCatalogPass(passId)

  if (mode === 'edit') {
    if (existing.isPending) return <FormSkeleton rows={5} />
    if (existing.isError) {
      return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />
    }
  }

  if (services.isPending) return <FormSkeleton rows={5} />
  if (services.isError) {
    return <ErrorState error={services.error} onRetry={() => void services.refetch()} />
  }

  // Everything the form needs has loaded, so the draft is seeded from the state
  // initialiser rather than reconciled by an effect.
  return (
    <PassFields
      mode={mode}
      passId={passId}
      services={services.data.items}
      initial={existing.data}
    />
  )
}

function PassFields({
  mode,
  passId,
  services,
  initial,
}: {
  mode: 'create' | 'edit'
  passId?: string
  services: Service[]
  initial?: Pass
}) {
  const navigate = useNavigate()
  const save = useSavePass(passId)
  const ensureProvider = useEnsureProvider()
  const ensureService = useEnsureService()
  const publish = usePublishPass()
  // Already settled — `ProviderAccountBoundary` waits on this same query, so
  // `data` here is the answer and not a pending one, and the preview costs no
  // request.
  const profile = useMyProviderProfile()
  const provider = profile.data ?? null
  /*
   * A wallet selling for the first time. There is no provider record yet, so
   * the one thing the form has to collect that is not about the pass is the
   * name customers will read under it. It is asked here, on the form, rather
   * than on a setup screen in front of it (docs/DECISIONS.md ADR-020).
   */
  const needsStoreName = mode === 'create' && provider === null

  const initialService = initial ? services.find((item) => item.id === initial.serviceId) : undefined

  const [draft, setDraft] = useState<PassDraft>(() => {
    if (!initial) return emptyDraft()
    const kind = serviceKind(initialService?.name ?? initial.title)
    const expiry = initial.expirationAt ? isoToCivil(initial.expirationAt) : null
    return {
      title: initial.title,
      storeName: '',
      sessionCount: String(initial.sessions),
      priceNim: lunaToNimInput(initial.priceLuna),
      expiresOn: expiry?.date ?? '',
      expiresAtTime: expiry?.time ?? '',
      description: initial.description ?? '',
      accent: resolveAccent(initial.accent, initialService?.name ?? initial.title, kind.id),
      coverMediaId: initial.coverMediaId,
    }
  })
  const [errors, setErrors] = useState<Partial<Record<keyof PassDraft, string>>>({})
  const [accentTouched, setAccentTouched] = useState(() => Boolean(initial?.accent))
  const [coverBusy, setCoverBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const set = <K extends keyof PassDraft>(key: K, value: PassDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => ({ ...previous, [key]: undefined }))
  }

  const chooseAccent = (accent: PassAccent) => {
    setAccentTouched(true)
    set('accent', accent)
  }

  /*
   * The pass's name also picks its colour, unless the provider has already
   * chosen one. The tone is derived from what the pass is called, so "10 Guitar
   * Lessons" and "10 Personal Training Sessions" open in different quiet colours
   * rather than in one fixed brand hue.
   */
  const nameChanged = (title: string) => {
    setDraft((previous) => ({
      ...previous,
      title,
      accent: accentTouched ? previous.accent : resolveAccent(null, title, serviceKind(title).id),
    }))
    setErrors((previous) => ({ ...previous, title: undefined }))
  }

  // Parsed with Number, not parseInt: parseInt('7.4') silently becomes 7, which
  // would let a fractional session count through validation
  // (docs/08-ARCHITECTURE.md §76).
  const sessionCount = draft.sessionCount.trim() === '' ? Number.NaN : Number(draft.sessionCount)
  // The single NIM → Luna conversion (docs/05 §9). It parses the decimal string
  // rather than multiplying a float, and returns null for anything that is not
  // a whole number of Luna.
  const priceLuna = nimToLuna(draft.priceNim)
  const perSession =
    priceLuna !== null && priceLuna > 0 ? perSessionLuna(priceLuna, sessionCount) : null

  const status: PassStatus = initial?.status ?? 'DRAFT'
  /** What the preview writes under the pass: the stored name, or the one being typed. */
  const providerName = provider?.name ?? (draft.storeName.trim() || null)
  /** What the preview writes in the service slot: the real one, or the name. */
  const serviceName = initialService?.name ?? (draft.title.trim() || null)
  const expiresAt = draft.expiresOn.trim()
    ? civilToIso(draft.expiresOn, draft.expiresAtTime || DEFAULT_EXPIRY_TIME)
    : null
  const coverSrc = mediaApi.resolveCoverUrl(
    draft.coverMediaId ? mediaApi.mediaPath(draft.coverMediaId) : null,
  )

  // One create at a time. `save.isPending` already disables both buttons, but
  // React state lands a render later than a second click can arrive, so the
  // guard is a ref as well (docs/05-NIMIQ-PAY-INTEGRATION.md §68 keeps the
  // server side of the same promise with an idempotency key).
  const writing = useRef(false)
  const busy =
    save.isPending || ensureProvider.isPending || ensureService.isPending || writing.current

  const submit = (event: React.FormEvent) => {
    event.preventDefault()

    const next = validatePassDraft(draft, { sessionCount, priceLuna, needsStoreName })
    setErrors(next)
    if (Object.keys(next).length > 0) return

    // Creating a Pass is the one write on this screen that cannot be undone
    // from the UI, so it gets a look at the finished thing first. Editing an
    // existing pass saves straight away: the object is already there and the
    // provider is looking at it.
    if (mode === 'create') {
      setConfirming(true)
      return
    }
    void write()
  }

  /**
   * Up to three writes, in order, because the contract has no single call that
   * makes them: a pass is created under a service, which is created under a
   * provider (`POST /providers/{id}/services/{serviceId}/passes`), so each has
   * to exist before the next. `useEnsureProvider` resolves the provider from
   * the name on the form — returning the existing record untouched for every
   * provider who already has one — and `useEnsureService` resolves the service
   * from the pass's own name and guarantees it is ACTIVE, which is what
   * publishing will later require.
   *
   * Each id is threaded from the call that produced it rather than re-read from
   * the cache: on a first sale the provider was created microseconds ago and
   * the profile query has not come back.
   *
   * If an earlier write succeeds and a later one fails, the provider is left
   * with a record they never saw. That is the harmless direction: both are
   * invisible, both are reused by the next attempt, and the alternatives — a
   * service with no provider, a pass with no service — cannot exist at all.
   */
  async function write() {
    if (writing.current) return
    writing.current = true
    try {
      let providerId: string
      let serviceId: string
      try {
        providerId = await ensureProvider.mutateAsync({
          // Ignored when a provider record already exists; the form only
          // collects this on a first sale.
          name: draft.storeName.trim(),
        })
        serviceId =
          mode === 'edit' && initial
            ? initial.serviceId
            : await ensureService.mutateAsync({
                kind: 'auto',
                name: draft.title.trim(),
                services,
                providerId,
              })
      } catch {
        // Surfaced through the mutations' own error state, with the backend's
        // message. Nothing was created that the next attempt cannot reuse.
        return
      }

      const saved = await saveQuietly({
        providerId,
        serviceId,
        title: draft.title.trim(),
        ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
        sessions: sessionCount,
        priceLuna: priceLuna as number,
        // `PassInput.expirationAt` is an absolute UTC instant. The picker
        // collects a local date and time; `civilToIso` is the one conversion
        // onto that instant (docs/08-ARCHITECTURE.md §35).
        expirationAt: expiresAt,
        accent: draft.accent,
        coverMediaId: draft.coverMediaId,
      })

      // Straight to the Pass that was just made. It is the beginning of the job
      // rather than the end of it — the next thing a provider wants is to look
      // at what they made and publish it, and both are on that screen.
      if (saved && mode === 'create') {
        setConfirming(false)
        navigate(`/provider/passes/${saved.id}/edit`, { replace: true })
      }
    } finally {
      writing.current = false
    }
  }

  /** Runs the save and reports failure through mutation state, not a throw. */
  async function saveQuietly(input: Parameters<typeof save.mutateAsync>[0]) {
    try {
      return await save.mutateAsync(input)
    } catch {
      return null
    }
  }

  const writeError = ensureProvider.isError
    ? messageForApiError(ensureProvider.error)
    : ensureService.isError
      ? messageForApiError(ensureService.error)
      : save.isError
        ? messageForApiError(save.error)
        : null

  return (
    <ThemeGround accent={draft.accent} className="max-lg:pb-28">
      <form onSubmit={submit} noValidate>
        {/*
          Cover, theme, then the facts — the same vertical order the
          creation-screen wireframe uses on a phone. Two columns on a wide
          screen, with the cover held on the left. What is *not* borrowed is
          the chrome or the palette.
        */}
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:items-start lg:gap-12">
          <div className="mx-auto w-full max-w-[20.5rem] space-y-3 lg:max-w-none lg:sticky lg:top-24">
            <PassPreview
              title={draft.title}
              serviceName={serviceName}
              providerName={providerName}
              sessions={Number.isInteger(sessionCount) && sessionCount > 0 ? sessionCount : null}
              priceLuna={priceLuna !== null && priceLuna > 0 ? priceLuna : null}
              accent={draft.accent}
              coverSrc={coverSrc}
              action={
                <CoverControl
                  mediaId={draft.coverMediaId}
                  onChange={(id) => set('coverMediaId', id)}
                  onBusy={setCoverBusy}
                  disabled={status !== 'DRAFT' && status !== 'UNAVAILABLE'}
                />
              }
            />

            <AppearancePanel value={draft.accent} onChange={chooseAccent} />
          </div>

          <div className="min-w-0 space-y-3.5">
            {/*
              The name is the headline of the thing being made, so it is set at
              headline size rather than as one more 44px box. The label stays
              on the control for assistive tech; visually the large field is
              enough.
            */}
            <Field
              label="Pass name"
              error={errors.title}
              className="pb-1 [&>label]:sr-only"
            >
              {(props) => (
                <Input
                  {...props}
                  tone="bare"
                  placeholder="Pass name"
                  className="h-auto px-1 py-2 font-display text-h1 font-semibold tracking-tight"
                  value={draft.title}
                  onChange={(event) => nameChanged(event.target.value)}
                />
              )}
            </Field>

            {needsStoreName ? (
              <StoreNameRow
                value={draft.storeName}
                onChange={(next) => set('storeName', next)}
                error={errors.storeName}
              />
            ) : null}

            <ValidityPanel
              date={draft.expiresOn}
              time={draft.expiresAtTime}
              onChange={({ date, time }) => {
                setDraft((previous) => ({ ...previous, expiresOn: date, expiresAtTime: time }))
                setErrors((previous) => ({ ...previous, expiresOn: undefined }))
              }}
              error={errors.expiresOn}
            />

            <LocationRow location={provider?.location ?? ''} />

            <DescriptionField
              value={draft.description}
              onChange={(next) => set('description', next)}
            />

            <section className="pt-1">
              <h2 className="eyebrow mb-2.5 px-1 text-ink-subtle">Pass options</h2>

              <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
                <Field layout="row" label="Price" icon={<Coins />} error={errors.priceNim}>
                  {(props) => (
                    <InputAffix
                      {...props}
                      tone="bare"
                      affix="NIM"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.00001"
                      placeholder="250"
                      className="numeric no-spinner w-28 text-right sm:w-44"
                      value={draft.priceNim}
                      onChange={(event) => set('priceNim', event.target.value)}
                    />
                  )}
                </Field>

                {/*
                  The reference's capacity setting, in the terms Nimpass
                  actually sells in: a pass is a number of uses, and this is
                  the number.
                */}
                <Field
                  layout="row"
                  label="Number of sessions"
                  icon={<Layers />}
                  error={errors.sessionCount}
                >
                  {(props) => (
                    <Input
                      {...props}
                      tone="bare"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      placeholder="10"
                      className="numeric no-spinner w-20 text-right sm:w-44"
                      value={draft.sessionCount}
                      onChange={(event) => set('sessionCount', event.target.value)}
                    />
                  )}
                </Field>

                <PerSessionRow perSession={perSession} />

                {/*
                  The reference's approval toggle has no switch here, because
                  there is nothing to switch: a session is spent by the person
                  who owns the pass, signing with their own wallet, and no
                  setting on a pass changes that (docs/01-PRODUCT.md §24-§25).
                  Stating it is honest; a toggle that cannot be turned off
                  would not be.
                */}
                <StateRow
                  icon={<ShieldCheck />}
                  label="How sessions get used"
                  value="By the customer"
                  note="Your customer uses a session from their own pass, and the count updates for both of you."
                />
              </div>
            </section>

            {/*
              One action, full width, unmissable. On a phone it stays pinned
              to the bottom of the viewport so the provider can commit without
              scrolling past every row; desktop keeps it in the flow at the
              end of the form. Cancel stays a quiet link beside the sentence
              that explains what happens next.
            */}
            <div className="space-y-3 pt-2">
              {/* On create the same message is carried inside the confirmation
                  dialog, where the press that caused it happened. */}
              {writeError && !confirming ? (
                <Alert tone="danger" icon={<AlertCircle />} title="Couldn't save">
                  {writeError}
                </Alert>
              ) : null}

              {/*
                Publishing is its own act, and it lives here rather than on a
                list somewhere else: the provider is looking at the Pass, so
                this is where deciding to show it to people belongs.

                The backend is the one that decides whether a pass may go live —
                it requires an active service, a real price and session count,
                and a verified payout wallet, and answers 409 when any of those
                is missing (`catalog.go`). This offers the action and surfaces
                that rejection; it never pre-judges it.
              */}
              {mode === 'edit' && status !== 'ACTIVE' ? (
                <PublishBlock publish={publish} passId={passId as string} status={status} />
              ) : null}

              {/*
                The other direction, on the screen where the decision is made.
                An on-sale Pass previously had no publication control here at
                all — publishing disappeared once it had happened and nothing
                replaced it — so the only way to stop selling from this screen
                was the delete at the bottom. That is the mis-tap this whole
                action exists to prevent, so the reversible option belongs
                exactly where the irreversible one already was.
              */}
              {mode === 'edit' && initial && status === 'ACTIVE' ? (
                <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-muted/60 p-4 sm:p-5">
                  <div className="min-w-0 space-y-0.5">
                    <h2 className="text-body-lg font-medium text-ink">This Pass is on sale</h2>
                    <p className="text-small text-ink-muted">
                      Anyone can find it in Discover and buy it.
                    </p>
                  </div>
                  <UnpublishPassAction pass={initial} className="max-sm:w-full" />
                </section>
              ) : null}

              <div
                className="fixed inset-x-0 bottom-0 z-20 px-5 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] lg:static lg:px-0 lg:pt-1 lg:pb-0"
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 top-0 bg-gradient-to-t from-canvas/75 to-transparent lg:hidden"
                />
                <Button
                  type="submit"
                  size="xl"
                  block
                  loading={busy || coverBusy}
                  className="relative rounded-full shadow-lift"
                >
                  {mode === 'create' ? 'Create Pass' : 'Save changes'}
                </Button>
              </div>

              <div className="hidden flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 lg:flex">
                <p className="text-small text-ink-subtle">
                  {mode === 'create'
                    ? "You'll see the finished Pass before anything is created."
                    : 'Passes people already bought keep the terms they paid for.'}
                </p>
                <Button asChild type="button" variant="ghost" size="sm">
                  <Link to="/my-store">Cancel</Link>
                </Button>
              </div>

              {/*
                Deleting the Pass being edited. Last on the screen and visually
                quiet, because it is the one irreversible thing here and it must
                not sit next to Save where a mis-tap reaches it.

                `type="button"`: this lives inside the form element, and a
                default-type button in a form submits it.
              */}
              {mode === 'edit' && initial ? (
                <div className="mt-6 flex flex-col gap-2 border-t border-line pt-5 max-lg:mb-24 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-small text-ink-subtle">
                    Deleting stops new purchases. Passes already bought are unaffected.
                  </p>
                  <DeletePassAction
                    pass={initial}
                    redirectTo="/my-store"
                    label="Delete Pass"
                    className="max-sm:self-start"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </form>

      {/*
        Outside the form: the dialog's own buttons are actions, not submits, and
        the form itself stays mounted underneath with every field intact — so
        "Continue editing" returns to exactly what was typed, cover included.
      */}
      <PassConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        busy={busy}
        error={writeError}
        onConfirm={() => void write()}
        pass={{
          title: draft.title,
          serviceName,
          providerName,
          sessions: Number.isInteger(sessionCount) && sessionCount > 0 ? sessionCount : null,
          priceLuna: priceLuna !== null && priceLuna > 0 ? priceLuna : null,
          accent: draft.accent,
          coverSrc,
          description: draft.description,
          expiresAt,
        }}
      />
    </ThemeGround>
  )
}

/**
 * When the pass is good for — the composition the reference gives to a start
 * and an end, holding what Nimpass actually knows.
 *
 * A pass has no start date to choose: it begins the moment it is bought, and
 * saying so is more useful than a picker that would be ignored. The end is the
 * one instant the contract stores (`Pass.expirationAt`): a local date and a
 * half-hour clock, converted to UTC as it leaves the form. A pass without one
 * simply says nothing further — no clock note, no sentence about sessions
 * staying usable, nothing to read past.
 */
function ValidityPanel({
  date,
  time,
  onChange,
  error,
}: {
  date: string
  time: string
  onChange: (next: { date: string; time: string }) => void
  error?: string
}) {
  const chosen = date.trim() !== ''

  return (
    <section>
      <div className="flex gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-soft">
        {/*
          The rail: a filled dot for the moment it starts, a hollow one for the
          end that may never come. The dots are placed against the two 44px
          rows rather than spread by a flex column, so a taller end control
          cannot drag the lower dot off its line.
        */}
        <div aria-hidden="true" className="relative w-5 shrink-0">
          <span className="absolute left-1/2 top-[1.0625rem] size-2.5 -translate-x-1/2 rounded-full bg-ink/70" />
          <span className="absolute left-1/2 top-[1.8125rem] h-[1.9375rem] -translate-x-1/2 border-l border-dashed border-line-strong" />
          <span
            className={cn(
              'absolute left-1/2 top-[3.875rem] size-2.5 -translate-x-1/2 rounded-full border',
              chosen ? 'border-ink/70 bg-ink/70' : 'border-line-strong bg-surface',
            )}
          />
        </div>

        <div className="min-w-0 flex-1 divide-y divide-line">
          <div className="flex h-11 items-center justify-between gap-3 px-1">
            <span className="text-body font-medium text-ink">Starts</span>
            <span className="text-body text-ink-muted">On purchase</span>
          </div>

          <div className="flex items-center justify-between gap-3 px-1 py-1">
            <span className="shrink-0 text-body font-medium text-ink">
              Ends
              <span className="ml-2 text-micro font-normal text-ink-subtle">Optional</span>
            </span>
            <DateTimePicker date={date} time={time} onChange={onChange} error={error} />
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Where the sessions happen.
 *
 * The reference collects a venue per event. A Nimpass pass has no place of its
 * own in the contract — the one location the product stores belongs to the
 * provider (`Provider.location`) and is the same for every pass they sell.
 *
 * So this states it rather than collecting it. It is not a link to nowhere and
 * it does not pretend to be a field this form could save, because `PassInput`
 * has no place to put one. When there is nothing stored, the row says nothing
 * at all rather than inviting an edit it cannot carry out.
 */
function LocationRow({ location }: { location: string }) {
  if (!location.trim()) return null

  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-soft">
      <MapPin className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-ink">{location.trim()}</span>
        <span className="block truncate text-small text-ink-subtle">
          Shown on your public profile, for every pass.
        </span>
      </span>
    </div>
  )
}

/**
 * Who is selling — asked once, on a wallet's first Pass.
 *
 * A pass belongs to a service which belongs to a provider, so the provider
 * record has to exist before the pass can be written. It used to be a screen
 * standing in front of this form ("Set up your workspace"), which made becoming
 * a seller a setup step; it is one row now, and the record is created by the
 * same press that creates the Pass (docs/DECISIONS.md ADR-020).
 *
 * It is still *asked* rather than derived from the wallet address. This is the
 * name every customer reads under every pass this wallet ever sells, and it is
 * what the public page address is generated from (ADR-017) — a name nobody
 * chose would be a permanent one, because no screen edits it afterwards
 * (ADR-008's known gap).
 *
 * It disappears the moment the record exists: the second pass never sees it.
 */
function StoreNameRow({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (next: string) => void
  error?: string
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-soft">
      <Store className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
      <Field
        className="min-w-0 flex-1"
        label="Your store name"
        error={error}
        hint="Customers see this under every Pass you sell, and it sets your public page address."
      >
        {(props) => (
          <Input
            {...props}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Alex Fitness"
            maxLength={160}
            autoComplete="organization"
          />
        )}
      </Field>
    </div>
  )
}

/** A row that states something rather than asking for it. */
function StateRow({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode
  label: string
  value: string
  note?: string
}) {
  return (
    <div className="px-2 py-2.5 sm:px-3">
      <div className="flex items-center gap-4">
        <span className="flex min-w-0 flex-1 items-center gap-2.5 px-1 text-body text-ink">
          <span className="text-ink-subtle [&>svg]:size-4 [&>svg]:shrink-0" aria-hidden="true">
            {icon}
          </span>
          <span className="truncate font-medium">{label}</span>
        </span>
        <span className="shrink-0 px-1 text-body text-ink-muted">{value}</span>
      </div>
      {note ? <p className="px-1 pt-1 text-small text-ink-subtle sm:pl-8">{note}</p> : null}
    </div>
  )
}

/**
 * What the pass works out to per session, in the row under the two fields
 * that produce it — because that is the figure a provider is actually checking
 * while they type.
 */
function PerSessionRow({ perSession }: { perSession: number | null }) {
  return (
    <aside className="flex items-center gap-4 bg-surface-muted/60 px-3 py-3 sm:px-4">
      <span className="flex min-w-0 flex-1 items-center gap-2.5 px-1 text-body text-ink-muted">
        <Divide className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
        <span className="truncate">Per session</span>
      </span>
      <span
        className={cn(
          'numeric shrink-0 px-1 font-display text-body-lg font-semibold',
          perSession === null ? 'text-ink-subtle' : 'text-ink',
        )}
      >
        {perSession === null ? '—' : formatNim(perSession)}
      </span>
    </aside>
  )
}

/**
 * Description, folded away until it is wanted.
 *
 * The reference keeps optional detail behind a single quiet row so the page
 * reads as short, and that is the right trade here: most passes are named
 * well enough to sell themselves, and an empty six-line textarea makes the
 * form look like work. It starts open when there is already something to read,
 * and only autofocuses when a provider opened it deliberately — never on page
 * load.
 *
 * Once it is open it belongs to whoever is writing: the box opens at a
 * comfortable height and grows with the text rather than trapping a long
 * description in a four-row window that scrolls what was typed out of sight.
 */
function DescriptionField({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(() => value.trim().length > 0)
  const [openedHere, setOpenedHere] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setOpenedHere(true)
        }}
        className="flex w-full items-center gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left text-body text-ink-muted shadow-soft transition-colors duration-[--nimpass-duration-fast] hover:border-line-strong hover:text-ink"
      >
        <AlignLeft className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
        Add description
        <span className="ml-auto shrink-0 text-micro text-ink-subtle">Optional</span>
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
      <Field label="Description" optional hint="What someone gets, and how the sessions run.">
        {(props) => (
          <Textarea
            {...props}
            tone="bare"
            autoGrow
            autoFocus={openedHere}
            placeholder="What the sessions cover, how long they run, anything a customer should know before buying."
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={5}
            className="min-h-[8.5rem] leading-relaxed"
          />
        )}
      </Field>
    </div>
  )
}

/** Placeholder rows while the form's own data loads. */
function FormSkeleton({ rows }: { rows: number }) {
  return (
    <Card className="space-y-6 p-6">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      ))}
    </Card>
  )
}

/**
 * Publishing a pass.
 *
 * There is no payout step in front of this any more. The wallet that signed in
 * is the wallet that gets paid, adopted by the backend the moment the provider
 * record is created (`docs/DECISIONS.md` ADR-025), so by the time anyone can
 * press Publish the 409 this screen used to pre-empt cannot be the answer.
 * Whatever else a 409 can mean is still reported in the backend's own words
 * rather than guessed at here.
 */
function PublishBlock({
  publish,
  passId,
  status,
}: {
  publish: ReturnType<typeof usePublishPass>
  passId: string
  status: PassStatus
}) {
  // A Pass that was taken off the listing is not being published for the first
  // time, and saying "Ready to sell this?" to someone who already sold it reads
  // as though the product forgot. Same endpoint, same button, honest wording.
  const returning = status === 'UNAVAILABLE'

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface-muted/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-body-lg font-medium text-ink">
            {returning ? 'This Pass is not listed' : 'Ready to sell this?'}
          </h2>
          <p className="text-small text-ink-muted">
            {returning
              ? 'Publish it again to put it back in Discover. Nothing anyone bought has changed.'
              : 'Publishing puts it in Discover, where anyone can buy it.'}
          </p>
        </div>
        <Button type="button" loading={publish.isPending} onClick={() => publish.mutate(passId)}>
          <Globe aria-hidden="true" />
          {returning ? 'Publish again' : 'Publish Pass'}
        </Button>
      </div>

      {publish.isError ? (
        <Alert tone="danger" icon={<AlertCircle />} title="Couldn't publish this yet">
          {messageForApiError(publish.error)}
        </Alert>
      ) : null}

      {publish.isSuccess ? (
        <Alert tone="success" icon={<Globe />} title="Published">
          It's in Discover now. Share your pass link and people can buy it.
        </Alert>
      ) : null}
    </section>
  )
}
