import { useEffect, useState, type FormEvent } from 'react'

import { AvatarPicker } from '@/components/provider/avatar-picker'
import { ProviderAvatar } from '@/components/provider/provider-avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/ui/states'
import { useUpdateProviderProfile } from '@/hooks/use-provider-workspace'
import type { Provider } from '@/types/domain'

/**
 * The name and face customers see as "Provided by".
 *
 * Display name is what every public pass carries. The face is a Nimiq
 * identicon of this wallet — the same family the header and Profile use — so
 * the selling identity and the signed-in identity cannot drift apart. Which of
 * this wallet's identicons it is, is the provider's to choose; the choice is
 * stored on the profile, so every visitor sees the same face whether they are
 * signed in or not.
 *
 * On a phone the copy fields sit above the face grid, so editing the name is
 * not buried under a wall of identicons. From `lg` the same form is two
 * columns: identity on the left, faces on the right.
 */
export function PublicProfileCard({
  provider,
  wallet,
}: {
  provider: Provider
  wallet: string
}) {
  const save = useUpdateProviderProfile()
  const [name, setName] = useState(provider.name)
  const [headline, setHeadline] = useState(provider.headline)
  const [avatarVariant, setAvatarVariant] = useState(provider.avatarVariant)

  useEffect(() => {
    setName(provider.name)
    setHeadline(provider.headline)
    setAvatarVariant(provider.avatarVariant)
  }, [provider.name, provider.headline, provider.avatarVariant])
  const trimmed = name.trim()
  const dirty =
    trimmed !== provider.name ||
    headline.trim() !== provider.headline ||
    avatarVariant !== provider.avatarVariant

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trimmed || save.isPending) return
    save.mutate({
      name: trimmed,
      headline: headline.trim(),
      avatarVariant,
    })
  }

  return (
    <Card variant="plain" className="p-5 sm:p-8">
      <form
        onSubmit={submit}
        className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start lg:gap-10"
      >
        <div className="min-w-0 space-y-5">
          <div className="flex items-center gap-4">
            <ProviderAvatar
              wallet={wallet}
              avatarUrl={provider.avatarUrl}
              variant={avatarVariant}
              name={trimmed || provider.name}
              size={56}
            />
            <div className="min-w-0">
              <p className="truncate text-h3 text-ink">{trimmed || provider.name}</p>
              <p className="mt-1 text-small text-ink-muted">
                This is what customers see as “Provided by” on every pass you publish.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <Field label="Display name" hint="The name on your passes. For example, “Alex Fitness”.">
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={160}
                  autoComplete="organization"
                  required
                />
              )}
            </Field>
            <Field label="Headline" optional hint="The line under your name.">
              {(props) => (
                <Input
                  {...props}
                  value={headline}
                  onChange={(event) => setHeadline(event.target.value)}
                  maxLength={160}
                />
              )}
            </Field>
          </div>
        </div>

        <div className="min-w-0">
          <p id="avatar-picker-label" className="text-small font-medium text-ink">
            Your face
          </p>
          <p className="mt-1 text-small text-ink-muted">
            Nimiq identicons of your wallet. The first one is your wallet’s own.
          </p>
          <AvatarPicker
            wallet={wallet}
            value={avatarVariant}
            onChange={setAvatarVariant}
            labelledBy="avatar-picker-label"
            className="mt-3"
          />
        </div>

        <div className="space-y-4 lg:col-span-2">
          {save.isError ? <ErrorState error={save.error} /> : null}
          <Button
            type="submit"
            className="max-sm:w-full"
            loading={save.isPending}
            disabled={!trimmed || !dirty || save.isPending}
          >
            {save.isSuccess && !dirty ? 'Saved' : 'Save profile'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
