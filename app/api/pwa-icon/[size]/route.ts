import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const VALID_SIZES = new Set([192, 512]);

// Cache resized images in memory to avoid reprocessing on every request
const cache = new Map<number, Blob>();

// Resolve env + paths once at module load.
const ICON_URL = process.env.PWA_ICON_URL || process.env.FAVICON_URL || '';
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const LEADING_SLASH_RE = /^\//;
const PNG_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'public, max-age=86400',
} as const;
const RESIZE_OPTS = { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } } as const;

async function fetchSourceImage(iconUrl: string): Promise<Buffer> {
  // Absolute URL (http/https)
  if (iconUrl.startsWith('http://') || iconUrl.startsWith('https://')) {
    const res = await fetch(iconUrl);
    if (!res.ok) throw new Error(`Failed to fetch PWA icon: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  // Path relative to public/ directory (hoisted PUBLIC_DIR + regex).
  const publicPath = path.join(PUBLIC_DIR, iconUrl.replace(LEADING_SLASH_RE, ''));
  return readFile(publicPath);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size: sizeParam } = await params;
  const size = parseInt(sizeParam, 10);

  if (!VALID_SIZES.has(size)) {
    return new NextResponse('Invalid size. Allowed: 192, 512', { status: 400 });
  }

  if (!ICON_URL) {
    return new NextResponse('No PWA icon configured', { status: 404 });
  }

  try {
    if (cache.has(size)) {
      return new NextResponse(cache.get(size)!, { headers: PNG_HEADERS });
    }

    const sourceBuffer = await fetchSourceImage(ICON_URL);
    const resized = await sharp(sourceBuffer)
      .resize(size, size, RESIZE_OPTS)
      .png()
      .toBuffer();

    const ab = new ArrayBuffer(resized.byteLength);
    new Uint8Array(ab).set(resized);
    const blob = new Blob([ab], { type: 'image/png' });
    cache.set(size, blob);

    return new NextResponse(blob, { headers: PNG_HEADERS });
  } catch (err) {
    console.error('Failed to generate PWA icon:', err);
    return new NextResponse('Failed to generate icon', { status: 500 });
  }
}
