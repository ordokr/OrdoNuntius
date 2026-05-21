// Inbox interaction-perf measurement. REQUIRES DEMO_MODE=true on the target
// deploy — without it, the "Try demo" button isn't rendered and the script
// can't reach an inbox. To use against the saltnlight prod deploy, see
// scripts/perf/README.md for the temporary-DEMO_MODE flip procedure.
//
// Flow: login page → click "Try demo" → wait for inbox → scroll → click email.
// Captures FCP / LCP / CLS, long-task time, event-timing duration buckets.
//
// Usage:
//   node scripts/perf/measure-inbox.mjs
//   PERF_BASE=https://staging.example.com node scripts/perf/measure-inbox.mjs
//   HEADLESS=false node scripts/perf/measure-inbox.mjs

import { chromium } from 'playwright';

const BASE = process.env.PERF_BASE || 'https://webmail.saltnlightllc.com';
const HEADLESS = process.env.HEADLESS !== 'false';

function fmt(n) { return n == null ? 'n/a' : `${Math.round(n)}ms`; }

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  await context.addInitScript(() => {
    window.__perf = { longTasks: [], eventTimings: [], lcp: null, fcp: null, cls: 0, marks: {} };
    window.__mark = (name) => { window.__perf.marks[name] = performance.now(); };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__perf.longTasks.push({ startTime: e.startTime, duration: e.duration });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__perf.eventTimings.push({
            name: e.name,
            startTime: e.startTime,
            processingStart: e.processingStart,
            duration: e.duration,
          });
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) window.__perf.lcp = entries[entries.length - 1].startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime;
        }
      }).observe({ type: 'paint', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) window.__perf.cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
  });

  console.log(`Navigating to ${BASE}/en/login...`);
  await page.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });

  // Click "Try demo" button. Demo-only-mode shows just one big button.
  console.log('Clicking demo button...');
  const demoButton = page.getByRole('button', { name: /demo/i }).first();
  await demoButton.waitFor({ timeout: 10_000 });

  await page.evaluate(() => window.__mark('demo-click'));
  const t0 = Date.now();
  await demoButton.click();

  // Wait for inbox URL (root or /en root). Demo login redirects to "/" which
  // the locale middleware then sends to "/en".
  await page.waitForFunction(
    () => /\/(en|fr|de|es|it|pt|nl|ja|zh|ko|ru|pl|cs|sv|fi|da|nb|tr|ar|he|hi)\/?$/.test(location.pathname) || location.pathname === '/',
    { timeout: 30_000 }
  );
  // Now also wait until the URL is no longer the login page.
  await page.waitForFunction(
    () => !location.pathname.includes('/login'),
    { timeout: 30_000 }
  );
  console.log(`  URL settled in ${Date.now() - t0}ms (now ${page.url()})`);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
    console.log('  networkidle timed out (push connection probably) — continuing');
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__mark('inbox-ready'));
  console.log(`  Inbox settled in ${Date.now() - t0}ms`);

  // Capture inbox-mount metrics.
  const inboxMount = await page.evaluate(() => ({
    fcp: window.__perf.fcp,
    lcp: window.__perf.lcp,
    cls: window.__perf.cls,
    longTaskCount: window.__perf.longTasks.length,
    longTaskTotalMs: window.__perf.longTasks.reduce((a, t) => a + t.duration, 0),
    longTaskMaxMs: window.__perf.longTasks.reduce((m, t) => Math.max(m, t.duration), 0),
    timeToInboxReadyMs: window.__perf.marks['inbox-ready'] - window.__perf.marks['demo-click'],
  }));

  // Find the scrollable email-list container by probing the DOM for the
  // tallest overflow-y:auto/scroll element. Save it on window for reuse.
  console.log('Locating email list scroll container...');
  const containerFound = await page.evaluate(() => {
    let best = null;
    let bestDelta = 0;
    document.querySelectorAll('div').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height < 200) return;
      const s = getComputedStyle(el);
      if (!/auto|scroll/.test(s.overflowY)) return;
      const delta = el.scrollHeight - el.clientHeight;
      if (delta > bestDelta) { bestDelta = delta; best = el; }
    });
    if (!best) return { ok: false };
    window.__scrollEl = best;
    return { ok: true, scrollDelta: bestDelta, height: best.clientHeight, top: best.getBoundingClientRect().top };
  });
  console.log('  container:', containerFound);

  // Scroll the email list in 8 steps with rAF gating.
  console.log('Scrolling email list (8 steps)...');
  const scrollResult = await page.evaluate(() => {
    const el = window.__scrollEl;
    if (!el) return { ok: false, reason: 'no container' };
    const beforeTaskCount = window.__perf.longTasks.length;
    const beforeEventCount = window.__perf.eventTimings.length;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const steps = 8;
      let i = 0;
      const step = () => {
        if (i++ >= steps) {
          const t1 = performance.now();
          const newTasks = window.__perf.longTasks.slice(beforeTaskCount);
          const newEvents = window.__perf.eventTimings.slice(beforeEventCount);
          resolve({
            ok: true,
            elapsedMs: t1 - t0,
            taskCount: newTasks.length,
            totalBlockedMs: newTasks.reduce((a, t) => a + t.duration, 0),
            maxTaskMs: newTasks.reduce((m, t) => Math.max(m, t.duration), 0),
            eventCount: newEvents.length,
            worstEventMs: newEvents.reduce((m, e) => Math.max(m, e.duration), 0),
          });
          return;
        }
        el.scrollTop = (el.scrollHeight - el.clientHeight) * (i / steps);
        requestAnimationFrame(() => setTimeout(step, 120));
      };
      step();
    });
  });
  console.log('  scroll:', scrollResult);

  // Scroll back to top so the first row is clickable.
  await page.evaluate(() => { window.__scrollEl && (window.__scrollEl.scrollTop = 0); });
  await page.waitForTimeout(300);

  // Click the first visible row in the email list (within the scroll container).
  console.log('Clicking first email row...');
  const clickResult = await page.evaluate(async () => {
    const el = window.__scrollEl;
    if (!el) return { ok: false, reason: 'no container' };
    const containerRect = el.getBoundingClientRect();
    // Find the topmost clickable child whose top edge is within the visible
    // area of the scroll container. Try descendants that are role=button or
    // have a click handler (cursor-pointer / cursor:pointer style).
    const candidates = el.querySelectorAll('[role="button"], [class*="cursor-pointer"]');
    let target = null;
    for (const c of candidates) {
      const r = c.getBoundingClientRect();
      if (r.height < 30 || r.height > 200) continue;
      if (r.width < 200) continue;
      if (r.top < containerRect.top || r.top > containerRect.top + 200) continue;
      target = c;
      break;
    }
    if (!target) return { ok: false, reason: 'no clickable row found' };
    const beforeEventCount = window.__perf.eventTimings.length;
    const beforeTaskCount = window.__perf.longTasks.length;
    const t0 = performance.now();
    target.click();
    // Wait two rAF + 500ms for the viewer to paint.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 800));
    const t1 = performance.now();
    const newEvents = window.__perf.eventTimings.slice(beforeEventCount);
    const newTasks = window.__perf.longTasks.slice(beforeTaskCount);
    const clickEvents = newEvents.filter((e) =>
      e.name === 'click' || e.name === 'pointerdown' || e.name === 'pointerup' || e.name === 'mousedown' || e.name === 'mouseup'
    );
    return {
      ok: true,
      clickToSecondPaintMs: t1 - t0,
      worstClickEventMs: clickEvents.reduce((m, e) => Math.max(m, e.duration), 0),
      clickEventCount: clickEvents.length,
      followUpTaskCount: newTasks.length,
      followUpBlockedMs: newTasks.reduce((a, t) => a + t.duration, 0),
      followUpMaxTaskMs: newTasks.reduce((m, t) => Math.max(m, t.duration), 0),
    };
  });
  console.log('  click:', clickResult);

  // Final snapshot.
  const final = await page.evaluate(() => ({
    longTaskCount: window.__perf.longTasks.length,
    longTaskTotalMs: window.__perf.longTasks.reduce((a, t) => a + t.duration, 0),
    longTaskMaxMs: window.__perf.longTasks.reduce((m, t) => Math.max(m, t.duration), 0),
    eventTimingCount: window.__perf.eventTimings.length,
    eventP98Ms: (() => {
      const ds = window.__perf.eventTimings.map((e) => e.duration).sort((a, b) => a - b);
      if (!ds.length) return null;
      return ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.98))];
    })(),
    lcp: window.__perf.lcp,
    fcp: window.__perf.fcp,
    cls: window.__perf.cls,
  }));

  console.log('\n=== Demo-click → inbox-ready ===');
  console.log(`Time to ready  : ${fmt(inboxMount.timeToInboxReadyMs)}`);
  console.log(`FCP            : ${fmt(inboxMount.fcp)}`);
  console.log(`LCP            : ${fmt(inboxMount.lcp)}`);
  console.log(`CLS at ready   : ${inboxMount.cls.toFixed(4)}`);
  console.log(`Long tasks     : ${inboxMount.longTaskCount} (total ${fmt(inboxMount.longTaskTotalMs)}, max ${fmt(inboxMount.longTaskMaxMs)})`);
  console.log('\n=== Scroll (8 steps, ~1s wallclock) ===');
  if (scrollResult.ok) {
    console.log(`Elapsed        : ${fmt(scrollResult.elapsedMs)}`);
    console.log(`Long tasks     : ${scrollResult.taskCount} (total ${fmt(scrollResult.totalBlockedMs)}, max ${fmt(scrollResult.maxTaskMs)})`);
    console.log(`Event timings  : ${scrollResult.eventCount} (worst ${fmt(scrollResult.worstEventMs)})`);
  } else {
    console.log(`  failed: ${scrollResult.reason}`);
  }
  console.log('\n=== Click first email → viewer ===');
  if (clickResult.ok) {
    console.log(`Click→2 frames+800ms : ${fmt(clickResult.clickToSecondPaintMs)}`);
    console.log(`Worst click event   : ${fmt(clickResult.worstClickEventMs)} (${clickResult.clickEventCount} events)`);
    console.log(`Follow-up long tasks: ${clickResult.followUpTaskCount} (total ${fmt(clickResult.followUpBlockedMs)}, max ${fmt(clickResult.followUpMaxTaskMs)})`);
  } else {
    console.log(`  failed: ${clickResult.reason}`);
  }
  console.log('\n=== Final cumulative ===');
  console.log(`Total event timings: ${final.eventTimingCount} (p98 ${fmt(final.eventP98Ms)})`);
  console.log(`Total long tasks   : ${final.longTaskCount} (total ${fmt(final.longTaskTotalMs)}, max ${fmt(final.longTaskMaxMs)})`);
  console.log(`Final CLS          : ${final.cls.toFixed(4)}`);

  await browser.close();
}

run().catch((err) => {
  console.error('Measurement failed:', err);
  process.exit(1);
});
