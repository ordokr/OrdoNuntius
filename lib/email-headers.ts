import { AuthenticationResults } from './jmap/types';
import { parseUnsubscribeUrls } from './validation';

// Module-scope regexes — hoisted to avoid recompilation per call.
const SPF_REGEX = /spf=(\w+)(?:\s+\([^)]*\))?\s+(?:smtp\.(?:mailfrom|helo)=([^\s;]+))?/;
const DKIM_REGEX = /dkim=(\w+)(?:\s+header\.d=([^\s]+))?(?:\s+header\.s=([^\s]+))?/;
const DMARC_REGEX = /dmarc=(\w+)(?:\s+header\.from=([^\s]+))?(?:\s+policy\.dmarc=(\w+))?/;
const IPREV_REGEX = /iprev=(\w+)(?:\s+policy\.iprev=([\d.]+))?/;

/**
 * Parse Authentication-Results header to extract SPF, DKIM, DMARC results
 */
export function parseAuthenticationResults(header: string): AuthenticationResults {
  const results: AuthenticationResults = {};

  type SpfResult = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror';
  type DkimResult = 'pass' | 'fail' | 'policy' | 'neutral' | 'temperror' | 'permerror';
  type DmarcResult = 'pass' | 'fail' | 'none';
  type DmarcPolicy = 'reject' | 'quarantine' | 'none';

  const spfMatch = header.match(SPF_REGEX);
  if (spfMatch) {
    results.spf = {
      result: spfMatch[1] as SpfResult,
      domain: spfMatch[2]
    };
  }

  const dkimMatch = header.match(DKIM_REGEX);
  if (dkimMatch) {
    results.dkim = {
      result: dkimMatch[1] as DkimResult,
      domain: dkimMatch[2],
      selector: dkimMatch[3]
    };
  }

  const dmarcMatch = header.match(DMARC_REGEX);
  if (dmarcMatch) {
    results.dmarc = {
      result: dmarcMatch[1] as DmarcResult,
      domain: dmarcMatch[2],
      policy: dmarcMatch[3] as DmarcPolicy | undefined
    };
  }

  const iprevMatch = header.match(IPREV_REGEX);
  if (iprevMatch) {
    results.iprev = {
      result: iprevMatch[1] as 'pass' | 'fail',
      ip: iprevMatch[2]
    };
  }

  return results;
}

// Module-scope spam-score regexes.
const SPAM_STATUS_REGEX = /^(Yes|No),?\s+score=([-\d.]+)/i;
const SPAM_SCORE_REGEX = /score[=:]?\s*([-\d.]+)/i;

/**
 * Parse spam score from X-Spam-Result or X-Spam-Status headers
 */
export function parseSpamScore(header: string): { score: number; status: string } | null {
  const statusMatch = header.match(SPAM_STATUS_REGEX);
  if (statusMatch) {
    return {
      status: statusMatch[1].toLowerCase(),
      score: parseFloat(statusMatch[2])
    };
  }

  const scoreMatch = header.match(SPAM_SCORE_REGEX);
  if (scoreMatch) {
    const score = parseFloat(scoreMatch[1]);
    return {
      score,
      status: score > 5 ? 'spam' : 'ham'
    };
  }

  return null;
}

/**
 * Parse Received headers to extract mail routing path
 */
interface ReceivedHeaderInfo {
  from: string;
  by: string;
  timestamp?: string;
  protocol?: string;
  id?: string;
}

// Hoisted per-iteration regexes — re-allocating inside the loop was wasted work.
const RECEIVED_FROM_REGEX = /from\s+([^\s]+)(?:\s+\([^)]+\))?/;
const RECEIVED_BY_REGEX = /by\s+([^\s]+)/;
const RECEIVED_DATE_REGEX = /;\s+(.+)$/;
const RECEIVED_PROTO_REGEX = /with\s+(\w+)/;
const RECEIVED_ID_REGEX = /id\s+([^\s;]+)/;

export function parseReceivedHeaders(headers: string[]): ReceivedHeaderInfo[] {
  const path: ReceivedHeaderInfo[] = [];

  for (const header of headers) {
    const fromMatch = header.match(RECEIVED_FROM_REGEX);
    const byMatch = header.match(RECEIVED_BY_REGEX);
    const dateMatch = header.match(RECEIVED_DATE_REGEX);
    const protoMatch = header.match(RECEIVED_PROTO_REGEX);
    const idMatch = header.match(RECEIVED_ID_REGEX);

    if (fromMatch || byMatch) {
      path.push({
        from: fromMatch?.[1] || 'unknown',
        by: byMatch?.[1] || 'unknown',
        timestamp: dateMatch?.[1],
        protocol: protoMatch?.[1],
        id: idMatch?.[1]
      });
    }
  }

  return path;
}

// Module-level constants — sizes array used to be rebuilt per call;
// LOG_1024 pre-computes the divisor.
const BYTES_UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const LOG_1024_BH = Math.log(1024);

/**
 * Format bytes to human readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / LOG_1024_BH);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${BYTES_UNITS[i]}`;
}

/**
 * Get security status color and icon based on result
 */
export function getSecurityStatus(result?: string): {
  color: string;
  icon: 'check' | 'x' | 'alert' | 'minus';
  bgColor: string;
  borderColor: string;
} {
  switch (result) {
    case 'pass':
      return {
        color: 'text-green-700 dark:text-green-400',
        icon: 'check',
        bgColor: 'bg-gray-50 dark:bg-gray-800',
        borderColor: 'border-l-4 border-green-600 dark:border-green-500'
      };
    case 'fail':
    case 'permerror':
      return {
        color: 'text-red-700 dark:text-red-400',
        icon: 'x',
        bgColor: 'bg-gray-50 dark:bg-gray-800',
        borderColor: 'border-l-4 border-red-600 dark:border-red-500'
      };
    case 'softfail':
    case 'neutral':
    case 'temperror':
      return {
        color: 'text-warning',
        icon: 'alert',
        bgColor: 'bg-gray-50 dark:bg-gray-800',
        borderColor: 'border-l-4 border-warning'
      };
    default:
      return {
        color: 'text-gray-700 dark:text-gray-400',
        icon: 'minus',
        bgColor: 'bg-gray-50 dark:bg-gray-800',
        borderColor: 'border-l-4 border-gray-400 dark:border-gray-600'
      };
  }
}

// Module-scope LLM verdict regex.
const SPAM_LLM_REGEX = /^(LEGITIMATE|SPAM|SUSPICIOUS)\s*\((.+)\)\s*$/i;

/**
 * Parse X-Spam-LLM header to extract AI verdict and explanation
 */
export function parseSpamLLM(header: string): { verdict: string; explanation: string } | null {
  // Format: "LEGITIMATE (explanation)" or "SPAM (explanation)"
  // Trim the header first to remove any leading/trailing whitespace
  const trimmed = header.trim();
  const match = trimmed.match(SPAM_LLM_REGEX);

  if (match) {
    return {
      verdict: match[1].toUpperCase(),
      explanation: match[2].trim()
    };
  }
  return null;
}

/**
 * Extract list headers (List-Unsubscribe, List-Id, etc.)
 */
interface ListHeaders {
  listId?: string;
  listUnsubscribe?: {
    http?: string;
    mailto?: string;
    preferred?: 'http' | 'mailto';
  };
  listHelp?: string;
  listPost?: string;
}

function firstHeader(headers: Record<string, string | string[]>, name: string): string | undefined {
  const v = headers[name];
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export function extractListHeaders(headers: Record<string, string | string[]>): ListHeaders {
  const result: ListHeaders = {};

  const listId = firstHeader(headers, 'List-Id');
  if (listId) result.listId = listId;

  const unsub = firstHeader(headers, 'List-Unsubscribe');
  if (unsub) {
    const parsed = parseUnsubscribeUrls(unsub);
    if (parsed.preferred) result.listUnsubscribe = parsed;
  }

  const listHelp = firstHeader(headers, 'List-Help');
  if (listHelp) result.listHelp = listHelp;

  const listPost = firstHeader(headers, 'List-Post');
  if (listPost) result.listPost = listPost;

  return result;
}