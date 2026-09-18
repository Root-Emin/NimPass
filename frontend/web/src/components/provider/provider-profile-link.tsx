import { Link } from 'react-router-dom'

import { ProviderAvatar } from '@/components/provider/provider-avatar'
import { providerPath } from '@/lib/provider-url'
import { cn } from '@/lib/utils'
import type { PublicProvider } from '@/types/domain'

/**
 * The public provider, as a person.
 *
 * Every pass names who sells it. That name is the provider profile — the same
 * identicon, the same display name — on Discover, on the pass page, and on the
 * storefront. A colour mark of initials would be a second identity.
 */
export function ProviderProfileLink({
  provider,
  caption = 'Provided by',
  className,
}: {
  provider: Pick<PublicProvider, 'id' | 'name' | 'slug' | 'wallet' | 'avatarUrl' | 'headline' | 'avatarVariant'>
  caption?: string | null
  className?: string
}) {
  return (
    <Link
      to={providerPath(provider)}
      /*
        `max-w-full` is load-bearing: an inline-flex box is sized by its
        max-content, and `min-w-0` on it does nothing because it is not itself a
        shrinking flex or grid item. A provider with a long headline therefore
        made this link wider than the phone and scrolled the whole pass page
        sideways — the truncation inside could never engage, because there was
        no constraint for it to truncate against.
      */
      className={cn('inline-flex min-w-0 max-w-full items-center gap-3 rounded-md', className)}
    >
      <ProviderAvatar
        wallet={provider.wallet}
        avatarUrl={provider.avatarUrl}
        variant={provider.avatarVariant}
        name={provider.name}
        size={40}
      />
      <span className="min-w-0 text-body">
        {caption ? <span className="block text-micro text-ink-subtle">{caption}</span> : null}
        <span className="block truncate font-medium text-ink">{provider.name}</span>
        {provider.headline.trim() ? (
          <span className="mt-0.5 block truncate text-small text-ink-muted">{provider.headline}</span>
        ) : null}
      </span>
    </Link>
  )
}
