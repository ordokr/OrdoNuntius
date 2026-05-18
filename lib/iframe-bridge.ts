const PARENT_ORIGIN = typeof window !== 'undefined'
  ? (document.querySelector('meta[name="parent-origin"]')?.getAttribute('content') || '')
  : '';

export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function notifyParent(type: string, payload: Record<string, unknown> = {}) {
  if (!isEmbedded()) return;

  // Refuse to broadcast. Previously this fell back to `targetOrigin =
  // '*'` when no <meta name="parent-origin"> was configured — meaning
  // any cross-origin parent frame embedding this app could receive
  // session events (sso:logout, sso:session-expired, etc.) along with
  // any payload metadata. The deployment-configured allowlist is the
  // contract; without it we have no caller intent to trust, so we
  // drop the message rather than leak.
  if (!PARENT_ORIGIN) return;

  try {
    window.parent.postMessage({ source: 'ordo-nuntius', type, ...payload }, PARENT_ORIGIN);
  } catch {
    // Cross-origin postMessage may fail in restricted contexts
  }
}

export function listenFromParent(
  handler: (msg: { type: string; [k: string]: unknown }) => void,
  allowedOrigin?: string,
): () => void {
  // Without a configured allowedOrigin we have no trust anchor — any
  // frame on the page can fire `postMessage({source:'portal'},'*')` and
  // trigger handlers like sso:trigger-logout. Refuse to register the
  // listener at all in that case so the contract is fail-closed.
  if (!allowedOrigin) {
    return () => {};
  }

  const listener = (event: MessageEvent) => {
    if (event.origin !== allowedOrigin) return;

    // Only accept messages from the portal
    if (!event.data || event.data.source !== 'portal') return;

    handler(event.data);
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
