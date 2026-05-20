/**
 * DOMParser-only helpers for email HTML. DOMPurify-backed sanitizers live in
 * `lib/email-sanitize-html.ts` so this module can be imported from boot-path
 * code (e.g. lib/signature-utils.ts, which app/[locale]/page.tsx pulls in
 * eagerly) without dragging DOMPurify into the main inbox bundle.
 */

/**
 * Safe HTML parsing without execution
 * Use instead of innerHTML for detection/parsing
 */
export function parseHtmlSafely(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

// Module-level constant for the rich-formatting probe selector.
// Hoisting prevents the string + concat from being re-evaluated on every
// hasRichFormatting() call (per-email-render hot path).
const RICH_FORMATTING_SELECTOR =
  'table, img, style, b, strong, i, em, u, font, ' +
  'div[style], span[style], p[style], ' +
  'h1, h2, h3, h4, h5, h6, ul, ol, blockquote';

/**
 * Detect if HTML content has rich formatting
 * Safe alternative to innerHTML parsing
 */
export function hasRichFormatting(html: string): boolean {
  const doc = parseHtmlSafely(html);
  return !!doc.querySelector(RICH_FORMATTING_SELECTOR);
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(str: string): string {
  return str.replace(ESCAPE_HTML_REGEX, (c) => HTML_ESCAPES[c]);
}

// Module-level compiled regexes — local `const re = /.../g` inside
// hot functions recompiles per call in spec terms (V8 may cache, but
// don't rely on it). plainTextToSafeHtml is called per inline email body
// rendered, so this matters at mailbox-load time.
const ESCAPE_HTML_REGEX = /[&<>"']/g;
const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g;

/**
 * Render a plain-text email body as HTML, HTML-escaping all content and
 * linkifying http(s) URLs. URLs terminate at whitespace or any character that
 * would break an attribute (`"`, `'`, `<`, `>`), so attribute-escaping is
 * enforced even if escaping has bugs.
 */
export function plainTextToSafeHtml(text: string, linkClass = ''): string {
  URL_REGEX.lastIndex = 0; // /g regex carries state; reset before reuse
  const classAttr = linkClass ? ` class="${escapeHtml(linkClass)}"` : '';
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIndex, match.index));
    const url = escapeHtml(match[0]);
    result += `<a href="${url}" target="_blank" rel="noopener noreferrer"${classAttr}>${url}</a>`;
    lastIndex = match.index + match[0].length;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}

// Hoisted whitespace regex used per-img inside collapseBlockedImageContainers.
const WHITESPACE_NBSP_REGEX = /[\s\u00A0]+/g;

/**
 * Collapse empty containers left behind when external images are blocked.
 * Walks up from each blocked img to find the nearest table cell or wrapper div
 * and hides it if it contains no meaningful visible content.
 */
export function collapseBlockedImageContainers(html: string): string {
  const doc = parseHtmlSafely(html);
  const blockedImages = doc.querySelectorAll('img[data-blocked-src]');

  for (const img of blockedImages) {
    let el: HTMLElement | null = img.parentElement;
    while (el && el !== doc.body) {
      if (el.tagName === 'TD' || el.tagName === 'TH' || (el.tagName === 'DIV' && el.parentElement?.tagName === 'TD')) {
        const hasVisibleText = el.textContent?.replace(WHITESPACE_NBSP_REGEX, '').trim();
        const hasVisibleMedia = el.querySelector('img:not([data-blocked-src]), video, canvas');
        const hasLinks = el.querySelector('a[href]');
        if (!hasVisibleText && !hasVisibleMedia && !hasLinks) {
          el.setAttribute('data-blocked-collapsed-style', el.style.cssText);
          el.style.display = 'none';
          el.style.height = '0';
          el.style.padding = '0';
          el.style.overflow = 'hidden';
        }
        break;
      }
      if (el.tagName === 'TABLE' || el.tagName === 'TR') break;
      el = el.parentElement;
    }
  }

  return doc.body.innerHTML;
}
