// CLS source diagnosis for the demo-inbox flow.
//
// Captures every layout-shift entry along with its `sources[]` — the actual
// nodes that moved, their previous/current rects, and a recognizable
// selector. Prints them in time order with the cumulative running total so
// you can see which shifts contribute to the total CLS.
//
// REQUIRES DEMO_MODE=true on the target deploy.

import { chromium } from 'playwright';

const BASE = process.env.PERF_BASE || 'https://webmail.saltnlightllc.com';
const HEADLESS = process.env.HEADLESS !== 'false';

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  await context.addInitScript(() => {
    window.__cls = { entries: [], total: 0, startTs: performance.now() };
    const describe = (node) => {
      if (!node) return { tag: null };
      if (node.nodeType !== 1) return { tag: '#text-or-other' };
      const tag = node.tagName.toLowerCase();
      const id = node.id || null;
      const cls = (node.className && typeof node.className === 'string')
        ? node.className.split(/\s+/).filter(Boolean).slice(0, 4).join('.')
        : null;
      const dataAttrs = [];
      for (const a of node.attributes || []) {
        if (a.name.startsWith('data-')) dataAttrs.push(`${a.name}=${a.value.slice(0, 20)}`);
      }
      let role = node.getAttribute && node.getAttribute('role');
      let ariaLabel = node.getAttribute && node.getAttribute('aria-label');
      let text = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      return {
        tag,
        id,
        cls,
        role,
        ariaLabel,
        dataAttrs: dataAttrs.length ? dataAttrs.join(',') : null,
        text: text || null,
      };
    };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          const sources = (e.sources || []).map((s) => ({
            node: describe(s.node),
            prev: s.previousRect && { x: Math.round(s.previousRect.x), y: Math.round(s.previousRect.y), w: Math.round(s.previousRect.width), h: Math.round(s.previousRect.height) },
            cur: s.currentRect && { x: Math.round(s.currentRect.x), y: Math.round(s.currentRect.y), w: Math.round(s.currentRect.width), h: Math.round(s.currentRect.height) },
            dy: s.currentRect && s.previousRect ? Math.round(s.currentRect.y - s.previousRect.y) : null,
            dx: s.currentRect && s.previousRect ? Math.round(s.currentRect.x - s.previousRect.x) : null,
          }));
          window.__cls.total += e.value;
          window.__cls.entries.push({
            t: Math.round(e.startTime - window.__cls.startTs),
            value: e.value,
            running: window.__cls.total,
            sources,
          });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
  });

  console.log(`Navigating to ${BASE}/en/login...`);
  await page.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });

  const demoButton = page.getByRole('button', { name: /demo/i }).first();
  await demoButton.waitFor({ timeout: 10_000 });
  await demoButton.click();
  console.log('Clicked demo. Waiting for inbox...');

  await page.waitForFunction(
    () => !location.pathname.includes('/login'),
    { timeout: 30_000 }
  );
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const result = await page.evaluate(() => window.__cls);

  console.log(`\n=== CLS summary ===`);
  console.log(`Total CLS: ${result.total.toFixed(4)} (${result.entries.length} shift entries)`);
  console.log(`\n=== Shifts in time order ===`);
  for (const e of result.entries) {
    console.log(`\nt+${e.t}ms  value=${e.value.toFixed(5)}  running=${e.running.toFixed(4)}`);
    for (let i = 0; i < e.sources.length; i++) {
      const s = e.sources[i];
      const n = s.node;
      const sel = [n.tag, n.id ? `#${n.id}` : '', n.cls ? `.${n.cls}` : '', n.role ? `[role=${n.role}]` : '', n.ariaLabel ? `[aria-label="${n.ariaLabel}"]` : '', n.dataAttrs ? `[${n.dataAttrs}]` : ''].join('');
      console.log(`  src${i}: ${sel}`);
      if (n.text) console.log(`        text: "${n.text}"`);
      if (s.prev && s.cur) {
        console.log(`        prev (${s.prev.x},${s.prev.y}) ${s.prev.w}x${s.prev.h}`);
        console.log(`        cur  (${s.cur.x},${s.cur.y}) ${s.cur.w}x${s.cur.h}    dy=${s.dy} dx=${s.dx}`);
      }
    }
  }

  await browser.close();
}

run().catch((err) => {
  console.error('Diagnose failed:', err);
  process.exit(1);
});
