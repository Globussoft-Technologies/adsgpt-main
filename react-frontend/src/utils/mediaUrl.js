// Generated media is stored server-side as S3 PATHS (e.g. /creatives/<user>/x.webp)
// so the same DB row resolves under whichever env serves it (dev:
// contents.adsgpt.io, prod: media.adsgpt.io). The frontend prefixes the S3
// public base here. Full URLs (legacy local /uploads, external ad-library
// images) pass through unchanged.
const S3_BASE = (import.meta.env.VITE_S3_BASE_URL || '').replace(/\/$/, '');

export default function toMediaUrl(u) {
  if (!u || typeof u !== 'string') return u;
  if (/^(https?:)?\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return u;
  if (u.startsWith('/')) return `${S3_BASE}${u}`;
  return u;
}
