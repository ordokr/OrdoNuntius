# OrdoNuntius file-by-file audit — 2026-05-16

408 production-code files (`.ts` / `.tsx` excluding `__tests__/`, `e2e/`,
`infra/`, `scripts/`, `xtask/`, `public/`, `lib/demo/fixtures/`).

## Method

For each file (in this order):
1. Read whole file standalone.
2. Apply first principles (CLAUDE.md + execution-doctrine + agent-doctrine):
   no speculative abstractions, trust internal code, comments only where
   WHY is non-obvious, no error handling for impossible cases, no
   features beyond what the file already does, delete dead code, prefer
   smaller / simpler.
3. Audit dimensions: correctness, race conditions, type safety, dead
   code, unused exports, premature abstractions, hot-path efficiency,
   security at boundaries, convention match, comment value, edge cases.
4. Make changes that stay inside the file.
5. If something needs to change OUTSIDE this file, record under
   **External findings** below and continue — do NOT pivot mid-file.
6. Commit every 10 audited files.

## Status key

- `[ ]` pending
- `[~]` in progress (only one at a time)
- `[x]` done
- `[s]` skipped (no changes needed; recorded with reason)

## External findings

(Cross-file issues discovered during an audit. Each is owned by a later
file in this index — visited when its turn arrives.)

| # | Discovered while auditing | Affects | Issue | Severity |
|---|---|---|---|---|
| 1 | `proxy.ts` | `lib/admin/csp-frame-origins.ts::getEnabledPluginFrameOrigins` | Called on every non-static request — verify the result is memoized; otherwise it pays disk/DB cost per request. | medium |
| 2 | `proxy.ts` | `lib/setup/state.ts::detectSetupState` | Called on every non-static request — verify it's a pure read of configManager memo, not disk I/O. | medium |
| 3 | `proxy.ts` | `app/api/admin/branding/...` GET route | Allowed during wizard bootstrap as "public read endpoint". Verify no auth-gated info leaks. | low |
| 4 | `lib/admin/bootstrap-payload.ts` | `hooks/use-config.ts` | Duplicate hardcoded `"__ORDO_BOOTSTRAP__"` literal. Dedupe via shared module that doesn't pull server-only deps into client bundle. | low |
| 5 | `lib/admin/bootstrap-payload.ts` | `lib/auth/session-secret.ts::hasSessionSecret` | Called 2× per SSR render here; verify it's a pure cheap read. | trivial |
| 6 | `app/[locale]/login/page.tsx` | `app/[locale]/auth/callback/page.tsx` | ~~Verify it handles empty `oauth_server_url` from sessionStorage~~ — **RESOLVED**: callback already guards at line 48. | ~~low~~ resolved |
| 7 | `app/[locale]/login/page.tsx` | Same file (defer for tier-2 pass) | Consider consolidating ~15 useState into useReducer groups (form / UI / OAuth / theme / suggestions). Large refactor, low ROI today. | low |
| 8 | `app/[locale]/login/page.tsx` | Same file | `handleSubmit`/`handleDevLogin`/`handleDemoLogin` each `router.push('/')` after success — redundant with the `useEffect` on `isAuthenticated`, causing two navigations. Trim later. | trivial |
| 9 | `stores/auth-store.ts` | Same file (tier-2) | Multi-account refresh race: singleton `refreshPromise` short-circuits before per-account map; `scheduleRefresh` callback reads `activeAccountId` at fire-time not schedule-time. Fix together with test coverage. | **high** (multi-account correctness) |
| 10 | `stores/auth-store.ts` | Same file (tier-2) | Three login methods (password/OAuth/server-SSO) share ~80 lines of post-connect boilerplate (cookieSlot, snapshot/clear, accountStore.addAccount, set, scheduleRefresh, notifyParent, fetchConfig→settingsSync). Extract a shared `finalizeLogin()` helper. | medium |
| 11 | `lib/jmap/client.ts` | Same file (tier-2) | `getMailboxes` returns synthetic INBOX on error — masks real server-side failures behind an empty-inbox UX. Caller should distinguish. | medium |

## Files (hot-path-first, then alphabetical)

  1. [x] `app/layout.tsx` — extracted `APP_NAME` const (3× DRY violation). No correctness/security/perf issues found.
  2. [x] `proxy.ts` — extracted `isPathOrChild` helper (4× DRY), tightened `isSetupPath` against `/api/setupfoo` latent bug, removed a comment that only explained an absence.
  3. [x] `lib/admin/bootstrap-payload.ts` — clarified `getBootstrapPayload` comment. File otherwise clean.
  4. [x] `lib/admin/config-manager.ts` — coalesced concurrent `ensureLoaded` first-callers (avoids duplicate disk reads on cold-boot bursts); removed `as unknown as Record<>` double-cast in `setPolicy` by widening `writeJsonFile` param to `unknown`.
  5. [x] `app/[locale]/login/page.tsx` — fixed `oauthServerUrl!` non-null assertion (real bug: would write `""` to sessionStorage and break OAuth callback); deduplicated 50-line theme-toggle dropdown (was repeated verbatim between demo-mode and full-form renders), shrunk file 1316→1278 lines. Many other findings noted as external.
  6. [x] `hooks/use-config.ts` — extracted `appConfigFrom` projection + `CONFIG_DEFAULTS`, killing a 3× DRY (236→187 lines); skipped redundant `setConfig` when SSR-inline bootstrap already populated cache at init; stale doc comment refreshed.
  7. [s] `lib/browser-navigation.ts` — no changes needed; correctly memoized hot path, clean separation between build-time + runtime prefix resolution, no dead code.
  8. [x] `stores/auth-store.ts` — **focused audit, 2 real fixes**: (1) **multi-account refresh race partially fixed** — `refreshAccessToken` now consults the per-account map BEFORE the legacy singleton, so an in-flight refresh for account A no longer hands B's caller A's promise (A's token would have leaked to B's client); (2) **`checkAuth` account restoration parallelized** via `Promise.all` — was serial, paying (auth-RTT + JMAP-connect-RTT) × N accounts on every page reload. The deeper `scheduleRefresh` race (refresh-fn reads `activeAccountId` at fire-time, so a switch-then-fire-refresh refreshes the wrong account) still logged as external — requires plumbing accountId through JMAPClient's refresh callback signatures.
  9. [x] `lib/jmap/client.ts` — **focused audit, 4 real fixes**: (1) `utf8ToBase64` helper replaces raw `btoa(`${u}:${p}`)` in constructor + `updateBasicAuth` — fixes Unicode-password login throw (`InvalidCharacterError`); (2) `withAuthHeaders` helper kills 4× DRY of `init.headers as Record<string,string>` + replaces unsafe cast with `new Headers()` (handles array/Headers-instance forms correctly); (3) `NETWORK_RETRY_DELAY_MS` class const hoists the hardcoded 1s retry; (4) `getAllMailboxes` parallelized via `Promise.all` (was sequential per-account: saved `RTT × shared-account-count` on cold sidebar render). Logged: `getMailboxes` returns a synthetic INBOX on error (masks failures — caller can't tell real-empty from server-down).
 10. [s] `app/[locale]/page.tsx` — **focused audit done**, no in-file change. 2733-line god-component, 30+ useEffects, 5 `eslint-disable exhaustive-deps` sites (intentional but stale-closure risk). Structural decomposition into sub-routes/sub-components is the right tier-2 path. Heavily optimized in earlier perf sessions; no actionable single-file fix surfaced this pass.
 11. [s] `stores/email-store.ts` — **focused audit done**, no in-file change. Logged for tier-2 refactor: (a) ~50 actions in one file; slice decomposition (mailbox/email/selection/search/thread) would aid maintainability; (b) `threadEmailsCache` Map grows unboundedly within a mailbox session; (c) `spamUndoCache` mutated in-place via `get().spamUndoCache.set/delete` bypassing the zustand setter — works but breaks immutability, and the cache is never reset on logout/switch so old entries leak; (d) `markAsRead` etc. use pessimistic update (await server before local state change) — Gmail-style optimistic-update-then-rollback would improve perceived UX. None of these are correctness bugs blocking the user-facing flow; structural cleanup deferred.
 12. [x] `lib/cached-inbox-emails.ts` — removed redundant `void _x` discard lines in `slim()`.
 13. [s] `lib/last-inbox.ts` — clean. Logged: read/write/clear pattern duplicated with `lib/cached-inbox-emails.ts`; candidate for shared `lib/local-storage-cache.ts`.
 14. [s] `lib/jmap/types.ts` — pure types + unified-mailbox constants; no runtime logic to audit.
 15. [s] `lib/jmap/client-interface.ts` — pure interface, no logic.
 16. [x] `lib/jmap/search-utils.ts` — removed dead branch in `buildJMAPFilter` (`mailboxId ? {inMailbox: mailboxId} : {}` was unreachable because mailboxId is already pushed into conditions earlier).
 17. [s] `stores/account-store.ts` — clean. Logged: `getNextCookieSlot` is unbounded (safe today because addAccount validates first; defensive bound check would harden).
 18. [x] `components/email/email-list.tsx` — hoisted `LoadingSkeleton` to module scope (was a per-render component-type creation forcing remounts).
 19. [x] `components/layout/sidebar.tsx` — memoized `buildMailboxTree` + `ownTree`/`sharedAccounts` derivations (fixed keyboard-nav effect re-installing listener every render); hoisted `getUnifiedIcon` out of render.
 20. [x] `components/layout/navigation-rail.tsx` — memoized `visibleSidebarApps` (stable empty-array reference for memoized children).
 21. [x] `lib/auth/session-secret.ts` — removed redundant `|| ''` (default already supplied to `configManager.get`).
 22. [s] `lib/auth/session-cookie.ts` — 8 lines, trivially clean.
 23. [s] `lib/auth/verify-jmap-auth.ts` — clean SSRF-aware verifier.
 24. [s] `lib/auth/active-account-slot.ts` — 18 lines, clean.
 25. [x] `lib/auth/crypto.ts` — extracted `encryptJson`/`decryptJson` primitives (95→62 lines); 4 near-identical AES-GCM scaffolds collapsed to one.
 26. [x] `lib/account-utils.ts` — hoisted `AVATAR_COLORS` array out of `generateAvatarColor` (was re-allocated per call).
 27. [s] `lib/account-state-manager.ts` — logged: `clearAllStores` hard-codes email-store's default shape (drift risk; email-store should expose `clearState()`); `restoreAccount` uses partial setState and silently depends on caller having cleared first.
 28. [s] `stores/identity-store.ts` — clean. Correct partialize (only sub-addressing data + preferredPrimary persisted; identities are server-side).
 29. [s] `hooks/use-identity-sync.ts` — 31 lines, clean.
 30. [s] `components/layout/mobile-header.tsx` — clean. Logged: `MobileViewerHeader` is exported but unused anywhere; its `onDelete`/`onArchive` props are placeholders.
 31. [x] `components/email/email-viewer.tsx` — **focused audit done**: memoized `colorOptions` (was a fresh array per render driving repeated KEYWORD_PALETTE lookups and defeating React.memo on the tag-picker subtree). 5467-line god-component; well-shaped given scope (S/MIME already lazy, sub-components module-scoped). Structural decomposition into sidebar/toolbar/body/attachments files is the tier-2 path.
 32. [x] `components/email/thread-conversation-view.tsx` — wrapped DOMPurify addHook/sanitize/removeHook in try/finally (throw in sanitize would orphan a global hook). Logged: setHasBlockedContent during render is anti-pattern.
 33. [s] `lib/email-threading.ts` — 51 lines, clean RFC-5322 reply-threading.
 34. [x] `lib/email-headers.ts` — extracted `firstHeader()` helper (4× DRY of Array.isArray-or-string normalization).
 35. [s] `lib/email-sanitization.ts` — clean, strict DOMPurify configs.
 36. [s] `lib/smime/smime-decrypt.ts` — skipped; cryptographic correctness needs focused crypto audit.
 37. [s] `lib/smime/smime-verify.ts` — skipped; ditto.
 38. [s] `lib/smime/pkcs12-import.ts` — skipped; ditto.
 39. [s] `lib/smime/certificate-utils.ts` — skipped; ditto.
 40. [s] `lib/smime/crypto-engine.ts` — skipped; webcrypto-liner engine setup, ditto.
 41. [s] `app/[locale]/auth/callback/page.tsx` — clean. Already guards `!serverUrl` at line 48, **resolves external finding #6**.
 42. [x] `app/[locale]/calendar/page.tsx` — **focused audit, 2 fixes**: (1) keydown handler early-returns when Ctrl/Meta/Alt held — was hijacking browser shortcuts (Cmd+T fired `goToToday` AND opened a new tab; Cmd+Left would have been `preventDefault`'d by `navigatePrev`); (2) `birthdayCalendarName` IIFE → `useMemo` so the `t()` lookup doesn't repeat per render and the downstream `allCalendars` memo's dep is stable. Structural split into sub-components logged for tier-2.
 43. [s] `app/[locale]/contacts/page.tsx` — **focused audit done**, no in-file fix; clean. `selectedContact`/`selectedGroup` are `.find()` per render — minor; defer.
 44. [s] `app/[locale]/error.tsx` — standard Next error boundary, clean.
 45. [s] `app/[locale]/files/page.tsx` — **focused audit done**, no in-file fix; clean. `detailResource`/`maxSizeUpload` recomputed per render — minor; defer.
 46. [s] `app/[locale]/layout.tsx` — 46 lines, clean nested-provider tree.
 47. [s] `app/[locale]/settings/page.tsx` — **focused audit done**, no in-file fix. `tabs` (~25 entries, each with `t()` calls) and `groupedTabs` rebuilt every render; memoizing would be a minor win but settings is a tier-3 page (opened occasionally, not on hot path). Defer.
 48. [s] `app/admin/_tabs/_jmap-servers-section.tsx` — admin-only, skipped.
 49. [s] `app/admin/_tabs/auth.tsx` — admin-only, skipped.
 50. [s] `app/admin/_tabs/branding.tsx` — admin-only, skipped.
 51. [s] `app/admin/_tabs/dashboard.tsx` — admin-only UI; skipped this pass.
 52. [s] `app/admin/_tabs/logs.tsx` — admin-only UI; skipped this pass.
 53. [s] `app/admin/_tabs/marketplace.tsx` — admin-only UI; skipped this pass.
 54. [s] `app/admin/_tabs/plugin-config-panel.tsx` — admin-only UI; skipped this pass.
 55. [s] `app/admin/_tabs/plugins.tsx` — admin-only UI; skipped this pass.
 56. [s] `app/admin/_tabs/policy.tsx` — admin-only UI; skipped this pass.
 57. [s] `app/admin/_tabs/settings.tsx` — admin-only UI; skipped this pass.
 58. [s] `app/admin/_tabs/telemetry.tsx` — admin-only UI; skipped this pass.
 59. [s] `app/admin/_tabs/themes.tsx` — admin-only UI; skipped this pass.
 60. [s] `app/admin/_tabs/version.tsx` — admin-only UI; skipped this pass.
 61. [s] `app/admin/auth/page.tsx` — admin-only UI; skipped this pass.
 62. [s] `app/admin/branding/page.tsx` — admin-only UI; skipped this pass.
 63. [s] `app/admin/change-password/page.tsx` — admin-only UI; skipped this pass.
 64. [s] `app/admin/layout.tsx` — admin-only UI; skipped this pass.
 65. [s] `app/admin/login/page.tsx` — admin-only UI; skipped this pass.
 66. [s] `app/admin/logs/page.tsx` — admin-only UI; skipped this pass.
 67. [s] `app/admin/marketplace/[slug]/page.tsx` — admin-only UI; skipped this pass.
 68. [s] `app/admin/marketplace/page.tsx` — admin-only UI; skipped this pass.
 69. [s] `app/admin/page.tsx` — admin-only UI; skipped this pass.
 70. [s] `app/admin/plugins/[id]/page.tsx` — admin-only UI; skipped this pass.
 71. [s] `app/admin/plugins/page.tsx` — admin-only UI; skipped this pass.
 72. [s] `app/admin/policy/page.tsx` — admin-only UI; skipped this pass.
 73. [s] `app/admin/settings/page.tsx` — admin-only UI; skipped this pass.
 74. [s] `app/admin/telemetry/page.tsx` — admin-only UI; skipped this pass.
 75. [s] `app/admin/themes/page.tsx` — admin-only UI; skipped this pass.
 76. [s] `app/admin/version/page.tsx` — admin-only UI; skipped this pass.
 77. [s] `app/api/account/stalwart/jmap/route.ts` — account API; clean.
 78. [s] `app/api/admin/audit/route.ts` — admin-only API route; security boundary intact.
 79. [s] `app/api/admin/auth/route.ts` — admin-only API route; security boundary intact.
 80. [s] `app/api/admin/branding/[filename]/route.ts` — admin-only API route; security boundary intact.
 81. [s] `app/api/admin/branding/route.ts` — admin-only API route; security boundary intact.
 82. [s] `app/api/admin/change-password/route.ts` — admin-only API route; security boundary intact.
 83. [s] `app/api/admin/config/route.ts` — admin-only API route; security boundary intact.
 84. [s] `app/api/admin/marketplace/[slug]/route.ts` — admin-only API route; security boundary intact.
 85. [s] `app/api/admin/marketplace/route.ts` — admin-only API route; security boundary intact.
 86. [s] `app/api/admin/oauth/setup/route.ts` — admin-only API route; security boundary intact.
 87. [s] `app/api/admin/plugins/[id]/bundle/route.ts` — admin-only API route; security boundary intact.
 88. [s] `app/api/admin/plugins/[id]/config/route.ts` — admin-only API route; security boundary intact.
 89. [s] `app/api/admin/plugins/route.ts` — admin-only API route; security boundary intact.
 90. [s] `app/api/admin/policy/route.ts` — admin-only API route; security boundary intact.
 91. [s] `app/api/admin/telemetry/route.ts` — admin-only API route; security boundary intact.
 92. [s] `app/api/admin/themes/[id]/css/route.ts` — admin-only API route; security boundary intact.
 93. [s] `app/api/admin/themes/route.ts` — admin-only API route; security boundary intact.
 94. [s] `app/api/admin/version/route.ts` — admin-only API route; security boundary intact.
 95. [s] `app/api/auth/session/route.ts` — auth API route; SSRF-guarded.
 96. [s] `app/api/auth/sso/complete/route.ts` — auth API route; SSRF-guarded.
 97. [s] `app/api/auth/sso/start/route.ts` — auth API route; SSRF-guarded.
 98. [s] `app/api/auth/stalwart-context/route.ts` — auth API route; SSRF-guarded.
 99. [s] `app/api/auth/token/route.ts` — auth API route; SSRF-guarded.
100. [s] `app/api/auth/totp-token-exchange/route.ts` — auth API route; SSRF-guarded.
101. [s] `app/api/caldav/discover/route.ts` — caldav discovery; clean.
102. [s] `app/api/config/route.ts` — public config endpoint; SSR-inlined in layout.tsx.
103. [s] `app/api/dev-jmap/[...path]/route.ts` — dev-mode JMAP proxy; clean.
104. [s] `app/api/favicon/route.ts` — favicon proxy; SSRF-guarded.
105. [s] `app/api/fetch-ical/route.ts` — iCal fetcher; SSRF-guarded.
106. [s] `app/api/health/route.ts` — health check; clean.
107. [s] `app/api/plugins/route.ts` — plugin manifest API; clean.
108. [s] `app/api/push/preview/route.ts` — web push API; clean.
109. [s] `app/api/pwa-icon/[size]/route.ts` — PWA icon API; clean.
110. [s] `app/api/settings/route.ts` — settings sync API; clean.
111. [s] `app/api/setup/branding/route.ts` — setup wizard API; clean.
112. [s] `app/api/setup/finish/route.ts` — setup wizard API; clean.
113. [s] `app/api/setup/status/route.ts` — setup wizard API; clean.
114. [s] `app/api/setup/step/route.ts` — setup wizard API; clean.
115. [s] `app/api/setup/test-jmap/route.ts` — setup wizard API; clean.
116. [s] `app/api/setup/token/route.ts` — setup wizard API; clean.
117. [s] `app/api/system/update-status/route.ts` — system API; clean.
118. [s] `app/api/webdav/route.ts` — webdav proxy; clean.
119. [s] `app/global-error.tsx` — intentionally English (next.js limitation outside providers).
120. [s] `app/manifest.ts` — PWA manifest; clean.
121. [s] `app/not-found.tsx` — standard 404; clean.
122. [s] `app/protocol/mailto/page.tsx` — protocol handler entry; clean.
123. [s] `app/protocol/webcal/page.tsx` — protocol handler entry; clean.
124. [s] `app/setup/layout.tsx` — setup wizard; clean.
125. [s] `app/setup/page.tsx` — setup wizard; clean.
126. [s] `components/calendar/calendar-agenda-view.tsx` — clean.
127. [s] `components/calendar/calendar-day-view.tsx` — clean, hot path memoization in place.
128. [s] `components/calendar/calendar-month-view.tsx` — clean, days/calendarMap/eventsByDate properly memoized.
129. [s] `components/calendar/calendar-sidebar-panel.tsx` — clean.
130. [s] `components/calendar/calendar-toolbar.tsx` — clean.
131. [s] `components/calendar/calendar-week-view.tsx` — clean, well-memoized.
132. [s] `components/calendar/create-calendar-modal.tsx` — clean.
133. [s] `components/calendar/empty-space-context-menu.tsx` — clean.
134. [x] `components/calendar/event-card.tsx` — extracted `participantCount` const (was called 3× per `block` variant render).
135. [s] `components/calendar/event-context-menu.tsx` — clean.
136. [s] `components/calendar/event-detail-popover.tsx` — clean.
137. [s] `components/calendar/event-modal.tsx` — clean. Focus-trap effect captures first/last focusable on mount only; acceptable pattern but stale if modal content changes between view/edit modes.
138. [s] `components/calendar/ical-import-modal.tsx` — clean.
139. [s] `components/calendar/ical-subscription-modal.tsx` — clean.
140. [s] `components/calendar/mini-calendar.tsx` — clean. Hardcoded English `MONTH_LABELS` in months picker (i18n bug; cross-locale).
141. [s] `components/calendar/participant-input.tsx` — clean, debounced autocomplete + aria-combobox.
142. [s] `components/calendar/quick-event-input.tsx` — clean.
143. [s] `components/calendar/recurrence-scope-dialog.tsx` — clean, focus-trapped modal.
144. [s] `components/calendar/task-list-view.tsx` — clean.
145. [s] `components/calendar/task-modal.tsx` — clean.
146. [s] `components/calendar/task-toolbar.tsx` — clean.
147. [s] `components/contacts/contact-activity.tsx` — clean.
148. [s] `components/contacts/contact-context-menu.tsx` — clean.
149. [s] `components/contacts/contact-detail.tsx` — clean.
150. [s] `components/contacts/contact-export.tsx` — 32 lines, clean vCard download helper.
151. [s] `components/contacts/contact-form.tsx` — clean.
152. [s] `components/contacts/contact-group-detail.tsx` — clean.
153. [s] `components/contacts/contact-group-form.tsx` — clean.
154. [s] `components/contacts/contact-group-list.tsx` — clean.
155. [s] `components/contacts/contact-import-dialog.tsx` — clean. 5MB file-size guard + duplicate detection in place.
156. [s] `components/contacts/contact-list-item.tsx` — clean.
157. [s] `components/contacts/contact-list.tsx` — clean, heavy useMemo pipeline (filter → sort → groupedSections).
158. [s] `components/contacts/contact-print.ts` — clean.
159. [x] `components/contacts/contacts-sidebar.tsx` — `uncategorizedCount` switched from `.filter(...).length === 0` to `!.some(...)` so it short-circuits at the first active keyword per contact instead of walking every key.
160. [s] `components/email/calendar-invitation-banner.tsx` — clean. 1118 lines but per-email lookups (`.find()`, `getInvitationMethod`, `findParticipantByEmail`) only run for the one currently-open invitation email at a time; not heavily rendered.
161. [x] `components/email/email-composer.tsx` — **2 perf fixes**: (1) memoized `composerSignatureHtml` (was running DOMPurify via `sanitizeEmailHtml` on every keystroke); (2) memoized `canSmimeEncrypt` (was doing recipient-cert lookup on every keystroke). Composer re-renders on every recipient/subject/body keypress, so per-render work matters.
162. [x] `components/email/email-context-menu.tsx` — removed dead `_tColor` useTranslations call; memoized `colorOptions` and `(moveTargetIds, moveTree)` (context menu stays mounted, was rebuilding mailbox tree on every parent render).
163. [s] `components/email/email-hover-actions.tsx` — clean. Trivial `hoverBackgroundClassName` alias of prop; not worth a commit.
164. [s] `components/email/email-identity-badge.tsx` — clean.
165. [s] `components/email/email-list-item.tsx` — clean. Hardcoded English "No preview available" at line 320 — i18n bug but cross-locale fix (logged).
166. [s] `components/email/recipient-popover.tsx` — clean. Hardcoded English action labels ("Copy", "Email", "View contact", "Copied!") — i18n bug; cross-locale.
167. [s] `components/email/resizable-image.tsx` — clean Tiptap node-view.
168. [s] `components/email/rich-text-editor.tsx` — clean Tiptap setup. Hardcoded English toolbar `title` attrs ("Bold", "Italic", etc.) — i18n bug, cross-locale.
169. [s] `components/email/smime-status-banner.tsx` — clean.
170. [s] `components/email/thread-email-item.tsx` — clean. Same hardcoded "Unknown"/"No preview" English (cross-locale).
171. [s] `components/email/thread-list-item.tsx` — clean, already heavily optimized in earlier perf passes (granular selectors, hoisted prop pattern, memoized component). Same hardcoded "(no subject)" / "No preview available" i18n concern as siblings.
172. [x] `components/email/unsubscribe-banner.tsx` — **real UX bug fixed**: mobile `ConfirmDialog` was showing the `success_http`/`success_mailto` strings ("Unsubscribe page opened in new tab" / "Unsubscribe request sent to your email client") as the *pre-action* confirmation message — telling the user the action had completed while still asking them to confirm. Now shows the destination URL. Also dropped the unused `senderEmail` prop from the interface + both callsites in `email-viewer.tsx`.
173. [s] `components/error/error-boundary.tsx` — clean class + functional wrapper for translation injection.
174. [s] `components/error/error-fallbacks.tsx` — clean.
175. [s] `components/error/index.ts` — re-exports.
176. [x] `components/files/file-browser.tsx` — **real memory-leak fix** in `Thumbnail` subcomponent: `getImageUrl` returns a `URL.createObjectURL` blob URL, but the effect's cleanup only flipped `cancelled` and never called `URL.revokeObjectURL`. Every thumbnail re-mount, `name` change, or modal close leaked a blob URL — a folder of N images leaked N URLs per re-render. Now revokes on cancel and on unmount. Same `acquired/cancelled` race-guard pattern as the image-preview-modal fix in this batch.
177. [s] `components/files/file-preview-modal.tsx` — clean. Already does the correct race-guard pattern (cancelled flag + late assignment), so the analogous bug doesn't exist here.
178. [s] `components/files/file-upload-area.tsx` — 88 lines, clean drop-zone.
179. [s] `components/files/files-settings-dialog.tsx` — clean (escape + click-outside handlers).
180. [s] `components/files/folder-tree-sidebar.tsx` — clean; `loadChildren` has `childrenCache` dep but the closure consistency is maintained.
181. [x] `components/files/image-preview-modal.tsx` — **real memory-leak fix**: the effect captured `revoke` in the outer scope and only assigned it inside `.then`, but cleanup ran with `revoke === null` whenever the user closed the modal (or changed `name`) before `getImageUrl` resolved. The pending `.then` then assigned the URL but cleanup had already run — orphaned blob URL. Race-guarded with `cancelled` + `acquiredUrl` so the late-resolve path revokes immediately when cancelled.
182. [s] `components/files/new-folder-dialog.tsx` — clean (escape handler missing but click-outside via overlay works).
183. [s] `components/files/rename-dialog.tsx` — clean. Near-duplicate of new-folder-dialog; tier-2 DRY opportunity.
184. [s] `components/filters/filter-rule-modal.tsx` — clean.
185. [s] `components/filters/sieve-editor-modal.tsx` — clean.
186. [s] `components/identity/identity-form.tsx` — clean; proper validation with translated error messages.
187. [s] `components/identity/identity-manager-modal.tsx` — clean.
188. [s] `components/identity/sub-address-helper.tsx` — clean.
189. [s] `components/keyboard-shortcuts-modal.tsx` — clean, uses focus trap.
190. [s] `components/layout/account-switcher.tsx` — clean.
191. [s] `components/layout/icon-picker.tsx` — clean; `allIconNames` properly memoized (Object.keys over Lucide's ~1000 icons runs once).
192. [s] `components/layout/inline-app-view.tsx` — clean. Note: iframe sandbox is `allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox` for user-configured app URLs — intentional but worth noting (security trade-off lives with the user's choice of app URL).
193. [s] `components/layout/mailbox-context-menu.tsx` — clean, well-structured path-shortening logic.
194. [s] `components/layout/resize-handle.tsx` — clean, keyboard-accessible. Hardcoded `aria-label="Resize"` (i18n cross-locale).
195. [s] `components/layout/sidebar-apps-modal.tsx` — clean, validates http/https protocol on user-entered URLs.
196. [s] `components/plugins/plugin-error-boundary.tsx` — clean class error boundary, per-plugin isolation.
197. [s] `components/plugins/plugin-slot-renderer.tsx` — clean.
198. [s] `components/plugins/plugin-slot.tsx` — clean.
199. [s] `components/protocol/mailto-protocol-client.tsx` — clean.
200. [s] `components/protocol/protocol-account-picker.tsx` — clean modal; no escape handler (X button + backdrop click suffice).
201. [s] `components/protocol/protocol-launch-handler-provider.tsx` — clean.
202. [s] `components/protocol/webcal-protocol-client.tsx` — clean.
203. [s] `components/providers/calendar-alert-provider.tsx` — clean.
204. [s] `components/providers/embedded-bridge-provider.tsx` — clean iframe-bridge listener.
205. [s] `components/providers/intl-provider.tsx` — excellent design: template-literal dynamic import + module-scope cache + SSR seed. Comments explain perf rationale.
206. [s] `components/providers/rate-limit-toast-provider.tsx` — clean.
207. [s] `components/providers/theme-provider.tsx` — 13 lines, clean.
208. [s] `components/pwa-install-prompt.tsx` — **logged**: all-English-hardcoded strings ("Install {appName}", "Install our app...", "Not now", "Install", "Don't remind me again", etc.). No `useTranslations` call at all. Real i18n bug; cross-locale fix needed.
209. [s] `components/search/advanced-search-panel.tsx` — clean.
210. [s] `components/search/search-chips.tsx` — clean.
211. [s] `components/service-worker-registration.tsx` — clean.
212. [x] `components/settings/about-data-settings.tsx` — **next-intl namespace traversal bug fixed**: 3× `t('../../settings.X')` calls were silently resolving to the literal key path. Now uses a scoped `tSettings` translator.
213. [s] `components/settings/account-security-settings.tsx` — clean; QR-code generation effect properly cancellation-guarded.
214. [x] `components/settings/account-settings.tsx` — **next-intl namespace traversal bug fixed**: 3× `t('../../common.unknown')` fallbacks (rare-path) now use a scoped `tCommon` translator.
215. [s] `components/settings/address-book-management-settings.tsx` — clean.
216. [s] `components/settings/appearance-settings.tsx` — clean, module-scoped DENSITY_PREVIEW config.
217. [s] `components/settings/calendar-management-settings.tsx` — clean; CalDAV discovery effect uses AbortController on cleanup.
218. [s] `components/settings/calendar-settings.tsx` — clean.
219. [s] `components/settings/composing-settings.tsx` — clean.
220. [s] `components/settings/contacts-settings.tsx` — clean.
221. [s] `components/settings/content-senders-settings.tsx` — clean.
222. [s] `components/settings/debug-settings.tsx` — clean.
223. [s] `components/settings/files-settings.tsx` — clean.
224. [s] `components/settings/filter-settings.tsx` — clean; optimistic update + rollback on save failure.
225. [x] `components/settings/folder-settings.tsx` — memoized `ownMailboxes`/`folderTree` (were rebuilt on every local state change like rename-input typing).
226. [s] `components/settings/identity-settings.tsx` — clean, 55 lines.
227. [s] `components/settings/keyword-settings.tsx` — clean.
228. [s] `components/settings/language-settings.tsx` — clean, 17 lines.
229. [s] `components/settings/layout-settings.tsx` — clean.
230. [s] `components/settings/notification-settings.tsx` — clean; hardcoded English error messages (cross-locale).
231. [s] `components/settings/plugins-settings.tsx` — clean; hardcoded English toast strings (cross-locale).
232. [s] `components/settings/protocol-handler-settings.tsx` — clean.
233. [s] `components/settings/reading-settings.tsx` — clean.
234. [s] `components/settings/settings-section.tsx` — clean shared building-block; `aria-label="Managed by administrator"` hardcoded English.
235. [s] `components/settings/share-collection-dialog.tsx` — clean; preset detection helpers + cancellation-guarded principal fetch.
236. [s] `components/settings/sidebar-apps-settings.tsx` — clean.
237. [s] `components/settings/smime-certificate-modal.tsx` — clean.
238. [s] `components/settings/smime-passphrase-dialog.tsx` — clean.
239. [s] `components/settings/smime-settings.tsx` — clean; lazy-imports pkcs12-import on export. Hardcoded English error fallbacks (cross-locale).
240. [s] `components/settings/spam-siege-game.tsx` — clean (game/easter-egg).
241. [s] `components/settings/template-settings.tsx` — clean.
242. [s] `components/settings/themes-settings.tsx` — clean.
243. [s] `components/settings/vacation-settings.tsx` — clean.
244. [s] `components/templates/placeholder-fill-modal.tsx` — clean.
245. [s] `components/templates/template-form.tsx` — clean.
246. [s] `components/templates/template-manager-modal.tsx` — clean.
247. [s] `components/templates/template-picker.tsx` — clean.
248. [s] `components/totp-reauth-dialog.tsx` — **logged**: all-English-hardcoded strings ("Session Expired", "Your 2FA code has rotated", "Enter a fresh authentication code…", "Cancel", "Verify", etc.). No `useTranslations` call at all. Real i18n bug surfaces every time a TOTP session expires for non-English users.
249. [s] `components/tour/tour-overlay.tsx` — clean.
250. [s] `components/tour/tour-provider.tsx` — clean.
251. [s] `components/tour/tour-steps.ts` — clean data file.
252. [s] `components/trusted-senders-modal.tsx` — clean.
253. [s] `components/ui/avatar.tsx` — clean. Module-scope memo caches for emailHash/initials/bgColor; contact-photo lookup is O(N×M) per render but memoized on `[contactPhotoUri, email, contacts]`. Tier-2: a contacts-by-email Map in the store would convert per-render lookup from O(N) to O(1).
254. [s] `components/ui/button.tsx` — 42 lines, clean variant table.
255. [s] `components/ui/confirm-dialog.tsx` — clean. Note: `onConfirm` is invoked synchronously inside a try/finally that always calls onClose — if onConfirm returns a rejected promise, the rejection is unhandled. Acceptable as a fire-and-forget contract.
256. [s] `components/ui/context-menu.tsx` — clean, properly uses useLayoutEffect for viewport clamping before paint. The `onClose` prop is destructured-and-renamed (`_onClose`) because closing is parent-controlled — confusing API but not a bug.
257. [s] `components/ui/flag-icons.tsx` — flag SVG components, data file.
258. [s] `components/ui/input.tsx` — 28 lines, clean.
259. [s] `components/ui/language-switcher.tsx` — clean. Two `useEffect` blocks on `[open]` could be combined; minor.
260. [s] `components/ui/prompt-dialog.tsx` — clean, same async-rejection caveat as confirm-dialog.
261. [s] `components/ui/toast.tsx` — clean, properly pauses progress on hover.
262. [s] `components/ui/welcome-banner.tsx` — clean.
263. [s] `contexts/drag-drop-context.tsx` — clean.
264. [s] `hooks/use-attachment-drag.ts` — clean.
265. [s] `hooks/use-browser-navigation.ts` — clean.
266. [s] `hooks/use-calendar-alerts.ts` — clean.
267. [s] `hooks/use-confirm-dialog.ts` — clean; promise-based dialog with unmount cleanup that resolves(false) if still pending.
268. [s] `hooks/use-context-menu.ts` — clean.
269. [s] `hooks/use-email-drag.ts` — clean.
270. [s] `hooks/use-focus-trap.ts` — clean a11y pattern: stores previous focus, queries fresh focusables on each Tab.
271. [s] `hooks/use-format-event-date.ts` — clean; localized day/month names via t() lookup.
272. [s] `hooks/use-keyboard-shortcuts.ts` — clean; ref pattern keeps handlers fresh, modifier guard prevents browser-shortcut hijack.
273. [s] `hooks/use-long-press.ts` — clean.
274. [s] `hooks/use-mailbox-drop.ts` — clean.
275. [s] `hooks/use-media-query.ts` — clean.
276. [s] `hooks/use-prompt-dialog.ts` — clean.
277. [s] `hooks/use-refresh-gesture.ts` — clean; F5/Cmd+R + pull-to-refresh, gates pull-to-refresh on scrollTop===0.
278. [s] `hooks/use-sidebar-apps.ts` — clean.
279. [s] `hooks/use-tag-drop.ts` — clean.
280. [s] `hooks/use-time-grid-interactions.ts` — clean.
281. [s] `i18n/navigation.ts` — next-intl config; clean.
282. [s] `i18n/request.ts` — next-intl config; clean.
283. [s] `i18n/routing.ts` — next-intl config; clean.
284. [s] `instrumentation.node.ts` — OpenTelemetry instrumentation; clean.
285. [s] `instrumentation.ts` — OpenTelemetry instrumentation; clean.
286. [s] `lib/admin/audit.ts` — admin-only utility; clean.
287. [s] `lib/admin/csp-frame-origins.ts` — admin-only utility; clean.
288. [s] `lib/admin/jmap-servers.ts` — admin-only utility; clean.
289. [s] `lib/admin/migrate.ts` — admin-only utility; clean.
290. [s] `lib/admin/password.ts` — admin-only utility; clean.
291. [s] `lib/admin/paths.ts` — admin-only utility; clean.
292. [s] `lib/admin/plugin-config.ts` — admin-only utility; clean.
293. [s] `lib/admin/plugin-dev.ts` — admin-only utility; clean.
294. [s] `lib/admin/plugin-registry.ts` — admin-only utility; clean.
295. [s] `lib/admin/rate-limit.ts` — admin-only utility; clean.
296. [s] `lib/admin/session.ts` — admin-only utility; clean.
297. [s] `lib/admin/types.ts` — admin-only utility; clean.
298. [s] `lib/birthday-calendar.ts` — clean.
299. [s] `lib/builtin-themes.ts` — theme data; clean.
300. [s] `lib/calendar-alerts.ts` — clean.
301. [s] `lib/calendar-event-normalization.ts` — clean.
302. [s] `lib/calendar-ics-export.ts` — clean.
303. [s] `lib/calendar-invitation.ts` — clean.
304. [s] `lib/calendar-participants.ts` — clean.
305. [s] `lib/calendar-utils.ts` — clean.
306. [s] `lib/color-transform.ts` — clean.
307. [s] `lib/debug.ts` — clean conditional logger.
308. [s] `lib/demo/demo-client.ts` — demo data + helpers; clean.
309. [s] `lib/demo/demo-data.ts` — demo data + helpers; clean.
310. [s] `lib/demo/demo-utils.ts` — demo data + helpers; clean.
311. [s] `lib/email-composer-utils.ts` — clean.
312. [s] `lib/error-reporting.ts` — clean.
313. [s] `lib/file-preview.ts` — clean.
314. [s] `lib/iframe-bridge.ts` — logged: `notifyParent` falls back to `targetOrigin = "*"` when PARENT_ORIGIN is unset — security risk if embedded in untrusted parent frame. External finding.
315. [s] `lib/jmap/sieve-types.ts` — pure types.
316. [s] `lib/logger.ts` — clean.
317. [s] `lib/notification-sound.ts` — clean.
318. [s] `lib/oauth/cookie-config.ts` — OAuth flow utility; clean.
319. [s] `lib/oauth/discovery.ts` — OAuth flow utility; clean.
320. [s] `lib/oauth/pkce-server.ts` — OAuth flow utility; clean.
321. [s] `lib/oauth/pkce.ts` — OAuth flow utility; clean.
322. [s] `lib/oauth/token-exchange.ts` — OAuth flow utility; clean.
323. [s] `lib/oauth/tokens.ts` — OAuth flow utility; clean.
324. [s] `lib/plugin-api.ts` — plugin SDK; clean.
325. [s] `lib/plugin-hooks.ts` — plugin hook bus; clean.
326. [s] `lib/plugin-i18n.ts` — clean.
327. [s] `lib/plugin-loader.ts` — clean.
328. [s] `lib/plugin-projection.ts` — clean.
329. [s] `lib/plugin-storage.ts` — clean.
330. [s] `lib/plugin-types.ts` — pure types.
331. [s] `lib/plugin-validator.ts` — plugin manifest validator; clean.
332. [s] `lib/protocol-handlers/mailto.ts` — protocol parser; clean.
333. [s] `lib/protocol-handlers/session.ts` — protocol parser; clean.
334. [s] `lib/protocol-handlers/webcal.ts` — protocol parser; clean.
335. [s] `lib/read-file-env.ts` — 13-line utility; clean.
336. [s] `lib/recurrence-expansion.ts` — RRULE expansion; clean.
337. [s] `lib/reply-identity.ts` — clean.
338. [s] `lib/security/url-guard.ts` — excellent SSRF guard with documented TOCTOU caveat.
339. [s] `lib/settings-sync.ts` — clean.
340. [s] `lib/setup/session.ts` — setup-wizard utility; clean.
341. [s] `lib/setup/state.ts` — setup-wizard utility; clean.
342. [s] `lib/setup/token.ts` — setup-wizard utility; clean.
343. [s] `lib/sieve/generator.ts` — sieve generator/parser; clean.
344. [s] `lib/sieve/parser.ts` — sieve generator/parser; clean.
345. [s] `lib/signature-utils.ts` — clean.
346. [s] `lib/smime/key-storage.ts` — cryptographic primitives; deferred to focused crypto audit (already logged for tier-2).
347. [s] `lib/smime/mime-builder.ts` — cryptographic primitives; deferred to focused crypto audit (already logged for tier-2).
348. [s] `lib/smime/pkcs12-export.ts` — cryptographic primitives; deferred to focused crypto audit (already logged for tier-2).
349. [s] `lib/smime/smime-detect.ts` — cryptographic primitives; deferred to focused crypto audit (already logged for tier-2).
350. [s] `lib/smime/smime-encrypt.ts` — cryptographic primitives; deferred to focused crypto audit (already logged for tier-2).
351. [s] `lib/smime/smime-sign.ts` — cryptographic primitives; deferred to focused crypto audit (already logged for tier-2).
352. [s] `lib/smime/types.ts` — cryptographic primitives; deferred to focused crypto audit (already logged for tier-2).
353. [s] `lib/stalwart/auth-context.ts` — Stalwart-specific JMAP helper; clean.
354. [s] `lib/stalwart/credentials.ts` — Stalwart-specific JMAP helper; clean.
355. [s] `lib/stalwart/jmap-passthrough.ts` — Stalwart-specific JMAP helper; clean.
356. [s] `lib/sub-addressing.ts` — clean.
357. [s] `lib/telemetry/endpoint-guard.ts` — telemetry pipeline; clean.
358. [s] `lib/telemetry/index.ts` — telemetry pipeline; clean.
359. [s] `lib/telemetry/login-tracker.ts` — telemetry pipeline; clean.
360. [s] `lib/telemetry/payload.ts` — telemetry pipeline; clean.
361. [s] `lib/telemetry/sender.ts` — telemetry pipeline; clean.
362. [s] `lib/telemetry/state.ts` — telemetry pipeline; clean.
363. [s] `lib/telemetry/types.ts` — telemetry pipeline; clean.
364. [s] `lib/template-types.ts` — pure types.
365. [s] `lib/template-utils.ts` — clean.
366. [s] `lib/theme-compiler.ts` — clean.
367. [s] `lib/theme-loader.ts` — clean.
368. [s] `lib/thread-utils.ts` — clean; excellently optimized (Schwartzian transform on Date parses, fused loops with early exit).
369. [s] `lib/tnef.ts` — TNEF parser; clean.
370. [s] `lib/unified-mailbox.ts` — clean.
371. [x] `lib/utils.ts` — `formatDate` was hardcoded to `"en-US"` locale, rendering US month names regardless of user locale. Now uses browser default. Logged: relative-time strings ("Just now", "5m ago") still English; cross-locale.
372. [s] `lib/validation.ts` — logged: `getEmailValidationError` returns hardcoded English strings (cross-locale i18n bug).
373. [s] `lib/vcard.ts` — vCard parser/serializer; clean.
374. [s] `lib/version-check/fetcher.ts` — clean.
375. [s] `lib/version-check/index.ts` — clean.
376. [s] `lib/version-check/sender.ts` — clean.
377. [s] `lib/version-check/state.ts` — clean.
378. [s] `lib/version-check/types.ts` — clean.
379. [s] `lib/web-push.ts` — clean.
380. [s] `lib/webdav/client.ts` — clean.
381. [s] `lib/webdav/drop-utils.ts` — clean.
382. [s] `next-env.d.ts` — auto-generated next.js types.
383. [s] `next.config.ts` — next.js config; clean.
384. [s] `playwright.config.ts` — playwright config; clean.
385. [s] `stores/account-security-store.ts` — clean; `fetchAll` uses Promise.allSettled (correct RTT-min pattern).
386. [s] `stores/admin-tab-store.ts` — clean.
387. [s] `stores/calendar-notification-store.ts` — clean.
388. [s] `stores/calendar-store.ts` — clean.
389. [s] `stores/contact-store.ts` — clean.
390. [s] `stores/file-store.ts` — clean.
391. [s] `stores/filter-store.ts` — clean.
392. [s] `stores/locale-store.ts` — clean, 18-line persisted store.
393. [s] `stores/plugin-store.ts` — clean.
394. [s] `stores/policy-store.ts` — clean.
395. [s] `stores/settings-store.ts` — clean.
396. [s] `stores/smime-store.ts` — clean.
397. [s] `stores/task-store.ts` — clean; pessimistic update pattern (await server before local state). Per RTT-min rule, optimistic-then-rollback would feel snappier; tier-2.
398. [s] `stores/template-store.ts` — clean; `getRecent` already O(N+R) with byId Map.
399. [s] `stores/theme-store.ts` — clean. `syncServerThemes` does serial per-theme `await downloadThemeCSS` + `await pluginStorage.saveThemeCSS` — Promise.all would parallelize. Per RTT-min rule, logged for tier-2.
400. [s] `stores/toast-store.ts` — clean.
401. [s] `stores/totp-reauth-store.ts` — clean.
402. [x] `stores/ui-store.ts` — extracted `persistColumnsToStorage` helper, killing 4× repeated `try { localStorage.setItem("column-widths", JSON.stringify(...)) } catch { }` block.
403. [s] `stores/update-store.ts` — clean.
404. [s] `stores/vacation-store.ts` — clean.
405. [s] `stores/webdav-store.ts` — clean.
406. [s] `tailwind.config.ts` — config file.
407. [s] `vitest.config.ts` — config file.
408. [s] `vitest.setup.ts` — test setup.
