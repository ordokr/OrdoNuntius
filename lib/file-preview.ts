export type FilePreviewKind = 'image' | 'html' | 'text' | 'markdown' | 'pdf' | 'audio' | 'video' | 'unsupported';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v', 'avi', 'mkv']);
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'log', 'csv', 'json', 'xml', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'sql', 'graphql', 'html', 'htm',
  'md', 'markdown',
]);
const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
]);

function normalizeMimeType(type?: string): string {
  if (!type) return '';
  const semi = type.indexOf(';');
  return (semi === -1 ? type : type.slice(0, semi)).trim().toLowerCase();
}

function getExtension(name?: string): string {
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

export function getFilePreviewKind(name?: string, type?: string): FilePreviewKind {
  const ext = getExtension(name);
  const mimeType = normalizeMimeType(type);

  if (mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) {
    return 'image';
  }

  if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml' || ext === 'html' || ext === 'htm') {
    return 'html';
  }

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }

  if (mimeType.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) {
    return 'audio';
  }

  if (mimeType.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) {
    return 'video';
  }

  if (ext === 'md' || ext === 'markdown') {
    return 'markdown';
  }

  if (mimeType.startsWith('text/') || TEXT_MIME_TYPES.has(mimeType) || TEXT_EXTENSIONS.has(ext)) {
    return 'text';
  }

  return 'unsupported';
}

export function isFilePreviewable(name?: string, type?: string): boolean {
  return getFilePreviewKind(name, type) !== 'unsupported';
}