/**
 * RFC 5322 §3.6.4 reply threading.
 *
 * Computes the In-Reply-To and References headers an outgoing reply must
 * carry so MUAs can stitch the conversation back together.
 *
 *   In-Reply-To = parent.Message-ID
 *   References  = parent.References (if any) + parent.Message-ID
 *
 * Bare msg-ids only - angle brackets are stripped because JMAP RFC 8621
 * §4.1.2.3 stores Message-IDs without them.
 */

export interface ParentThreadingInfo {
  // JMAP RFC 8621 §4.1.2.3 specifies messageId as String[]|null, but the
  // codebase has historically typed it as string. Accept either shape.
  messageId?: string | string[];
  references?: string[];
}

export interface ReplyThreadingHeaders {
  inReplyTo: string[];
  references: string[];
}

// Single-pass strip: one trim, one regex over angle brackets (vs trim+2 replace+trim).
const ANGLE_BRACKETS_EDGES = /^<+|>+$/g;
export function stripMessageIdBrackets(id: string): string {
  return id.trim().replace(ANGLE_BRACKETS_EDGES, '');
}

export function computeReplyThreadingHeaders(
  parent: ParentThreadingInfo | undefined,
): ReplyThreadingHeaders | null {
  const rawId = Array.isArray(parent?.messageId) ? parent.messageId[0] : parent?.messageId;
  const parentId = rawId ? stripMessageIdBrackets(rawId) : '';
  if (!parentId) return null;

  // De-dupe while preserving order; the parent's id closes the chain.
  // Single walk: strip + filter + dedupe in one pass, no intermediate arrays.
  const seen = new Set<string>();
  const references: string[] = [];
  for (const raw of parent?.references ?? []) {
    const id = stripMessageIdBrackets(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    references.push(id);
  }
  if (!seen.has(parentId)) {
    references.push(parentId);
  }

  return { inReplyTo: [parentId], references };
}
