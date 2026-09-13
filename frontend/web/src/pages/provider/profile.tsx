import { useState } from 'react'
import { AlertCircle, BadgeCheck, CheckCircle2, ShieldCheck } from 'lucide-react'

import { messageForApiError } from '@/api'
import { WorkspaceHeader } from '@/components/layout/provider-shell'
import { WorkspaceGate } from '@/components/provider/workspace-gate'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import {
  useMyProviderProfile,
  useUpdateProviderProfile,
  useVerifyPayoutWallet,
} from '@/hooks/use-provider-workspace'
import { useWallet } from '@/hooks/use-wallet'
import { shortenAddress } from '@/lib/format'
import { isPayoutVerified, type Provider } from '@/types/domain'

/**
 * Provider profile and payout wallet.
 *
 * The public profile is one field. `ProviderInput` in `backend/openapi.yaml` is
 * `{ name }` — there is no headline, bio, location or avatar in the contract,
 * so the form that used to collect them is gone rather than collecting data the
 * API would reject and the product could never display.
 *
 * The payout wallet sits here too, because it is the other half of being able
 * to sell — and it is deliberately *not* part of the profile form: a payout
 * address becomes trusted only through a signed verification, never through a
 * field on a form someone with a stolen session could submit
 * (docs/09-SECURITY.md §21-§23, §39).
 */
export function ProviderProfilePage() {
  return (
    <>
      <WorkspaceHeader
        title="Public profile"
        description="Your name as customers see it, and the wallet your sales are paid into."
      />
      <div className="mt-8">
        <WorkspaceGate>
          <ProfileContent />
        </WorkspaceGate>
      </div>
    </>
  )
}

function ProfileContent() {
  const profile = useMyProviderProfile()

  if (profile.isPending) return <FormSkeleton />
  if (profile.isError) {
    return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
  }

  // `listMyProviders` returns an empty list for an identity that owns no
  // provider. `WorkspaceGate` already stops that reaching here, but reading a
  // field off null would be a blank error page rather than a message.
  const record: Provider | null = profile.data
  if (!record) return <FormSkeleton />

  return (
    <div className="space-y-8">
      <NameForm provider={record} />
      <PayoutWalletSection provider={record} />
    </div>
  )
}

function NameForm({ provider }: { provider: Provider }) {
  const save = useUpdateProviderProfile()
  // Seeded from the state initialiser so a later refetch can never overwrite
  // what is being typed.
  const [name, setName] = useState(provider.name)
  const [error, setError] = useState<string | null>(null)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    // A convenience so the provider is not bounced by the server for an obvious
    // mistake — not a security boundary (docs/09-SECURITY.md §75).
    if (!trimmed) return setError('Your provider name is required.')
    if (trimmed.length > 160) return setError('Keep the name under 160 characters.')
    setError(null)
    save.mutate({ name: trimmed })
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card className="space-y-6 p-5 sm:p-6">
        <Field
          label="Provider name"
          error={error}
          hint="What customers see on your packages."
        >
          {(props) => (
            <Input
              {...props}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
              autoComplete="organization"
            />
          )}
        </Field>
      </Card>

      <div className="mt-6 space-y-4">
        {save.isError ? (
          <Alert tone="danger" icon={<AlertCircle />} title="Couldn't save">
            {messageForApiError(save.error)}
          </Alert>
        ) : null}
        {save.isSuccess ? (
          <Alert tone="success" icon={<CheckCircle2 />} title="Profile saved." />
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>
            Save profile
          </Button>
        </div>
      </div>
    </form>
  )
}

/**
 * Payout wallet verification.
 *
 * Two signatures over one backend-issued message: the new payout wallet's,
 * proving control of the destination, and the owner wallet's, proving the
 * request came from the account holder. Both are produced by Nimiq Pay and sent
 * unchanged (docs/09-SECURITY.md §21-§23).
 *
 * Until this succeeds the provider cannot publish anything — a rule the backend
 * enforces on publish, and which this section exists to explain rather than to
 * duplicate.
 */
function PayoutWalletSection({ provider }: { provider: Provider }) {
  const wallet = useWallet()
  const verify = useVerifyPayoutWallet()
  const [address, setAddress] = useState(provider.payoutWallet ?? '')
  const verified = isPayoutVerified(provider)
  const canSign = wallet.capabilities.walletOperationsAvailable

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
        <div className="space-y-1">
          <h2 className="text-h3 text-ink">Payout wallet</h2>
          <p className="text-body text-ink-muted">
            Customers pay you directly in NIM. Nimpass never holds your money.
          </p>
        </div>
      </div>

      {verified ? (
        <Alert tone="success" icon={<BadgeCheck />} title="Verified">
          Paid into {shortenAddress(provider.payoutWallet ?? '')}. You can publish packages.
        </Alert>
      ) : (
        <Alert tone="warning" icon={<AlertCircle />} title="Not verified yet">
          You can create packages now, but publishing one needs a verified payout wallet.
        </Alert>
      )}

      <Field
        label="Nimiq address"
        hint="You'll approve two signatures in Nimiq Pay: one from this wallet, one from the wallet you signed in with."
      >
        {(props) => (
          <Input
            {...props}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="NQ…"
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </Field>

      {verify.isError ? (
        <Alert tone="danger" icon={<AlertCircle />} title="Couldn't verify this wallet">
          {messageForApiError(verify.error)}
        </Alert>
      ) : null}

      {verify.isSuccess ? (
        <Alert tone="success" icon={<CheckCircle2 />} title="Payout wallet verified." />
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {!canSign ? (
          <p className="text-small text-ink-subtle sm:mr-auto">
            Open Nimpass in Nimiq Pay to sign.
          </p>
        ) : null}
        <Button
          disabled={!canSign || !address.trim()}
          loading={verify.isPending}
          onClick={() => verify.mutate({ wallet: address.trim() })}
        >
          {verified ? 'Change payout wallet' : 'Verify payout wallet'}
        </Button>
      </div>
    </Card>
  )
}

function FormSkeleton() {
  return (
    <Card className="space-y-6 p-6">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      ))}
    </Card>
  )
}
