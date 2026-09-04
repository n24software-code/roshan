'use client';

/**
 * Persistent browser identifier.
 *
 * A secondary signal only: it lets staff see that two attempts came from the
 * same browser. The business rule that actually blocks a second order is
 * event + normalized phone / event + normalized email, enforced by unique
 * indexes in the database — never this value.
 */

export const DEVICE_ID_KEY = 'roshn_event_device_id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the stored device id, creating and persisting one on first visit. */
export function getDeviceId(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing && UUID.test(existing)) return existing;

    const created = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    // Private browsing with storage disabled: ordering still works without it.
    return null;
  }
}
