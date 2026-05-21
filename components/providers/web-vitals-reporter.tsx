'use client';

import { useEffect } from 'react';
import { startWebVitalsReporter } from '@/lib/web-vitals-client';

// Mount once at app root. Calls startWebVitalsReporter() in a useEffect so
// the dynamic web-vitals import + observer registration happens AFTER hydration
// and FCP, never on the cold-load critical path.
export function WebVitalsReporter() {
  useEffect(() => {
    // requestIdleCallback if available, else microtask. We want the import
    // to land after FCP but don't care about exact timing.
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    if (ric) {
      ric(() => { void startWebVitalsReporter(); });
    } else {
      setTimeout(() => { void startWebVitalsReporter(); }, 0);
    }
  }, []);
  return null;
}
