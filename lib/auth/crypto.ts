import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { logger } from '@/lib/logger';
import { getSessionSecret } from '@/lib/auth/session-secret';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const MIN_SECRET_LENGTH = 32;

function getKey(): Buffer {
  const secret = getSessionSecret();
  if (!secret) throw new Error('SESSION_SECRET not configured');
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${secret.length}). ` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return createHash('sha256').update(secret).digest();
}

// Shared AES-256-GCM primitives. Both session and payload tokens use the
// same wire shape (iv ‖ tag ‖ ciphertext, base64-encoded); only the
// outer JSON schema differs.
function encryptJson(value: unknown): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const json = JSON.stringify(value);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptJson<T>(token: string, context: string): T | null {
  try {
    const key = getKey();
    const data = Buffer.from(token, 'base64');
    if (data.length < IV_LENGTH + TAG_LENGTH) return null;

    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch (error) {
    logger.warn(`${context} decryption failed`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

export function encryptSession(serverUrl: string, username: string, password: string): string {
  return encryptJson({ v: 1, serverUrl, username, password });
}

export function decryptSession(token: string): { serverUrl: string; username: string; password: string } | null {
  const parsed = decryptJson<{ v?: number; serverUrl?: string; username?: string; password?: string }>(
    token,
    'Session',
  );
  if (!parsed || parsed.v !== 1 || !parsed.serverUrl || !parsed.username || !parsed.password) return null;
  return { serverUrl: parsed.serverUrl, username: parsed.username, password: parsed.password };
}

export function encryptPayload(payload: Record<string, unknown>): string {
  return encryptJson(payload);
}

export function decryptPayload(token: string): Record<string, unknown> | null {
  return decryptJson<Record<string, unknown>>(token, 'Payload');
}
