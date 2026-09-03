import 'server-only';

import { createAdminSupabase } from '@/lib/supabase/admin';
import { IMAGE_BUCKET } from './config';
import { isStoredObject } from './url';

/**
 * Storage writes. These run only after the caller has been confirmed as an
 * admin, and only ever on the server — the service-role key never reaches a
 * browser bundle (this module is `server-only`).
 */

export async function uploadImageObject(
  path: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, body, {
    contentType,
    cacheControl: '31536000',
    upsert: false,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Removes an object, ignoring references that are not ours (external URLs and
 * files shipped in /public must never be touched).
 */
export async function deleteImageObject(
  reference: string | null | undefined,
): Promise<{ ok: true; removed: boolean } | { ok: false; error: string }> {
  if (!isStoredObject(reference)) return { ok: true, removed: false };

  const supabase = createAdminSupabase();
  const { error } = await supabase.storage.from(IMAGE_BUCKET).remove([reference!.trim()]);

  return error ? { ok: false, error: error.message } : { ok: true, removed: true };
}

/**
 * Deletes the image an entity used to have, once the database already points at
 * the new one. Never throws: an orphaned object is a smaller problem than a
 * failed save, and the caller surfaces the warning.
 */
export async function cleanupReplacedImage(
  previous: string | null | undefined,
  next: string | null | undefined,
): Promise<string | null> {
  if (!previous || previous === next) return null;
  if (!isStoredObject(previous)) return null;

  try {
    const result = await deleteImageObject(previous);
    return result.ok ? null : `Old image could not be removed from storage: ${result.error}`;
  } catch (error) {
    return `Old image could not be removed from storage: ${(error as Error).message}`;
  }
}
