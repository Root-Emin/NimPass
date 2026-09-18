import { Mark } from '@/components/ui/mark'
import { Identicon } from '@/components/wallet/identicon'
import { cn } from '@/lib/utils'

/**
 * The face a provider wears in public: the official Nimiq identicon of the
 * wallet that owns the profile, with an uploaded photograph on top when they
 * have set one.
 *
 * This is the same identicon the header and Profile page show for that wallet,
 * so a pass's "Provided by" row is the person, not a colour chip of initials.
 * The address itself is never printed — docs/03-DESIGN-SYSTEM.md §92.
 *
 * `variant` is the face the provider picked from Nimiq's set, stored on their
 * profile and therefore the same for every visitor. 0 — the default for every
 * provider who has not chosen — is the wallet's own identicon.
 *
 * A colour mark is only the fallback when the public payload has no wallet
 * yet (an older API). It is not a second identity.
 */
export function ProviderAvatar({
  name,
  wallet,
  avatarUrl,
  variant = 0,
  size = 40,
  className,
}: {
  name: string
  wallet: string
  avatarUrl?: string
  variant?: number
  size?: number
  className?: string
}) {
  const photo = avatarUrl?.trim() ?? ''
  const address = wallet.trim()

  return (
    <span
      className={cn('relative inline-flex shrink-0 overflow-hidden rounded-full', className)}
      style={{ width: size, height: size }}
    >
      {address ? (
        <Identicon address={address} variant={variant} size={size} className="size-full" />
      ) : (
        <Mark seed={name} name={name} size="md" round className="size-full text-[0.65em]" />
      )}
      {photo ? (
        <img
          src={photo}
          alt=""
          width={size}
          height={size}
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
        />
      ) : null}
    </span>
  )
}
