/**
 * DOMPurify-backed sanitizers for email bodies, iframe-rendered bodies, and
 * HTML signatures. Split out of `lib/email-sanitization.ts` so the main inbox
 * bundle (which transitively imports the latter via lib/signature-utils.ts)
 * does not pull DOMPurify (~21KB min) on cold load. Only consumers that
 * actually need HTML sanitization import this file; the lazy email-viewer /
 * composer / template-picker / settings chunks pick it up.
 */

import DOMPurify from 'dompurify';

/**
 * Unified DOMPurify configuration for email content
 * Blocks all script execution vectors while preserving formatting
 * NOTE: <style> tags are forbidden to prevent global CSS injection
 * Inline style attributes are still allowed for element-specific styling
 */
export const EMAIL_SANITIZE_CONFIG = {
  ADD_TAGS: [],
  ADD_ATTR: ['target', 'rel', 'style', 'class', 'width', 'height', 'align', 'valign', 'bgcolor', 'color'],
  ALLOW_DATA_ATTR: false,
  FORCE_BODY: true,
  // Allow blob: URIs so authenticated inline images (CID) are not stripped.
  // data: is restricted to image/* MIME types to prevent SVG script injection.
  // eslint-disable-next-line no-useless-escape
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob):|data:image\/|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  FORBID_TAGS: [
    'script', 'iframe', 'object', 'embed', 'form',
    'input', 'button', 'meta', 'link', 'base',
    'svg', 'math', 'style'
  ],
  FORBID_ATTR: [
    'onerror', 'onload', 'onclick', 'onmouseover',
    'onfocus', 'onblur', 'onchange', 'onsubmit',
    'onkeydown', 'onkeyup', 'onmousedown', 'onmouseup'
  ],
};

export function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, EMAIL_SANITIZE_CONFIG);
}

/**
 * Sanitize config for emails rendered inside a sandboxed iframe.
 * Allows <style> tags because CSS is scoped to the iframe document and
 * cannot leak into the host app. Scripts are still blocked by the sandbox
 * attribute (no allow-scripts). Use ONLY for iframe-rendered content –
 * never for content rendered into the main DOM.
 */
// Inline filter — module-scope literal avoids a runtime .filter() pass at import.
export const EMAIL_IFRAME_SANITIZE_CONFIG = {
  ...EMAIL_SANITIZE_CONFIG,
  FORBID_TAGS: [
    'script', 'iframe', 'object', 'embed', 'form',
    'input', 'button', 'meta', 'link', 'base',
    'svg', 'math',
  ],
};

export function sanitizeEmailHtmlForIframe(html: string): string {
  return DOMPurify.sanitize(html, EMAIL_IFRAME_SANITIZE_CONFIG);
}

/**
 * Sanitize HTML signature with stricter rules
 * Only allows basic formatting, no external resources
 */
export const SIGNATURE_SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'span', 'div'],
  ALLOWED_ATTR: ['href', 'style', 'class'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'img', 'video', 'audio'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
};

export function sanitizeSignatureHtml(html: string): string {
  if (!html?.trim()) return '';
  return DOMPurify.sanitize(html, SIGNATURE_SANITIZE_CONFIG);
}
