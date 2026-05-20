'use client';

import { memo, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Mail, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Email, Identity } from '@/lib/jmap/types';
import { parseSubAddress } from '@/lib/sub-addressing';
import { useSettingsStore } from '@/stores/settings-store';

interface EmailIdentityBadgeProps {
  email: Email;
  identities: Identity[];
  compact?: boolean;
  className?: string;
}

function EmailIdentityBadgeImpl({
  email,
  identities,
  compact = false,
  className,
}: EmailIdentityBadgeProps) {
  const t = useTranslations('identities.badge');
  const subAddressDelimiter = useSettingsStore((state) => state.subAddressDelimiter);

  // O(1) email→identity lookup map. Was: 2 identities.find walks per row
  // (once for the from-address, once for each TO recipient sub-address
  // match). Built once per identities change, looked up multiple times.
  const identitiesByEmail = useMemo(() => {
    const m = new Map<string, Identity>();
    for (const id of identities) m.set(id.email, id);
    return m;
  }, [identities]);

  const fromAddress = email.from?.[0]?.email;
  if (!fromAddress) return null;

  // Parse the from address to check for sub-addressing
  const parsedFrom = parseSubAddress(fromAddress, subAddressDelimiter);

  // Find matching identity (email sent BY the user)
  const matchingIdentity =
    identitiesByEmail.get(fromAddress) ??
    identitiesByEmail.get(`${parsedFrom.baseUser}@${parsedFrom.domain}`);

  // Check if email was sent TO a sub-address (received email)
  let receivedToTag: string | null = null;
  if (!matchingIdentity && email.to) {
    // Skip the `|| []` literal allocation; guard at the if.
    for (const recipient of email.to) {
      const parsedTo = parseSubAddress(recipient.email, subAddressDelimiter);
      if (parsedTo.tag) {
        // Check if this base email matches any of the user's identities
        const matchingToIdentity = identitiesByEmail.get(`${parsedTo.baseUser}@${parsedTo.domain}`);
        if (matchingToIdentity) {
          receivedToTag = parsedTo.tag;
          break;
        }
      }
    }
  }

  // Determine which tag to display (sent or received)
  const displayTag = matchingIdentity ? parsedFrom.tag : receivedToTag;

  // Don't show badge if not from user's identity and not to user's sub-address
  if (!matchingIdentity && !receivedToTag) return null;

  if (compact) {
    // Compact view for email list
    if (displayTag) {
      return (
        <div
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs',
            'bg-primary/10 text-primary',
            className
          )}
          title={t('sub_address_tag', { tag: displayTag })}
        >
          <Tag className="w-3 h-3" />
          <span className="font-mono">{subAddressDelimiter}{displayTag}</span>
        </div>
      );
    }

    if (
      matchingIdentity &&
      matchingIdentity.name &&
      matchingIdentity.name !== matchingIdentity.email &&
      matchingIdentity.name !== fromAddress
    ) {
      return (
        <div
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs',
            'bg-secondary text-muted-foreground',
            className
          )}
          title={t('identity_name', { name: matchingIdentity.name })}
        >
          <Mail className="w-3 h-3" />
          <span className="truncate max-w-[100px]">{matchingIdentity.name}</span>
        </div>
      );
    }

    return null;
  }

  // Full view for email viewer - now shows compact badges only
  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      {/* Sub-address tag badge */}
      {displayTag && (
        <div
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-md',
            'bg-primary/10 text-primary border border-primary/20',
            'text-xs font-semibold'
          )}
          title={t('sub_address_tag', { tag: displayTag })}
          aria-label={t('sub_address_tag', { tag: displayTag })}
        >
          <Tag className="w-3 h-3" />
          <span className="font-mono">{subAddressDelimiter}{displayTag}</span>
        </div>
      )}

      {/* Identity badge (only if identity has a name and no sub-address tag) */}
      {!displayTag &&
        matchingIdentity &&
        matchingIdentity.name &&
        matchingIdentity.name !== matchingIdentity.email &&
        matchingIdentity.name !== fromAddress && (
          <div
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-md',
              'bg-secondary text-muted-foreground border border-border',
              'text-xs font-medium'
            )}
            title={t('identity_name', { name: matchingIdentity.name })}
            aria-label={t('identity_name', { name: matchingIdentity.name })}
          >
            <Mail className="w-3 h-3" />
            <span>{t('identity_short', { name: matchingIdentity.name })}</span>
          </div>
        )}
    </div>
  );
}

// Rendered per visible email row in the list and on every email viewer.
// memo prevents re-render churn when the parent re-renders for unrelated
// state (selection, hover, scroll). Props (email, identities) are stable
// across most parent re-renders.
export const EmailIdentityBadge = memo(EmailIdentityBadgeImpl);
