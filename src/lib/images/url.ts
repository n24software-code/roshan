import { IMAGE_BUCKET } from './config';

/**
 * Turns a stored image reference into something an <img> can load.
 *
 * The image columns hold one of three shapes, and all three keep working:
 *   1. `restaurants/<id>/<uuid>.jpg` — an object in the storage bucket (uploads)
 *   2. `/menu/kfc-logo.jpg`          — a file shipped in /public (seed data)
 *   3. `https://…`                   — an external URL entered before uploads existed
 *
 * Returns null when there is no usable image, so callers can render a placeholder.
 */
export function resolveImageUrl(reference: string | null | undefined): string | null {
  if (!reference) return null;

  const value = reference.trim();
  if (!value) return null;

  // Legacy absolute URL — use as-is.
  if (/^https?:\/\//i.test(value)) return value;

  // A file served from /public.
  if (value.startsWith('/')) return value;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;

  return `${base.replace(/\/$/, '')}/storage/v1/object/public/${IMAGE_BUCKET}/${value}`;
}

/** True when the reference points at an object we own inside the bucket. */
export function isStoredObject(reference: string | null | undefined): boolean {
  if (!reference) return false;
  const value = reference.trim();
  return Boolean(value) && !/^https?:\/\//i.test(value) && !value.startsWith('/');
}
