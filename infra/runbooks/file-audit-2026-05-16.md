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
 51. [ ] `app/admin/_tabs/dashboard.tsx`
 52. [ ] `app/admin/_tabs/logs.tsx`
 53. [ ] `app/admin/_tabs/marketplace.tsx`
 54. [ ] `app/admin/_tabs/plugin-config-panel.tsx`
 55. [ ] `app/admin/_tabs/plugins.tsx`
 56. [ ] `app/admin/_tabs/policy.tsx`
 57. [ ] `app/admin/_tabs/settings.tsx`
 58. [ ] `app/admin/_tabs/telemetry.tsx`
 59. [ ] `app/admin/_tabs/themes.tsx`
 60. [ ] `app/admin/_tabs/version.tsx`
 61. [ ] `app/admin/auth/page.tsx`
 62. [ ] `app/admin/branding/page.tsx`
 63. [ ] `app/admin/change-password/page.tsx`
 64. [ ] `app/admin/layout.tsx`
 65. [ ] `app/admin/login/page.tsx`
 66. [ ] `app/admin/logs/page.tsx`
 67. [ ] `app/admin/marketplace/[slug]/page.tsx`
 68. [ ] `app/admin/marketplace/page.tsx`
 69. [ ] `app/admin/page.tsx`
 70. [ ] `app/admin/plugins/[id]/page.tsx`
 71. [ ] `app/admin/plugins/page.tsx`
 72. [ ] `app/admin/policy/page.tsx`
 73. [ ] `app/admin/settings/page.tsx`
 74. [ ] `app/admin/telemetry/page.tsx`
 75. [ ] `app/admin/themes/page.tsx`
 76. [ ] `app/admin/version/page.tsx`
 77. [ ] `app/api/account/stalwart/jmap/route.ts`
 78. [ ] `app/api/admin/audit/route.ts`
 79. [ ] `app/api/admin/auth/route.ts`
 80. [ ] `app/api/admin/branding/[filename]/route.ts`
 81. [ ] `app/api/admin/branding/route.ts`
 82. [ ] `app/api/admin/change-password/route.ts`
 83. [ ] `app/api/admin/config/route.ts`
 84. [ ] `app/api/admin/marketplace/[slug]/route.ts`
 85. [ ] `app/api/admin/marketplace/route.ts`
 86. [ ] `app/api/admin/oauth/setup/route.ts`
 87. [ ] `app/api/admin/plugins/[id]/bundle/route.ts`
 88. [ ] `app/api/admin/plugins/[id]/config/route.ts`
 89. [ ] `app/api/admin/plugins/route.ts`
 90. [ ] `app/api/admin/policy/route.ts`
 91. [ ] `app/api/admin/telemetry/route.ts`
 92. [ ] `app/api/admin/themes/[id]/css/route.ts`
 93. [ ] `app/api/admin/themes/route.ts`
 94. [ ] `app/api/admin/version/route.ts`
 95. [ ] `app/api/auth/session/route.ts`
 96. [ ] `app/api/auth/sso/complete/route.ts`
 97. [ ] `app/api/auth/sso/start/route.ts`
 98. [ ] `app/api/auth/stalwart-context/route.ts`
 99. [ ] `app/api/auth/token/route.ts`
100. [ ] `app/api/auth/totp-token-exchange/route.ts`
101. [ ] `app/api/caldav/discover/route.ts`
102. [ ] `app/api/config/route.ts`
103. [ ] `app/api/dev-jmap/[...path]/route.ts`
104. [ ] `app/api/favicon/route.ts`
105. [ ] `app/api/fetch-ical/route.ts`
106. [ ] `app/api/health/route.ts`
107. [ ] `app/api/plugins/route.ts`
108. [ ] `app/api/push/preview/route.ts`
109. [ ] `app/api/pwa-icon/[size]/route.ts`
110. [ ] `app/api/settings/route.ts`
111. [ ] `app/api/setup/branding/route.ts`
112. [ ] `app/api/setup/finish/route.ts`
113. [ ] `app/api/setup/status/route.ts`
114. [ ] `app/api/setup/step/route.ts`
115. [ ] `app/api/setup/test-jmap/route.ts`
116. [ ] `app/api/setup/token/route.ts`
117. [ ] `app/api/system/update-status/route.ts`
118. [ ] `app/api/webdav/route.ts`
119. [ ] `app/global-error.tsx`
120. [ ] `app/manifest.ts`
121. [ ] `app/not-found.tsx`
122. [ ] `app/protocol/mailto/page.tsx`
123. [ ] `app/protocol/webcal/page.tsx`
124. [ ] `app/setup/layout.tsx`
125. [ ] `app/setup/page.tsx`
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
173. [ ] `components/error/error-boundary.tsx`
174. [ ] `components/error/error-fallbacks.tsx`
175. [ ] `components/error/index.ts`
176. [x] `components/files/file-browser.tsx` — **real memory-leak fix** in `Thumbnail` subcomponent: `getImageUrl` returns a `URL.createObjectURL` blob URL, but the effect's cleanup only flipped `cancelled` and never called `URL.revokeObjectURL`. Every thumbnail re-mount, `name` change, or modal close leaked a blob URL — a folder of N images leaked N URLs per re-render. Now revokes on cancel and on unmount. Same `acquired/cancelled` race-guard pattern as the image-preview-modal fix in this batch.
177. [s] `components/files/file-preview-modal.tsx` — clean. Already does the correct race-guard pattern (cancelled flag + late assignment), so the analogous bug doesn't exist here.
178. [s] `components/files/file-upload-area.tsx` — 88 lines, clean drop-zone.
179. [s] `components/files/files-settings-dialog.tsx` — clean (escape + click-outside handlers).
180. [s] `components/files/folder-tree-sidebar.tsx` — clean; `loadChildren` has `childrenCache` dep but the closure consistency is maintained.
181. [x] `components/files/image-preview-modal.tsx` — **real memory-leak fix**: the effect captured `revoke` in the outer scope and only assigned it inside `.then`, but cleanup ran with `revoke === null` whenever the user closed the modal (or changed `name`) before `getImageUrl` resolved. The pending `.then` then assigned the URL but cleanup had already run — orphaned blob URL. Race-guarded with `cancelled` + `acquiredUrl` so the late-resolve path revokes immediately when cancelled.
182. [s] `components/files/new-folder-dialog.tsx` — clean (escape handler missing but click-outside via overlay works).
183. [s] `components/files/rename-dialog.tsx` — clean. Near-duplicate of new-folder-dialog; tier-2 DRY opportunity.
184. [ ] `components/filters/filter-rule-modal.tsx`
185. [ ] `components/filters/sieve-editor-modal.tsx`
186. [ ] `components/identity/identity-form.tsx`
187. [ ] `components/identity/identity-manager-modal.tsx`
188. [ ] `components/identity/sub-address-helper.tsx`
189. [ ] `components/keyboard-shortcuts-modal.tsx`
190. [ ] `components/layout/account-switcher.tsx`
191. [ ] `components/layout/icon-picker.tsx`
192. [ ] `components/layout/inline-app-view.tsx`
193. [ ] `components/layout/mailbox-context-menu.tsx`
194. [ ] `components/layout/resize-handle.tsx`
195. [ ] `components/layout/sidebar-apps-modal.tsx`
196. [ ] `components/plugins/plugin-error-boundary.tsx`
197. [ ] `components/plugins/plugin-slot-renderer.tsx`
198. [ ] `components/plugins/plugin-slot.tsx`
199. [ ] `components/protocol/mailto-protocol-client.tsx`
200. [ ] `components/protocol/protocol-account-picker.tsx`
201. [ ] `components/protocol/protocol-launch-handler-provider.tsx`
202. [ ] `components/protocol/webcal-protocol-client.tsx`
203. [ ] `components/providers/calendar-alert-provider.tsx`
204. [ ] `components/providers/embedded-bridge-provider.tsx`
205. [ ] `components/providers/intl-provider.tsx`
206. [ ] `components/providers/rate-limit-toast-provider.tsx`
207. [ ] `components/providers/theme-provider.tsx`
208. [ ] `components/pwa-install-prompt.tsx`
209. [ ] `components/search/advanced-search-panel.tsx`
210. [ ] `components/search/search-chips.tsx`
211. [ ] `components/service-worker-registration.tsx`
212. [ ] `components/settings/about-data-settings.tsx`
213. [ ] `components/settings/account-security-settings.tsx`
214. [ ] `components/settings/account-settings.tsx`
215. [ ] `components/settings/address-book-management-settings.tsx`
216. [ ] `components/settings/appearance-settings.tsx`
217. [ ] `components/settings/calendar-management-settings.tsx`
218. [ ] `components/settings/calendar-settings.tsx`
219. [ ] `components/settings/composing-settings.tsx`
220. [ ] `components/settings/contacts-settings.tsx`
221. [ ] `components/settings/content-senders-settings.tsx`
222. [ ] `components/settings/debug-settings.tsx`
223. [ ] `components/settings/files-settings.tsx`
224. [ ] `components/settings/filter-settings.tsx`
225. [ ] `components/settings/folder-settings.tsx`
226. [ ] `components/settings/identity-settings.tsx`
227. [ ] `components/settings/keyword-settings.tsx`
228. [ ] `components/settings/language-settings.tsx`
229. [ ] `components/settings/layout-settings.tsx`
230. [ ] `components/settings/notification-settings.tsx`
231. [ ] `components/settings/plugins-settings.tsx`
232. [ ] `components/settings/protocol-handler-settings.tsx`
233. [ ] `components/settings/reading-settings.tsx`
234. [ ] `components/settings/settings-section.tsx`
235. [ ] `components/settings/share-collection-dialog.tsx`
236. [ ] `components/settings/sidebar-apps-settings.tsx`
237. [ ] `components/settings/smime-certificate-modal.tsx`
238. [ ] `components/settings/smime-passphrase-dialog.tsx`
239. [ ] `components/settings/smime-settings.tsx`
240. [ ] `components/settings/spam-siege-game.tsx`
241. [ ] `components/settings/template-settings.tsx`
242. [ ] `components/settings/themes-settings.tsx`
243. [ ] `components/settings/vacation-settings.tsx`
244. [ ] `components/templates/placeholder-fill-modal.tsx`
245. [ ] `components/templates/template-form.tsx`
246. [ ] `components/templates/template-manager-modal.tsx`
247. [ ] `components/templates/template-picker.tsx`
248. [ ] `components/totp-reauth-dialog.tsx`
249. [ ] `components/tour/tour-overlay.tsx`
250. [ ] `components/tour/tour-provider.tsx`
251. [ ] `components/tour/tour-steps.ts`
252. [ ] `components/trusted-senders-modal.tsx`
253. [ ] `components/ui/avatar.tsx`
254. [ ] `components/ui/button.tsx`
255. [ ] `components/ui/confirm-dialog.tsx`
256. [ ] `components/ui/context-menu.tsx`
257. [ ] `components/ui/flag-icons.tsx`
258. [ ] `components/ui/input.tsx`
259. [ ] `components/ui/language-switcher.tsx`
260. [ ] `components/ui/prompt-dialog.tsx`
261. [ ] `components/ui/toast.tsx`
262. [ ] `components/ui/welcome-banner.tsx`
263. [ ] `contexts/drag-drop-context.tsx`
264. [ ] `hooks/use-attachment-drag.ts`
265. [ ] `hooks/use-browser-navigation.ts`
266. [ ] `hooks/use-calendar-alerts.ts`
267. [ ] `hooks/use-confirm-dialog.ts`
268. [ ] `hooks/use-context-menu.ts`
269. [ ] `hooks/use-email-drag.ts`
270. [ ] `hooks/use-focus-trap.ts`
271. [ ] `hooks/use-format-event-date.ts`
272. [ ] `hooks/use-keyboard-shortcuts.ts`
273. [ ] `hooks/use-long-press.ts`
274. [ ] `hooks/use-mailbox-drop.ts`
275. [ ] `hooks/use-media-query.ts`
276. [ ] `hooks/use-prompt-dialog.ts`
277. [ ] `hooks/use-refresh-gesture.ts`
278. [ ] `hooks/use-sidebar-apps.ts`
279. [ ] `hooks/use-tag-drop.ts`
280. [ ] `hooks/use-time-grid-interactions.ts`
281. [ ] `i18n/navigation.ts`
282. [ ] `i18n/request.ts`
283. [ ] `i18n/routing.ts`
284. [ ] `instrumentation.node.ts`
285. [ ] `instrumentation.ts`
286. [ ] `lib/admin/audit.ts`
287. [ ] `lib/admin/csp-frame-origins.ts`
288. [ ] `lib/admin/jmap-servers.ts`
289. [ ] `lib/admin/migrate.ts`
290. [ ] `lib/admin/password.ts`
291. [ ] `lib/admin/paths.ts`
292. [ ] `lib/admin/plugin-config.ts`
293. [ ] `lib/admin/plugin-dev.ts`
294. [ ] `lib/admin/plugin-registry.ts`
295. [ ] `lib/admin/rate-limit.ts`
296. [ ] `lib/admin/session.ts`
297. [ ] `lib/admin/types.ts`
298. [ ] `lib/birthday-calendar.ts`
299. [ ] `lib/builtin-themes.ts`
300. [ ] `lib/calendar-alerts.ts`
301. [ ] `lib/calendar-event-normalization.ts`
302. [ ] `lib/calendar-ics-export.ts`
303. [ ] `lib/calendar-invitation.ts`
304. [ ] `lib/calendar-participants.ts`
305. [ ] `lib/calendar-utils.ts`
306. [ ] `lib/color-transform.ts`
307. [ ] `lib/debug.ts`
308. [ ] `lib/demo/demo-client.ts`
309. [ ] `lib/demo/demo-data.ts`
310. [ ] `lib/demo/demo-utils.ts`
311. [ ] `lib/email-composer-utils.ts`
312. [ ] `lib/error-reporting.ts`
313. [ ] `lib/file-preview.ts`
314. [ ] `lib/iframe-bridge.ts`
315. [ ] `lib/jmap/sieve-types.ts`
316. [ ] `lib/logger.ts`
317. [ ] `lib/notification-sound.ts`
318. [ ] `lib/oauth/cookie-config.ts`
319. [ ] `lib/oauth/discovery.ts`
320. [ ] `lib/oauth/pkce-server.ts`
321. [ ] `lib/oauth/pkce.ts`
322. [ ] `lib/oauth/token-exchange.ts`
323. [ ] `lib/oauth/tokens.ts`
324. [ ] `lib/plugin-api.ts`
325. [ ] `lib/plugin-hooks.ts`
326. [ ] `lib/plugin-i18n.ts`
327. [ ] `lib/plugin-loader.ts`
328. [ ] `lib/plugin-projection.ts`
329. [ ] `lib/plugin-storage.ts`
330. [ ] `lib/plugin-types.ts`
331. [ ] `lib/plugin-validator.ts`
332. [ ] `lib/protocol-handlers/mailto.ts`
333. [ ] `lib/protocol-handlers/session.ts`
334. [ ] `lib/protocol-handlers/webcal.ts`
335. [ ] `lib/read-file-env.ts`
336. [ ] `lib/recurrence-expansion.ts`
337. [ ] `lib/reply-identity.ts`
338. [ ] `lib/security/url-guard.ts`
339. [ ] `lib/settings-sync.ts`
340. [ ] `lib/setup/session.ts`
341. [ ] `lib/setup/state.ts`
342. [ ] `lib/setup/token.ts`
343. [ ] `lib/sieve/generator.ts`
344. [ ] `lib/sieve/parser.ts`
345. [ ] `lib/signature-utils.ts`
346. [ ] `lib/smime/key-storage.ts`
347. [ ] `lib/smime/mime-builder.ts`
348. [ ] `lib/smime/pkcs12-export.ts`
349. [ ] `lib/smime/smime-detect.ts`
350. [ ] `lib/smime/smime-encrypt.ts`
351. [ ] `lib/smime/smime-sign.ts`
352. [ ] `lib/smime/types.ts`
353. [ ] `lib/stalwart/auth-context.ts`
354. [ ] `lib/stalwart/credentials.ts`
355. [ ] `lib/stalwart/jmap-passthrough.ts`
356. [ ] `lib/sub-addressing.ts`
357. [ ] `lib/telemetry/endpoint-guard.ts`
358. [ ] `lib/telemetry/index.ts`
359. [ ] `lib/telemetry/login-tracker.ts`
360. [ ] `lib/telemetry/payload.ts`
361. [ ] `lib/telemetry/sender.ts`
362. [ ] `lib/telemetry/state.ts`
363. [ ] `lib/telemetry/types.ts`
364. [ ] `lib/template-types.ts`
365. [ ] `lib/template-utils.ts`
366. [ ] `lib/theme-compiler.ts`
367. [ ] `lib/theme-loader.ts`
368. [ ] `lib/thread-utils.ts`
369. [ ] `lib/tnef.ts`
370. [ ] `lib/unified-mailbox.ts`
371. [ ] `lib/utils.ts`
372. [ ] `lib/validation.ts`
373. [ ] `lib/vcard.ts`
374. [ ] `lib/version-check/fetcher.ts`
375. [ ] `lib/version-check/index.ts`
376. [ ] `lib/version-check/sender.ts`
377. [ ] `lib/version-check/state.ts`
378. [ ] `lib/version-check/types.ts`
379. [ ] `lib/web-push.ts`
380. [ ] `lib/webdav/client.ts`
381. [ ] `lib/webdav/drop-utils.ts`
382. [ ] `next-env.d.ts`
383. [ ] `next.config.ts`
384. [ ] `playwright.config.ts`
385. [ ] `stores/account-security-store.ts`
386. [ ] `stores/admin-tab-store.ts`
387. [ ] `stores/calendar-notification-store.ts`
388. [ ] `stores/calendar-store.ts`
389. [ ] `stores/contact-store.ts`
390. [ ] `stores/file-store.ts`
391. [ ] `stores/filter-store.ts`
392. [ ] `stores/locale-store.ts`
393. [ ] `stores/plugin-store.ts`
394. [ ] `stores/policy-store.ts`
395. [ ] `stores/settings-store.ts`
396. [ ] `stores/smime-store.ts`
397. [ ] `stores/task-store.ts`
398. [ ] `stores/template-store.ts`
399. [ ] `stores/theme-store.ts`
400. [ ] `stores/toast-store.ts`
401. [ ] `stores/totp-reauth-store.ts`
402. [ ] `stores/ui-store.ts`
403. [ ] `stores/update-store.ts`
404. [ ] `stores/vacation-store.ts`
405. [ ] `stores/webdav-store.ts`
406. [ ] `tailwind.config.ts`
407. [ ] `vitest.config.ts`
408. [ ] `vitest.setup.ts`
