import { appendFile, stat, rename, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '@/lib/logger';
import { ensureStateDir, getStatePath } from './paths';
import type { AuditEntry } from './types';

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATIONS = 3;
const AUDIT_LOG_FILE = 'audit.log';

function getAuditLogPath(): string {
  return getStatePath(AUDIT_LOG_FILE);
}

/**
 * Append an audit entry to the admin audit log. Stored under the state dir
 * so it remains writable when the config dir is mounted read-only.
 */
export async function auditLog(action: string, detail: Record<string, unknown>, ip: string): Promise<void> {
  await ensureStateDir();

  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    action,
    detail,
    ip,
  };

  const logPath = getAuditLogPath();
  try {
    await appendFile(logPath, JSON.stringify(entry) + '\n', 'utf-8');
    await rotateIfNeeded(logPath);
  } catch (error) {
    logger.error('Failed to write audit log', { error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function rotateIfNeeded(logPath: string): Promise<void> {
  try {
    const stats = await stat(logPath);
    if (stats.size < MAX_LOG_SIZE) return;

    // Rotate: audit.log.3 → deleted, audit.log.2 → .3, audit.log.1 → .2, audit.log → .1
    for (let i = MAX_ROTATIONS; i >= 1; i--) {
      const from = i === 1 ? logPath : `${logPath}.${i - 1}`;
      const to = `${logPath}.${i}`;
      if (existsSync(from)) {
        try { await rename(from, to); } catch { /* target may exist on overwrite */ }
      }
    }
  } catch {
    // stat failed, probably file doesn't exist yet
  }
}

/**
 * Read audit log entries, newest first. Supports pagination.
 */
export async function readAuditLog(page: number = 1, limit: number = 50, actionFilter?: string): Promise<{ entries: AuditEntry[]; total: number }> {
  const logPath = getAuditLogPath();
  try {
    const content = await readFile(logPath, 'utf-8');
    // Fused single walk replaces split.filter.map.filter.reverse.slice chain.
    // Was: 4 intermediate arrays (filtered-blank, mapped-parsed,
    // filtered-non-null, filtered-by-action) plus an in-place reverse and
    // a slice. Now: one in-place push loop + one pre-sized output slice.
    const all: AuditEntry[] = [];
    for (const line of content.trim().split('\n')) {
      if (!line) continue;
      let entry: AuditEntry | null = null;
      try { entry = JSON.parse(line) as AuditEntry; } catch { continue; }
      if (!entry) continue;
      if (actionFilter && entry.action !== actionFilter) continue;
      all.push(entry);
    }
    const total = all.length;
    // Newest-first paging — read backwards from the tail into out, skipping
    // the in-place reverse + slice intermediate.
    const start = (page - 1) * limit;
    const end = Math.min(start + limit, total);
    const windowLen = Math.max(0, end - start);
    const entries: AuditEntry[] = new Array(windowLen);
    for (let i = 0; i < windowLen; i++) {
      entries[i] = all[total - 1 - start - i];
    }
    return { entries, total };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entries: [], total: 0 };
    }
    logger.warn('Failed to read audit log', { error: error instanceof Error ? error.message : 'Unknown error' });
    return { entries: [], total: 0 };
  }
}
