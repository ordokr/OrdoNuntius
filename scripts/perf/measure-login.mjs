// Synthetic interaction-perf measurement against the deployed login page.
// Captures FCP / LCP / CLS at mount, long-task totals, and event-timing
// duration buckets for synthetic keystroke input. Useful for catching
// keystroke-side-effect regressions without needing auth.
//
// Usage:
//   node scripts/perf/measure-login.mjs                  # against default BASE
//   PERF_BASE=https://staging.example.com node scripts/perf/measure-login.mjs
//   HEADLESS=false node scripts/perf/measure-login.mjs   # show the browser
//
// Run multiple times — first run is cold (JIT warmup + CDN cold cache) and
// often shows a 100-200ms outlier keystroke. Steady-state baselines from
// runs 2-3 are the meaningful numbers.

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
    window.__perf = { longTasks: [], eventTimings: [], lcp: null, fcp: null, cls: 0 };
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
  const navStart = Date.now();
  await page.goto(`${BASE}/en/login`, { waitUntil: 'load' });
  console.log(`  Load in ${Date.now() - navStart}ms`);

  // Let the page settle (i18n, theme menu, OAuth discovery, server lookup,
  // update polling — the login page legitimately does a lot on mount).
  await page.waitForTimeout(2000);

  // Capture mount-phase metrics.
  const afterMount = await page.evaluate(() => ({
    fcp: window.__perf.fcp,
    lcp: window.__perf.lcp,
    cls: window.__perf.cls,
    longTaskCount: window.__perf.longTasks.length,
    longTaskTotalMs: window.__perf.longTasks.reduce((a, t) => a + t.duration, 0),
    longTaskMaxMs: window.__perf.longTasks.reduce((m, t) => Math.max(m, t.duration), 0),
  }));

  // Typing interaction: focus the email field, type a username.
  // This stresses the same controlled-input path the composer uses.
  console.log('Typing into username field...');
  const typingStart = await page.evaluate(() => {
    window.__beforeTypingEventCount = window.__perf.eventTimings.length;
    window.__beforeTypingTaskCount = window.__perf.longTasks.length;
    return performance.now();
  });

  // Find the username input by aria/role, fall back to first visible textbox.
  const usernameField = page.locator('input[type="email"], input[type="text"], input[name*="user" i]').first();
  await usernameField.waitFor({ timeout: 5_000 });
  await usernameField.click();
  await usernameField.fill(''); // ensure clean
  await usernameField.pressSequentially('typingtest@example.com', { delay: 30 });
  await page.waitForTimeout(500);

  const typingResult = await page.evaluate((start) => {
    const newEvents = window.__perf.eventTimings.slice(window.__beforeTypingEventCount);
    const newTasks = window.__perf.longTasks.slice(window.__beforeTypingTaskCount);
    const keyEvents = newEvents.filter((e) =>
      e.name === 'keydown' || e.name === 'keyup' || e.name === 'input'
    );
    const ds = keyEvents.map((e) => e.duration).sort((a, b) => a - b);
    const p98 = ds.length ? ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.98))] : null;
    // Bucket keystrokes by duration to see the distribution shape.
    const buckets = { '<16': 0, '16-32': 0, '32-64': 0, '64-128': 0, '128-256': 0, '>256': 0 };
    for (const e of keyEvents) {
      const d = e.duration;
      if (d < 16) buckets['<16']++;
      else if (d < 32) buckets['16-32']++;
      else if (d < 64) buckets['32-64']++;
      else if (d < 128) buckets['64-128']++;
      else if (d < 256) buckets['128-256']++;
      else buckets['>256']++;
    }
    // Time-ordered list of any keystroke over 32ms (start-time relative to first event).
    const t0 = keyEvents.length ? keyEvents[0].startTime : 0;
    const slowEvents = keyEvents
      .filter((e) => e.duration > 32)
      .map((e) => ({
        name: e.name,
        t: Math.round(e.startTime - t0),
        ms: Math.round(e.duration),
      }));
    return {
      elapsedMs: performance.now() - start,
      keyEventCount: keyEvents.length,
      worstKeyEventMs: keyEvents.reduce((m, e) => Math.max(m, e.duration), 0),
      p98KeyEventMs: p98,
      buckets,
      slowEvents,
      newLongTaskCount: newTasks.length,
      newLongTaskTotalMs: newTasks.reduce((a, t) => a + t.duration, 0),
    };
  }, typingStart);

  // Click the password field, type a password.
  console.log('Tabbing to password + typing...');
  const passwordField = page.locator('input[type="password"]').first();
  if (await passwordField.count() > 0) {
    await passwordField.click();
    const beforePwd = await page.evaluate(() => window.__perf.eventTimings.length);
    await passwordField.pressSequentially('testpassword123', { delay: 30 });
    await page.waitForTimeout(300);
    const pwdResult = await page.evaluate((before) => {
      const newEvents = window.__perf.eventTimings.slice(before);
      const keyEvents = newEvents.filter((e) =>
        e.name === 'keydown' || e.name === 'keyup' || e.name === 'input'
      );
      return {
        keyEventCount: keyEvents.length,
        worstKeyEventMs: keyEvents.reduce((m, e) => Math.max(m, e.duration), 0),
      };
    }, beforePwd);
    typingResult.passwordKeystrokes = pwdResult;
  }

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

  console.log('\n=== Mount phase (login page, 2s after load) ===');
  console.log(`FCP            : ${fmt(afterMount.fcp)}`);
  console.log(`LCP            : ${fmt(afterMount.lcp)}`);
  console.log(`CLS            : ${afterMount.cls.toFixed(4)}`);
  console.log(`Long tasks     : ${afterMount.longTaskCount} (total ${fmt(afterMount.longTaskTotalMs)}, max ${fmt(afterMount.longTaskMaxMs)})`);
  console.log('\n=== Typing interaction (username field, 23 chars @ 30ms) ===');
  console.log(`Key events     : ${typingResult.keyEventCount}`);
  console.log(`Worst keystroke: ${fmt(typingResult.worstKeyEventMs)}`);
  console.log(`p98 keystroke  : ${fmt(typingResult.p98KeyEventMs)}`);
  console.log(`Buckets        : ${JSON.stringify(typingResult.buckets)}`);
  if (typingResult.slowEvents.length) {
    console.log(`Slow (>32ms)   :`);
    for (const e of typingResult.slowEvents) {
      console.log(`  ${String(e.t).padStart(5)}ms after first: ${e.name.padEnd(8)} ${e.ms}ms`);
    }
  }
  console.log(`Long tasks     : ${typingResult.newLongTaskCount} (total ${fmt(typingResult.newLongTaskTotalMs)})`);
  if (typingResult.passwordKeystrokes) {
    console.log(`Password worst : ${fmt(typingResult.passwordKeystrokes.worstKeyEventMs)} (${typingResult.passwordKeystrokes.keyEventCount} events)`);
  }
  console.log('\n=== Final cumulative ===');
  console.log(`Total event timings: ${final.eventTimingCount} (p98 ${fmt(final.eventP98Ms)})`);
  console.log(`Total long tasks   : ${final.longTaskCount} (total ${fmt(final.longTaskTotalMs)})`);
  console.log(`Final CLS          : ${final.cls.toFixed(4)}`);

  await browser.close();
}

run().catch((err) => {
  console.error('Measurement failed:', err);
  process.exit(1);
});
