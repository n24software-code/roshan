'use client';

import { useCallback, useRef } from 'react';

/** Asks the admin API to drop a storage object. Best effort. */
export async function deleteUploadedImage(path: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/admin/images?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Tracks objects uploaded while a dialog is open.
 *
 * An upload lands in storage the moment it is chosen, so abandoning the dialog —
 * or swapping the picture three times before saving — would otherwise leave
 * orphans behind. `discard` removes everything except the reference that was
 * actually kept.
 */
export function useUploadTracker() {
  const uploaded = useRef<string[]>([]);

  const track = useCallback((path: string) => {
    uploaded.current.push(path);
  }, []);

  const discard = useCallback(async (keep?: string | null) => {
    const orphans = uploaded.current.filter((path) => path !== keep);
    uploaded.current = [];
    await Promise.all(orphans.map(deleteUploadedImage));
  }, []);

  const reset = useCallback(() => {
    uploaded.current = [];
  }, []);

  return { track, discard, reset };
}
