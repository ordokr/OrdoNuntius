import { parseHtmlSafely } from '@/lib/email-sanitization';

type SignatureSource = {
  textSignature?: string;
  htmlSignature?: string;
};

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'footer',
  'header',
  'li',
  'nav',
  'p',
  'section',
  'tr',
]);

// Tags whose text content must NOT contribute to the plain-text signature.
// Previously we routed the html through sanitizeSignatureHtml (DOMPurify) to
// strip these before walking; that pulled DOMPurify (~21KB min) into the
// main inbox bundle just so the optional html-signature → text fallback
// could sanitize. parseHtmlSafely already prevents script execution
// (DOMParser doesn't execute), so we only need to drop the text contents
// of these elements during the walk to match the prior behaviour.
const SKIP_TEXT_TAGS = new Set([
  'script', 'style', 'noscript', 'iframe', 'object', 'embed',
  'head', 'template', 'svg', 'math',
]);

// Hoisted to module scope — was rebuilt via `.join(', ')` over a 22-element
// array on every hasMeaningfulHtmlBody() call (once per email viewer mount).
const RICH_BODY_SELECTOR = [
  'table', 'img', 'style', 'b', 'strong', 'i', 'em', 'u', 'font',
  'a[href]', 'div[style]', 'span[style]', 'p[style]',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'blockquote', 'br',
].join(', ');

// Module-scope regexes \u2014 hoisted out of the per-call hot path.
const SIG_CRLF_REGEX = /\r\n?/g;
const SIG_NBSP_REGEX = /\u00a0/g;
const SIG_TRAILING_WS_REGEX = /[ \t]+\n/g;
const SIG_MULTI_NEWLINE_REGEX = /\n{3,}/g;
const SIG_WHITESPACE_REGEX = /\s+/g;

function normalizeSignatureLineBreaks(value: string): string {
  return value
    .replace(SIG_CRLF_REGEX, '\n')
    .replace(SIG_NBSP_REGEX, ' ')
    .replace(SIG_TRAILING_WS_REGEX, '\n')
    .replace(SIG_MULTI_NEWLINE_REGEX, '\n\n')
    .trim();
}

function htmlToPlainText(html: string): string {
  const document = parseHtmlSafely(html);
  const chunks: string[] = [];

  const appendText = (value: string) => {
    if (!value) return;
    const normalized = value.replace(SIG_WHITESPACE_REGEX, ' ');
    if (!normalized.trim()) return;
    const previous = chunks[chunks.length - 1];
    if (previous && !previous.endsWith('\n') && !previous.endsWith(' ')) {
      chunks.push(' ');
    }
    chunks.push(normalized);
  };

  const appendNewline = () => {
    const previous = chunks[chunks.length - 1];
    if (previous === '\n') return;
    if (previous?.endsWith('\n')) return;
    chunks.push('\n');
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent || '');
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();

    if (SKIP_TEXT_TAGS.has(tagName)) {
      return;
    }

    if (tagName === 'br') {
      appendNewline();
      return;
    }

    if (tagName === 'a') {
      const text = element.textContent?.replace(SIG_WHITESPACE_REGEX, ' ').trim() || '';
      const href = element.getAttribute('href')?.trim() || '';
      const normalizedHref = href.replace(/^mailto:/i, '');
      if (text && normalizedHref && text === normalizedHref) {
        appendText(text);
        return;
      }
      if (text && href && text !== href) {
        appendText(`${text} <${href}>`);
        return;
      }
    }

    if (BLOCK_TAGS.has(tagName) && chunks.length > 0) {
      appendNewline();
    }

    // NodeList is iterable; for-of avoids the Array.from allocation per
    // element. Recursive walk on each child node.
    for (const child of element.childNodes) walk(child);

    if (BLOCK_TAGS.has(tagName)) {
      appendNewline();
    }
  };

  // Same Array.from drop at the top level.
  for (const child of document.body.childNodes) walk(child);
  return normalizeSignatureLineBreaks(chunks.join(''));
}

export function getPlainTextSignature(signature?: SignatureSource | null): string {
  if (signature?.textSignature?.trim()) {
    return normalizeSignatureLineBreaks(signature.textSignature);
  }

  if (signature?.htmlSignature?.trim()) {
    // htmlToPlainText walks via parseHtmlSafely (DOMParser, no script
    // execution) and skips script/style/iframe/etc. subtrees, so we no
    // longer need a DOMPurify pass to get safe plain text out.
    return htmlToPlainText(signature.htmlSignature);
  }

  return '';
}

export function appendPlainTextSignature(
  body: string,
  signature?: SignatureSource | null,
  options: { separator?: boolean } = {},
): string {
  const plainTextSignature = getPlainTextSignature(signature);
  if (!plainTextSignature) {
    return body;
  }

  const sep = options.separator === false ? '\n\n' : '\n\n-- \n';
  return `${body}${sep}${plainTextSignature}`;
}

export function hasMeaningfulHtmlBody(html: string): boolean {
  if (!html.trim()) return false;

  const document = parseHtmlSafely(html);

  if (document.querySelector(RICH_BODY_SELECTOR)) {
    return true;
  }

  const blockElements = document.body.querySelectorAll('p, div, blockquote, li');
  return blockElements.length > 1;
}