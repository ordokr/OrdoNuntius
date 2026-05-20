import { randomBytes, createHash } from 'node:crypto';

// Hoisted: were rebuilt per base64urlEncode call (every PKCE/state generation).
const B64_PLUS_RE = /\+/g;
const B64_SLASH_RE = /\//g;
const B64_PAD_RE = /=+$/;

function base64urlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(B64_PLUS_RE, '-').replace(B64_SLASH_RE, '_').replace(B64_PAD_RE, '');
}

export function generateCodeVerifierServer(): string {
  return base64urlEncode(randomBytes(32));
}

export function generateCodeChallengeServer(verifier: string): string {
  const hash = createHash('sha256').update(verifier).digest();
  return base64urlEncode(hash);
}

export function generateStateServer(): string {
  return base64urlEncode(randomBytes(32));
}
