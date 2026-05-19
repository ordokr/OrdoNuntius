"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '@/stores/settings-store';
import type { ArchiveMode, HoverAction } from '@/stores/settings-store';
import { ALL_HOVER_ACTIONS } from '@/stores/settings-store';
import { useAuthStore } from '@/stores/auth-store';
import { useEmailStore } from '@/stores/email-store';
import { cn } from '@/lib/utils';
import { SettingsSection, SettingItem, Select, ToggleSwitch } from './settings-section';
import { AlertTriangle, FolderSync, Loader2 } from 'lucide-react';
import { usePolicyStore } from '@/stores/policy-store';

export function ReadingSettings() {
  const t = useTranslations('settings.email_behavior');
  const [isReorganizing, setIsReorganizing] = useState(false);
  const [reorganizeResult, setReorganizeResult] = useState<string | null>(null);
  const { isSettingLocked, isSettingHidden, isFeatureEnabled } = usePolicyStore();

  const {
    markAsReadDelay,
    deleteAction,
    permanentlyDeleteJunk,
    showPreview,
    mailLayout,
    disableThreading,
    plainTextMode,
    emailsPerPage,
    mailAttachmentAction,
    attachmentPosition,
    archiveMode,
    hoverActions,
    hoverActionsMode,
    hoverActionsCorner,
    hideInlineImageAttachments,
    attachmentImagePreviewsEnabled,
    updateSetting,
  } = useSettingsStore();

  const isFocusedLayout = mailLayout === 'focus';

  const handleReorganizeArchive = async () => {
    const { client } = useAuthStore.getState();
    const { mailboxes, fetchMailboxes } = useEmailStore.getState();
    if (!client) return;

    const archiveMailbox = mailboxes.find(m => m.role === 'archive' || m.name.toLowerCase() === 'archive');
    if (!archiveMailbox) return;

    setIsReorganizing(true);
    setReorganizeResult(null);

    try {
      const archiveId = archiveMailbox.originalId || archiveMailbox.id;
      const emails = await client.getEmailsInMailbox(archiveId);

      // Pass 1: compute each email's target (year or year/month) and
      // collect the unique target paths. Was O(N) sequential moveEmail
      // requests — for a typical archive with thousands of messages,
      // that's thousands of network round-trips. New shape: bucket by
      // target, then issue one batchMoveEmails per bucket (typically
      // 5-30 buckets for a multi-year archive).
      type Target = { year: string; month?: string };
      const targets: Target[] = emails.map((email) => {
        const d = new Date(email.receivedAt);
        const year = d.getFullYear().toString();
        if (archiveMode === 'year') return { year };
        return { year, month: (d.getMonth() + 1).toString().padStart(2, '0') };
      });

      // Pass 2: ensure all year (and month) mailboxes exist. We must
      // serialize creation so we don't race for the same folder twice.
      // createMailbox + fetchMailboxes are bounded by the number of
      // unique year/month combinations (≤ ~120 for 10 years × 12 months).
      const ensureFolder = async (name: string, parentId: string) => {
        const existing = useEmailStore.getState().mailboxes.find(
          (m) => m.name === name && m.parentId === parentId
        );
        if (existing) return existing;
        const created = await client.createMailbox(name, parentId);
        await fetchMailboxes(client);
        return created;
      };

      const yearMailboxes = new Map<string, { id: string; originalId?: string }>();
      const monthMailboxes = new Map<string, { id: string }>(); // key: "year/month"
      const uniqueYears = Array.from(new Set(targets.map((t) => t.year)));

      // Was N sequential `ensureFolder(year, ...)` calls — each one its
      // own JMAP RTT. Years are independent; parallelize. Archive-by-month
      // of a multi-year inbox used to spend `(years + months) × RTT`
      // before any move; now `2 × RTT` total (one for years, one for
      // months after they resolve).
      const yearResults = await Promise.all(
        uniqueYears.map(async (year) => [year, await ensureFolder(year, archiveId)] as const),
      );
      for (const [year, ym] of yearResults) yearMailboxes.set(year, ym);

      if (archiveMode !== 'year') {
        const uniqueMonths = Array.from(new Set(
          targets.map((t) => `${t.year}/${t.month}`)
        ));
        const monthResults = await Promise.all(
          uniqueMonths.map(async (key) => {
            const [year, month] = key.split('/');
            const ym = yearMailboxes.get(year)!;
            const yearId = ym.originalId || ym.id;
            return [key, await ensureFolder(month, yearId)] as const;
          }),
        );
        for (const [key, mm] of monthResults) monthMailboxes.set(key, mm);
      }

      // Pass 3: bucket email IDs by destination mailbox id, then fire
      // one batchMoveEmails per bucket. JMAP accepts a single Email/set
      // with a destroy/update map of arbitrary size, so the entire
      // reorganize collapses to ~uniqueBuckets requests (often << N).
      const buckets = new Map<string, string[]>();
      emails.forEach((email, i) => {
        const t = targets[i];
        let destId: string;
        if (archiveMode === 'year') {
          destId = yearMailboxes.get(t.year)!.id;
        } else {
          destId = monthMailboxes.get(`${t.year}/${t.month}`)!.id;
        }
        const list = buckets.get(destId);
        if (list) list.push(email.id);
        else buckets.set(destId, [email.id]);
      });

      let movedCount = 0;
      for (const [destId, ids] of buckets) {
        await client.batchMoveEmails(ids, destId);
        movedCount += ids.length;
      }

      setReorganizeResult(t('archive_mode.reorganize_success', { count: movedCount }));
    } catch (error) {
      console.error('Failed to reorganize archive:', error);
      setReorganizeResult(t('archive_mode.reorganize_error'));
    } finally {
      setIsReorganizing(false);
    }
  };

  return (
    <SettingsSection title={t('title')} description={t('description')}>
      {!isSettingHidden('markAsReadDelay') && (
      <SettingItem label={t('mark_read.label')} description={t('mark_read.description')} locked={isSettingLocked('markAsReadDelay')}>
        <Select
          value={markAsReadDelay.toString()}
          onChange={(value) => updateSetting('markAsReadDelay', parseInt(value))}
          options={[
            { value: '0', label: t('mark_read.instant') },
            { value: '3000', label: t('mark_read.delay_3s') },
            { value: '5000', label: t('mark_read.delay_5s') },
            { value: '-1', label: t('mark_read.never') },
          ]}
        />
      </SettingItem>
      )}

      {!isSettingHidden('deleteAction') && (
      <SettingItem label={t('delete_action.label')} description={t('delete_action.description')} locked={isSettingLocked('deleteAction')}>
        <div className="flex flex-col gap-2">
          <Select
            value={deleteAction}
            onChange={(value) => updateSetting('deleteAction', value as 'trash' | 'permanent')}
            options={[
              { value: 'trash', label: t('delete_action.trash') },
              { value: 'permanent', label: t('delete_action.permanent') },
            ]}
          />
          {deleteAction === 'permanent' && (
            <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t('delete_action.warning')}</span>
            </div>
          )}
        </div>
      </SettingItem>
      )}

      <SettingItem label={t('archive_mode.label')} description={t('archive_mode.description')}>
        <div className="flex flex-col gap-2">
          <Select
            value={archiveMode}
            onChange={(value) => updateSetting('archiveMode', value as ArchiveMode)}
            options={[
              { value: 'single', label: t('archive_mode.single') },
              { value: 'year', label: t('archive_mode.year') },
              { value: 'month', label: t('archive_mode.month') },
            ]}
          />
          {archiveMode !== 'single' && (
            <div className="flex flex-col gap-2">
              <button
                onClick={handleReorganizeArchive}
                disabled={isReorganizing}
                className="flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-accent rounded-md transition-colors text-sm disabled:opacity-50"
              >
                {isReorganizing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FolderSync className="w-4 h-4" />
                )}
                <span>{t('archive_mode.reorganize')}</span>
              </button>
              {reorganizeResult && (
                <p className="text-xs text-muted-foreground">{reorganizeResult}</p>
              )}
            </div>
          )}
        </div>
      </SettingItem>

      <SettingItem label={t('permanently_delete_junk.label')} description={t('permanently_delete_junk.description')}>
        <ToggleSwitch
          checked={permanentlyDeleteJunk}
          onChange={(checked) => updateSetting('permanentlyDeleteJunk', checked)}
        />
      </SettingItem>

      {!isSettingHidden('showPreview') && (
      <SettingItem
        label={t('show_preview.label')}
        description={isFocusedLayout ? t('show_preview.focus_description') : t('show_preview.description')}
        locked={isSettingLocked('showPreview')}
      >
        <ToggleSwitch checked={showPreview} onChange={(checked) => updateSetting('showPreview', checked)} />
      </SettingItem>
      )}

      <SettingItem label={t('disable_threading.label')} description={t('disable_threading.description')}>
        <ToggleSwitch
          checked={disableThreading}
          onChange={(checked) => updateSetting('disableThreading', checked)}
        />
      </SettingItem>

      <SettingItem label={t('plain_text_mode.label')} description={t('plain_text_mode.description')}>
        <ToggleSwitch
          checked={plainTextMode}
          onChange={(checked) => updateSetting('plainTextMode', checked)}
        />
      </SettingItem>

      <SettingItem label={t('hide_inline_image_attachments.label')} description={t('hide_inline_image_attachments.description')}>
        <ToggleSwitch
          checked={hideInlineImageAttachments}
          onChange={(checked) => updateSetting('hideInlineImageAttachments', checked)}
        />
      </SettingItem>

      <SettingItem label={t('attachment_image_previews.label')} description={t('attachment_image_previews.description')}>
        <ToggleSwitch
          checked={attachmentImagePreviewsEnabled}
          onChange={(checked) => updateSetting('attachmentImagePreviewsEnabled', checked)}
        />
      </SettingItem>

      {isFeatureEnabled('hoverActionsConfigEnabled') && (
      <div className="py-3 border-b border-border space-y-3">
        <div>
          <label className="text-sm font-medium text-foreground">{t('hover_actions.label')}</label>
          <p className="text-xs text-muted-foreground mt-1">{t('hover_actions.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_HOVER_ACTIONS.map((action) => {
            const isEnabled = hoverActions.includes(action.id);
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => {
                  const newActions = isEnabled
                    ? hoverActions.filter((a: HoverAction) => a !== action.id)
                    : [...hoverActions, action.id];
                  updateSetting('hoverActions', newActions);
                }}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md transition-colors duration-150',
                  isEnabled
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'bg-muted hover:bg-accent text-foreground'
                )}
              >
                {t(`hover_actions.${action.labelKey}`)}
              </button>
            );
          })}
        </div>

        <div className="pt-2 space-y-2">
          <label className="text-xs font-medium text-foreground">{t('hover_actions.mode_label')}</label>
          <div className="flex gap-2">
            {(['inline', 'floating'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => updateSetting('hoverActionsMode', mode)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md transition-colors duration-150',
                  hoverActionsMode === mode
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'bg-muted hover:bg-accent text-foreground'
                )}
              >
                {t(`hover_actions.mode_${mode}`)}
              </button>
            ))}
          </div>
        </div>

        {hoverActionsMode === 'floating' && (
          <div className="pt-1 space-y-2">
            <label className="text-xs font-medium text-foreground">{t('hover_actions.corner_label')}</label>
            <div className="grid grid-cols-2 gap-2 w-48">
              {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => (
                <button
                  key={corner}
                  type="button"
                  onClick={() => updateSetting('hoverActionsCorner', corner)}
                  className={cn(
                    'px-2 py-1.5 text-xs rounded-md transition-colors duration-150 text-center',
                    hoverActionsCorner === corner
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'bg-muted hover:bg-accent text-foreground'
                  )}
                >
                  {t(`hover_actions.corner_${corner}`)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      <SettingItem label={t('attachment_click_action.label')} description={t('attachment_click_action.description')}>
        <Select
          value={mailAttachmentAction}
          onChange={(value) => updateSetting('mailAttachmentAction', value as 'preview' | 'download')}
          options={[
            { value: 'preview', label: t('attachment_click_action.preview') },
            { value: 'download', label: t('attachment_click_action.download') },
          ]}
        />
      </SettingItem>

      <SettingItem label={t('attachment_position.label')} description={t('attachment_position.description')}>
        <Select
          value={attachmentPosition}
          onChange={(value) => updateSetting('attachmentPosition', value as 'beside-sender' | 'below-header')}
          options={[
            { value: 'beside-sender', label: t('attachment_position.beside-sender') },
            { value: 'below-header', label: t('attachment_position.below-header') },
          ]}
        />
      </SettingItem>

      {!isSettingHidden('emailsPerPage') && (
      <SettingItem label={t('emails_per_page.label')} description={t('emails_per_page.description')} locked={isSettingLocked('emailsPerPage')}>
        <Select
          value={emailsPerPage.toString()}
          onChange={(value) => updateSetting('emailsPerPage', parseInt(value))}
          options={[
            { value: '10', label: t('emails_per_page.10') },
            { value: '25', label: t('emails_per_page.25') },
            { value: '50', label: t('emails_per_page.50') },
            { value: '100', label: t('emails_per_page.100') },
          ]}
        />
      </SettingItem>
      )}
    </SettingsSection>
  );
}
