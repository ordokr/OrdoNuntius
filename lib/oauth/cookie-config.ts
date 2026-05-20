const COOKIE_SAME_SITE = (process.env.COOKIE_SAME_SITE || 'lax') as 'lax' | 'none' | 'strict';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== undefined
  ? process.env.COOKIE_SECURE === 'true'
  : (COOKIE_SAME_SITE === 'none' || process.env.NODE_ENV === 'production');

// Build the options once at module load. Caller code only reads, so a
// frozen shared object is safe and avoids the literal alloc on every
// cookie write. cookie writes fire per session refresh + every passthrough
// that re-stamps the stalwart auth context.
const COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAME_SITE,
  path: '/',
  maxAge: 30 * 24 * 60 * 60,
}) as {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax' | 'none' | 'strict';
  readonly path: '/';
  readonly maxAge: number;
};

export function getCookieOptions() {
  return COOKIE_OPTIONS;
}
