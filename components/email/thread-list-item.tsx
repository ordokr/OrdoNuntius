"use client";

import React, { useCallback } from "react";
import { formatDate, stripInvisibleLeading } from "@/lib/utils";
import { Email, ThreadGroup } from "@/lib/jmap/types";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Paperclip, Star, ChevronRight, ChevronDown, Loader2, MessageSquare, CheckSquare, Square, Reply, Forward } from "lucide-react";
import { useSettingsStore, KEYWORD_PALETTE, type KeywordDefinition } from "@/stores/settings-store";
import { useUIStore } from "@/stores/ui-store";
import { useEmailStore } from "@/stores/email-store";
import { useAccountStore } from "@/stores/account-store";
import { getThreadColorTag, getEmailColorTags } from "@/lib/thread-utils";
import { useEmailDrag } from "@/hooks/use-email-drag";
import { useLongPress } from "@/hooks/use-long-press";
import { ThreadEmailItem } from "./thread-email-item";
import { EmailHoverActions } from "./email-hover-actions";
import { useTranslations } from "next-intl";

interface ThreadListItemProps {
  thread: ThreadGroup;
  isExpanded: boolean;
  selectedEmailId?: string;
  isLoading?: boolean;
  expandedEmails?: Email[];
  // Pre-computed by EmailList so each visible row avoids O(M+K) scans
  // (mailboxes.find + emailKeywords.find) on every render. Optional so
  // standalone consumers (tests, storybook) still work; falls back to
  // local computation when absent.
  currentMailboxRole?: string;
  emailKeywordsById?: Map<string, KeywordDefinition>;
  onToggleExpand: (threadId: string) => void;
  onEmailSelect: (email: Email) => void;
  onContextMenu?: (e: React.MouseEvent, email: Email) => void;
  onOpenConversation?: (thread: ThreadGroup) => void;
  onToggleStar?: (email: Email) => void;
  onMarkAsRead?: (email: Email, read: boolean) => void;
  onDelete?: (email: Email) => void;
  onArchive?: (email: Email) => void;
  onSetColorTag?: (emailId: string, color: string | null) => void;
  onMarkAsSpam?: (email: Email) => void;
}

interface SingleEmailItemProps {
  email: Email;
  selected: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent, email: Email) => void;
  showPreview: boolean;
  colorTag: string | null;
  currentMailboxRole?: string;
  emailKeywordsById?: Map<string, KeywordDefinition>;
  onToggleStar?: () => void;
  onMarkAsRead?: (read: boolean) => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onSetColorTag?: (color: string | null) => void;
  onMarkAsSpam?: () => void;
}

const SingleEmailItemImpl = React.forwardRef<HTMLDivElement, SingleEmailItemProps>(
  function SingleEmailItem({ email, selected, onClick, onContextMenu, showPreview, colorTag, currentMailboxRole: currentMailboxRoleProp, emailKeywordsById, onToggleStar, onMarkAsRead, onDelete, onArchive, onSetColorTag, onMarkAsSpam }, ref) {
    const t = useTranslations('threads');
    const isUnread = !email.keywords?.$seen;
    const isStarred = email.keywords?.$flagged;
    const isAnswered = email.keywords?.$answered;
    const isForwarded = email.keywords?.$forwarded;
    // Granular selectors instead of `useEmailStore()` whole-store subscription.
    // Each subscription returns a primitive (boolean / string / number), so
    // Zustand's default ref-equality check correctly skips re-renders when
    // THIS email's selectedness / mailbox didn't change — defeating the
    // store-mutation avalanche that bypassed React.memo.
    // Actions are pulled inline via getState() in handlers (stable refs).
    const isChecked = useEmailStore(s => s.selectedEmailIds.has(email.id));
    const hasSelection = useEmailStore(s => s.selectedEmailIds.size > 0);
    const selectedMailbox = useEmailStore(s => s.selectedMailbox);
    // Mailboxes is only consulted as a fallback for the role prop; cheap.
    const mailboxes = useEmailStore(s => s.mailboxes);
    // Prefer the hoisted prop (computed once in EmailList for the whole virtual
    // list); fall back to a local scan only if a caller didn't pass it through.
    const currentMailboxRole = currentMailboxRoleProp ?? mailboxes.find(mb => mb.id === selectedMailbox)?.role;
    const showRecipient = currentMailboxRole === 'sent' || currentMailboxRole === 'drafts';
    const sender = showRecipient ? (email.to?.[0] ?? email.from?.[0]) : email.from?.[0];
    const density = useSettingsStore((state) => state.density);
    const mailLayout = useSettingsStore((state) => state.mailLayout);
    const showAvatarsInJunk = useSettingsStore((state) => state.showAvatarsInJunk);
    const hideJunkAvatarImages = currentMailboxRole === 'junk' && !showAvatarsInJunk;
    const isUnifiedView = useEmailStore((state) => state.isUnifiedView);
    const getAccountById = useAccountStore((state) => state.getAccountById);
    const accountColor = email.accountId ? getAccountById(email.accountId)?.avatarColor : undefined;
    // isChecked already computed above via selector — drop the duplicate.
    const isFocusedMailLayout = mailLayout === 'focus';
    const trimmedPreview = stripInvisibleLeading(email.preview ?? '');
    const inlinePreview = showPreview && trimmedPreview ? ` ${trimmedPreview}` : '';

    // Resolve color tags via the hoisted Map (built once per render of
    // EmailList for the whole list). Standalone consumers that don't
    // thread the prop through get a gray fallback — acceptable trade-off
    // for skipping the per-row settings-store subscription.
    const tagIds = getEmailColorTags(email.keywords);
    const resolvedKeywordDefs = tagIds.map(id =>
      emailKeywordsById?.get(id)
        ?? { id, label: id, color: 'gray' }
    );
    const resolvedKeywordDef = resolvedKeywordDefs[0] ?? null;
    const resolvedColorTag = colorTag
      ?? (resolvedKeywordDef ? KEYWORD_PALETTE[resolvedKeywordDef.color]?.bg ?? null : null);

    const { dragHandlers, isDragging } = useEmailDrag({
      email,
      sourceMailboxId: selectedMailbox,
    });

    const isMobile = useUIStore((state) => state.isMobile);

    const { onTouchStart, onTouchEnd, onTouchMove, onTouchCancel, isPressed } = useLongPress(
      useCallback((pos) => {
        onContextMenu?.(
          { preventDefault: () => {}, stopPropagation: () => {}, clientX: pos.clientX, clientY: pos.clientY } as React.MouseEvent,
          email
        );
      }, [onContextMenu, email]),
      isMobile
    );
    const longPressHandlers = { onTouchStart, onTouchEnd, onTouchMove, onTouchCancel };

    const handleCheckboxClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      useEmailStore.getState().toggleEmailSelection(email.id);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
      onContextMenu?.(e, email);
    };

    const handleClick = (e: React.MouseEvent) => {
      const store = useEmailStore.getState();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        store.toggleEmailSelection(email.id);
      } else if (e.shiftKey) {
        e.preventDefault();
        store.selectRangeEmails(email.id);
      } else {
        if (hasSelection) store.clearSelection();
        onClick();
      }
    };

    return (
      <div
        ref={ref}
        {...dragHandlers}
        {...longPressHandlers}
        className={cn(
          "relative group cursor-pointer select-none transition-shadow duration-200 border-b border-border overflow-hidden",
          resolvedColorTag ? resolvedColorTag : (
            selected
              ? "bg-accent"
              : "bg-background"
          ),
          selected && !resolvedColorTag && "shadow-sm",
          !resolvedColorTag && !selected && !isChecked && "hover:bg-muted hover:shadow-sm",
          !resolvedColorTag && (selected || isChecked) && "hover:bg-accent hover:shadow-sm",
          resolvedColorTag && "hover:brightness-95 dark:hover:brightness-110",
          // Unread state is signalled by the left-edge wax stripe + bolder
          // font weight, not a row-wash. Scholarly inkwell brand.
          isChecked && "ring-2 ring-primary/20 bg-accent/40",
          isDragging && "opacity-50 scale-[0.98] ring-2 ring-primary/30",
          isPressed && "bg-muted scale-[0.98] ring-2 ring-primary/30"
        )}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{ minHeight: isFocusedMailLayout ? undefined : 'var(--list-item-height)' }}
      >
        <div
          className={cn('px-3', isFocusedMailLayout ? 'flex items-center' : 'flex items-start')}
          style={{ gap: 'var(--density-item-gap)', paddingBlock: 'var(--density-item-py)' }}
        >
          {/* Checkbox - only visible when in selection mode */}
          {hasSelection && (
            <button
              onClick={handleCheckboxClick}
              className={cn(
                "p-3 lg:p-1 rounded flex-shrink-0 transition-all duration-200",
                !isFocusedMailLayout && 'mt-2',
                "hover:bg-muted/50 hover:scale-110",
                "active:scale-95",
                "animate-in fade-in zoom-in-95 duration-150",
                isChecked && "text-primary"
              )}
            >
              {isChecked ? (
                <CheckSquare className="w-4 h-4 animate-in zoom-in-50 duration-200" />
              ) : (
                <Square className="w-4 h-4 text-muted-foreground opacity-60 hover:opacity-100 transition-opacity" />
              )}
            </button>
          )}

          {/* Wax-seal unread stripe on the leading edge. */}
          {isUnread && (
            <div
              aria-hidden="true"
              className="absolute left-0 top-0 bottom-0 w-[3px] bg-unread"
            />
          )}

          {density !== 'extra-compact' && (
            <Avatar
              name={sender?.name}
              email={sender?.email}
              size={isFocusedMailLayout ? "sm" : "md"}
              className="flex-shrink-0 shadow-sm"
              disableImages={hideJunkAvatarImages}
            />
          )}

          <div className="flex-1 min-w-0">
            {isFocusedMailLayout ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {isUnifiedView && email.accountId && accountColor && (
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: accountColor }}
                      title={email.accountLabel}
                    />
                  )}
                  <span className={cn(
                    'w-32 shrink-0 truncate text-sm lg:w-40',
                    isUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'
                  )}>
                    {sender?.name || sender?.email || 'Unknown'}
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <span className={cn(
                      'shrink-0 truncate',
                      isUnread ? 'font-semibold text-foreground' : 'text-foreground/90'
                    )}>
                      {email.subject || '(no subject)'}
                    </span>
                    {inlinePreview && (
                      <span className="min-w-0 truncate text-muted-foreground">{inlinePreview}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  {isStarred && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />}
                  {isAnswered && !isForwarded && <Reply className="w-3.5 h-3.5 text-muted-foreground" />}
                  {isForwarded && !isAnswered && <Forward className="w-3.5 h-3.5 text-muted-foreground" />}
                  {isAnswered && isForwarded && (
                    <>
                      <Reply className="w-3.5 h-3.5 text-muted-foreground" />
                      <Forward className="w-3.5 h-3.5 text-muted-foreground" />
                    </>
                  )}
                  {email.hasAttachment && <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />}
                  {resolvedKeywordDefs.map((kd) => (
                    <span key={kd.id} className={cn('h-2.5 w-2.5 rounded-full', KEYWORD_PALETTE[kd.color]?.dot || 'bg-gray-400')} />
                  ))}
                  <span className={cn(
                    'text-xs tabular-nums',
                    isUnread ? 'text-foreground font-semibold' : 'text-muted-foreground'
                  )}>
                    {formatDate(email.receivedAt)}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isUnifiedView && email.accountId && accountColor && (
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: accountColor }}
                        title={email.accountLabel}
                      />
                    )}
                    <span className={cn(
                      "truncate text-sm",
                      isUnread
                        ? "font-bold text-foreground"
                        : "font-medium text-muted-foreground"
                    )}>
                      {sender?.name || sender?.email || t('unknown_sender')}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isStarred && (
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      )}
                      {isAnswered && !isForwarded && (
                        <Reply className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                      {isForwarded && !isAnswered && (
                        <Forward className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                      {isAnswered && isForwarded && (
                        <>
                          <Reply className="w-3.5 h-3.5 text-muted-foreground" />
                          <Forward className="w-3.5 h-3.5 text-muted-foreground" />
                        </>
                      )}
                      {email.hasAttachment && (
                        <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {resolvedKeywordDefs.map((kd) => (
                      <span key={kd.id} className={cn(
                        "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full",
                        KEYWORD_PALETTE[kd.color]?.bg || "bg-muted"
                      )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", KEYWORD_PALETTE[kd.color]?.dot || "bg-gray-400")} />
                        {kd.label}
                      </span>
                    ))}
                    <span className={cn(
                      "text-xs tabular-nums",
                      isUnread
                        ? "text-foreground font-semibold"
                        : "text-muted-foreground"
                    )}>
                      {formatDate(email.receivedAt)}
                    </span>
                  </div>
                </div>

                <div className={cn(
                  "mb-1 line-clamp-1 text-sm",
                  isUnread
                    ? "font-semibold text-foreground"
                    : "font-normal text-foreground/90"
                )}>
                  {email.subject || t('no_subject')}
                </div>

                {showPreview && density !== 'extra-compact' && density !== 'compact' && (
                  <p className={cn(
                    "text-sm leading-relaxed line-clamp-2",
                    isUnread
                      ? "text-muted-foreground"
                      : "text-muted-foreground/80"
                  )}>
                    {trimmedPreview || t('no_preview')}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Hover Quick Actions */}
        <EmailHoverActions
          email={email}
          backgroundClassName={resolvedColorTag ? resolvedColorTag : ((selected || isChecked) ? "bg-accent" : "bg-muted")}
          onToggleStar={onToggleStar}
          onMarkAsRead={onMarkAsRead}
          onDelete={onDelete}
          onArchive={onArchive}
          onSetColorTag={onSetColorTag}
          onMarkAsSpam={onMarkAsSpam}
        />
      </div>
    );
  }
);

// Memoized so single-email threads also benefit when ThreadListItem's
// outer re-render decisions don't change the SingleEmailItem props.
const SingleEmailItem = React.memo(SingleEmailItemImpl);

// React.memo wraps the forwardRef'd component so that non-emails parent
// re-renders (theme toggle, selection change, scroll) skip all visible
// rows when their props haven't changed. The default shallow compare is
// sufficient because:
//   - thread is a memoized ThreadGroup from useMemo(groupEmailsByThread)
//   - emailKeywordsById is memoized in EmailList
//   - currentMailboxRole is a primitive
//   - all callbacks are useCallback-stabilized in EmailList
// Without this, every row re-rendered on every parent state change,
// even though its inputs were identical.
const ThreadListItemImpl = React.forwardRef<HTMLDivElement, ThreadListItemProps>(
  function ThreadListItem({
    thread,
    isExpanded,
    selectedEmailId,
    isLoading = false,
    expandedEmails,
    currentMailboxRole: currentMailboxRoleProp,
    emailKeywordsById,
    onToggleExpand,
    onEmailSelect,
    onContextMenu,
    onOpenConversation,
    onToggleStar,
    onMarkAsRead,
    onDelete,
    onArchive,
    onSetColorTag,
    onMarkAsSpam,
  }, ref) {
    const t = useTranslations('threads');
    const showPreview = useSettingsStore((state) => state.showPreview);
    const density = useSettingsStore((state) => state.density);
    const mailLayout = useSettingsStore((state) => state.mailLayout);
    const showAvatarsInJunk = useSettingsStore((state) => state.showAvatarsInJunk);
    const isMobile = useUIStore((state) => state.isMobile);
    const { latestEmail, participantNames, hasUnread, hasStarred, hasAttachment, hasAnswered, hasForwarded, emailCount } = thread;
    const isFocusedMailLayout = mailLayout === 'focus';
    const trimmedPreview = stripInvisibleLeading(latestEmail.preview ?? '');
    const inlinePreview = showPreview && trimmedPreview ? ` ${trimmedPreview}` : '';

    // Same granular-selector pattern as SingleEmailItem above. Whole-store
    // subscription was bypassing the outer React.memo because every store
    // mutation re-rendered the row regardless of whether its inputs changed.
    const isChecked = useEmailStore(s => thread.emails.some(e => s.selectedEmailIds.has(e.id)));
    const hasSelection = useEmailStore(s => s.selectedEmailIds.size > 0);
    const selectedMailbox = useEmailStore(s => s.selectedMailbox);
    const mailboxes = useEmailStore(s => s.mailboxes);
    const isUnifiedView = useEmailStore(s => s.isUnifiedView);
    const getAccountById = useAccountStore((state) => state.getAccountById);
    const threadAccountColor = latestEmail.accountId ? getAccountById(latestEmail.accountId)?.avatarColor : undefined;
    // Prefer the hoisted prop; fall back to a scan only if a caller didn't
    // thread it through (back-compat for standalone consumers).
    const currentMailboxRole = currentMailboxRoleProp ?? mailboxes.find(mb => mb.id === selectedMailbox)?.role;
    const showRecipient = currentMailboxRole === 'sent' || currentMailboxRole === 'drafts';
    const displayNames = showRecipient
      ? Array.from(new Set(
          thread.emails.flatMap(e => (e.to ?? []).map(r => r.name || r.email.split('@')[0]))
        )).slice(0, 4)
      : participantNames;
    const avatarPerson = showRecipient ? latestEmail.to?.[0] : latestEmail.from?.[0];
    const hideJunkAvatarImages = currentMailboxRole === 'junk' && !showAvatarsInJunk;

    const { dragHandlers, isDragging: isThreadDragging } = useEmailDrag({
      email: latestEmail,
      sourceMailboxId: selectedMailbox,
      threadEmails: thread.emails,
    });

    const { onTouchStart: threadOnTouchStart, onTouchEnd: threadOnTouchEnd, onTouchMove: threadOnTouchMove, onTouchCancel: threadOnTouchCancel, isPressed: isThreadPressed } = useLongPress(
      useCallback((pos) => {
        onContextMenu?.(
          { preventDefault: () => {}, stopPropagation: () => {}, clientX: pos.clientX, clientY: pos.clientY } as React.MouseEvent,
          latestEmail
        );
      }, [onContextMenu, latestEmail]),
      isMobile
    );
    const threadLongPressHandlers = { onTouchStart: threadOnTouchStart, onTouchEnd: threadOnTouchEnd, onTouchMove: threadOnTouchMove, onTouchCancel: threadOnTouchCancel };

    const threadColor = getThreadColorTag(thread.emails);
    // emailKeywordsById prop replaces the per-row settings-store subscription
    // for keyword resolution.
    const keywordDef = threadColor
      ? (emailKeywordsById?.get(threadColor)
          ?? { id: threadColor, label: threadColor, color: 'gray' })
      : null;
    const colorTag = keywordDef ? KEYWORD_PALETTE[keywordDef.color]?.bg ?? null : null;

    const isSelected = selectedEmailId === latestEmail.id ||
      thread.emails.some(e => e.id === selectedEmailId);

    // isChecked already computed above via selector — drop the duplicate.

    if (emailCount === 1) {
      return (
        <SingleEmailItem
          ref={ref}
          email={latestEmail}
          selected={selectedEmailId === latestEmail.id}
          onClick={() => onEmailSelect(latestEmail)}
          onContextMenu={onContextMenu}
          showPreview={showPreview}
          colorTag={colorTag}
          currentMailboxRole={currentMailboxRole}
          emailKeywordsById={emailKeywordsById}
          onToggleStar={onToggleStar ? () => onToggleStar(latestEmail) : undefined}
          onMarkAsRead={onMarkAsRead ? (read) => onMarkAsRead(latestEmail, read) : undefined}
          onDelete={onDelete ? () => onDelete(latestEmail) : undefined}
          onArchive={onArchive ? () => onArchive(latestEmail) : undefined}
          onSetColorTag={onSetColorTag ? (color) => onSetColorTag(latestEmail.id, color) : undefined}
          onMarkAsSpam={onMarkAsSpam ? () => onMarkAsSpam(latestEmail) : undefined}
        />
      );
    }

    const emailsToShow = expandedEmails || thread.emails;

    const handleThreadCheckboxClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      // Toggle selection for all emails in this thread. Read live snapshot
      // via getState() so the handler doesn't need to subscribe to
      // selectedEmailIds (subscription would trigger re-render on every
      // selection change anywhere in the app).
      const currentIds = useEmailStore.getState().selectedEmailIds;
      const allSelected = thread.emails.every(em => currentIds.has(em.id));
      const newSelection = new Set(currentIds);
      thread.emails.forEach(em => {
        if (allSelected) {
          newSelection.delete(em.id);
        } else {
          newSelection.add(em.id);
        }
      });
      useEmailStore.setState({ selectedEmailIds: newSelection, lastSelectedEmailId: latestEmail.id });
    };

    const handleHeaderClick = (e: React.MouseEvent) => {
      const store = useEmailStore.getState();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Ctrl+Click: toggle selection for all thread emails
        thread.emails.forEach(em => store.toggleEmailSelection(em.id));
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        store.selectRangeEmails(latestEmail.id);
        return;
      }

      if (isMobile && onOpenConversation) {
        onOpenConversation(thread);
        return;
      }

      const target = e.target as HTMLElement;
      if (target.closest('[data-expand-toggle]')) {
        onToggleExpand(thread.threadId);
      } else {
        if (hasSelection) store.clearSelection();
        if (!isExpanded) {
          onToggleExpand(thread.threadId);
        }
        onEmailSelect(latestEmail);
      }
    };

    const handleContextMenu = (e: React.MouseEvent) => {
      onContextMenu?.(e, latestEmail);
    };

    return (
      <div ref={ref} className={cn("border-b border-border", isThreadDragging && "opacity-50 scale-[0.98] ring-2 ring-primary/30")}>
        <div
          {...dragHandlers}
          {...threadLongPressHandlers}
          className={cn(
            "relative group cursor-pointer select-none transition-shadow duration-200 overflow-hidden",
            colorTag ? colorTag : (
              isSelected
                ? "bg-accent"
                : "bg-background"
            ),
            isSelected && !colorTag && "shadow-sm",
            !colorTag && !isSelected && !isChecked && "hover:bg-muted hover:shadow-sm",
            !colorTag && (isSelected || isChecked) && "hover:bg-accent hover:shadow-sm",
            colorTag && "hover:brightness-95 dark:hover:brightness-110",
            hasUnread && !colorTag && !isSelected && "bg-accent/30",
            isExpanded && "border-b border-border/50",
            isChecked && "ring-2 ring-primary/20 bg-accent/40",
            isThreadPressed && "bg-muted scale-[0.98] ring-2 ring-primary/30"
          )}
          onClick={handleHeaderClick}
          onContextMenu={handleContextMenu}
          style={{ minHeight: isFocusedMailLayout ? undefined : 'var(--list-item-height)' }}
        >
          <div
            className={cn('px-3', isFocusedMailLayout ? 'flex items-center' : 'flex items-start')}
            style={{ gap: 'var(--density-item-gap)', paddingBlock: 'var(--density-item-py)' }}
          >
            {/* Checkbox for thread selection - only visible when in selection mode */}
            {hasSelection && (
              <button
                onClick={handleThreadCheckboxClick}
                className={cn(
                  "p-3 lg:p-1 rounded flex-shrink-0 transition-all duration-200",
                  !isFocusedMailLayout && 'mt-2',
                  "hover:bg-muted/50 hover:scale-110",
                  "active:scale-95",
                  "animate-in fade-in zoom-in-95 duration-150",
                  isChecked && "text-primary"
                )}
              >
                {isChecked ? (
                  <CheckSquare className="w-4 h-4 animate-in zoom-in-50 duration-200" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground opacity-60 hover:opacity-100 transition-opacity" />
                )}
              </button>
            )}

            {!isMobile && !isFocusedMailLayout && (
              <button
                data-expand-toggle
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand(thread.threadId);
                }}
                className={cn(
                  "p-1 rounded mt-2 flex-shrink-0 transition-all duration-200",
                  "hover:bg-muted/50 hover:scale-110",
                  "active:scale-95",
                  "text-muted-foreground hover:text-foreground"
                )}
                aria-expanded={isExpanded}
                aria-label={t('toggle_thread')}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
            )}

            {/* Thread-level wax-seal stripe — any unread message in the thread
                marks the whole row. */}
            {hasUnread && (
              <div
                aria-hidden="true"
                className="absolute left-0 top-0 bottom-0 w-[3px] bg-unread"
              />
            )}

            {density !== 'extra-compact' && (
              <Avatar
                name={avatarPerson?.name}
                email={avatarPerson?.email}
                size={isFocusedMailLayout ? "sm" : "md"}
                className="flex-shrink-0 shadow-sm"
                disableImages={hideJunkAvatarImages}
              />
            )}

            <div className="flex-1 min-w-0">
              {isFocusedMailLayout ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {isUnifiedView && latestEmail.accountId && threadAccountColor && (
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: threadAccountColor }}
                        title={latestEmail.accountLabel}
                      />
                    )}
                    <span className={cn(
                      'w-32 shrink-0 truncate text-sm lg:w-44',
                      hasUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'
                    )}>
                      {displayNames.join(', ')}
                    </span>
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
                        hasUnread ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      )}
                      title={t('messages_tooltip', { count: emailCount })}
                    >
                      <MessageSquare className="w-3 h-3" />
                      {emailCount}
                    </span>
                    <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <span className={cn(
                        'shrink-0 truncate',
                        hasUnread ? 'font-semibold text-foreground' : 'text-foreground/90'
                      )}>
                        {latestEmail.subject || '(no subject)'}
                      </span>
                      {inlinePreview && (
                        <span className="min-w-0 truncate text-muted-foreground">{inlinePreview}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    {hasStarred && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />}
                    {hasAnswered && !hasForwarded && <Reply className="w-3.5 h-3.5 text-muted-foreground" />}
                    {hasForwarded && !hasAnswered && <Forward className="w-3.5 h-3.5 text-muted-foreground" />}
                    {hasAnswered && hasForwarded && (
                      <>
                        <Reply className="w-3.5 h-3.5 text-muted-foreground" />
                        <Forward className="w-3.5 h-3.5 text-muted-foreground" />
                      </>
                    )}
                    {hasAttachment && <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />}
                    {keywordDef && (
                      <span className={cn('h-2.5 w-2.5 rounded-full', KEYWORD_PALETTE[keywordDef.color]?.dot || 'bg-gray-400')} />
                    )}
                    <span className={cn(
                      'text-xs tabular-nums',
                      hasUnread ? 'text-foreground font-semibold' : 'text-muted-foreground'
                    )}>
                      {formatDate(latestEmail.receivedAt)}
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {isUnifiedView && latestEmail.accountId && threadAccountColor && (
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: threadAccountColor }}
                          title={latestEmail.accountLabel}
                        />
                      )}
                      <span className={cn(
                        "truncate text-sm",
                        hasUnread
                          ? "font-bold text-foreground"
                          : "font-medium text-muted-foreground"
                      )}>
                        {displayNames.join(", ")}
                      </span>
                      <span
                        className={cn(
                          "flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded-full font-medium",
                          hasUnread
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        )}
                        title={t('messages_tooltip', { count: emailCount })}
                      >
                        <MessageSquare className="w-3 h-3" />
                        {emailCount}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {hasStarred && (
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        )}
                        {hasAnswered && !hasForwarded && (
                          <Reply className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                        {hasForwarded && !hasAnswered && (
                          <Forward className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                        {hasAnswered && hasForwarded && (
                          <>
                            <Reply className="w-3.5 h-3.5 text-muted-foreground" />
                            <Forward className="w-3.5 h-3.5 text-muted-foreground" />
                          </>
                        )}
                        {hasAttachment && (
                          <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {keywordDef && (
                        <span className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full",
                          KEYWORD_PALETTE[keywordDef.color]?.bg || "bg-muted"
                        )}>
                          <span className={cn("w-1.5 h-1.5 rounded-full", KEYWORD_PALETTE[keywordDef.color]?.dot || "bg-gray-400")} />
                          {keywordDef.label}
                        </span>
                      )}
                      <span className={cn(
                        "text-xs tabular-nums",
                        hasUnread
                          ? "text-foreground font-semibold"
                          : "text-muted-foreground"
                      )}>
                        {formatDate(latestEmail.receivedAt)}
                      </span>
                    </div>
                  </div>

                  <div className={cn(
                    "mb-1 line-clamp-1 text-sm",
                    hasUnread
                      ? "font-semibold text-foreground"
                      : "font-normal text-foreground/90"
                  )}>
                    {latestEmail.subject || t('no_subject')}
                  </div>

                  {showPreview && density !== 'extra-compact' && density !== 'compact' && (
                    <p className={cn(
                      "text-sm leading-relaxed line-clamp-2",
                      hasUnread
                        ? "text-muted-foreground"
                        : "text-muted-foreground/80"
                    )}>
                      {trimmedPreview || t('no_preview')}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Hover Quick Actions for thread header */}
          <EmailHoverActions
            email={latestEmail}
            backgroundClassName={colorTag ? colorTag : ((isSelected || isChecked) ? "bg-accent" : "bg-muted")}
            onToggleStar={onToggleStar ? () => onToggleStar(latestEmail) : undefined}
            onMarkAsRead={onMarkAsRead ? (read) => onMarkAsRead(latestEmail, read) : undefined}
            onDelete={onDelete ? () => onDelete(latestEmail) : undefined}
            onArchive={onArchive ? () => onArchive(latestEmail) : undefined}
            onSetColorTag={onSetColorTag ? (color) => onSetColorTag(latestEmail.id, color) : undefined}
            onMarkAsSpam={onMarkAsSpam ? () => onMarkAsSpam(latestEmail) : undefined}
          />
        </div>

        {isExpanded && !isMobile && !isFocusedMailLayout && (
          <div className="bg-muted/20 animate-in slide-in-from-top-2 duration-200">
            {isLoading ? (
              <div className="py-4 flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                {t('loading')}
              </div>
            ) : (
              emailsToShow.map((email, index) => (
                <ThreadEmailItem
                  key={email.id}
                  email={email}
                  selected={email.id === selectedEmailId}
                  isLast={index === emailsToShow.length - 1}
                  onSelect={onEmailSelect}
                  onContextMenu={onContextMenu}
                />
              ))
            )}
          </div>
        )}
      </div>
    );
  }
);


export const ThreadListItem = React.memo(ThreadListItemImpl);
