'use client';

import { useSyncExternalStore } from 'react';

/**
 * The guest's in-progress choice. One restaurant, one item — deliberately not a
 * cart. Persisted so a refresh mid-flow does not lose the selection; the server
 * still re-validates everything before an order is created.
 *
 * Exposed as external stores so components can subscribe with
 * `useSyncExternalStore` instead of copying storage into state inside an effect.
 */

export interface StoredSelection {
  eventSlug: string;
  restaurantSlug: string;
  restaurantId: string;
  menuItemId: string;
}

export interface PendingDetails {
  name: string;
  phone: string;
  menuItemId: string;
  /** When the one-time code stops being accepted (ISO 8601). */
  expiresAt: string;
  /** Deep link that opens WhatsApp with the verification message prefilled. */
  whatsappUrl: string | null;
  /** Development provider only: the message the simulate button replays. */
  developmentMessage?: { from: string; text: string };
}

const SELECTION_KEY = 'event-order:selection';
const DETAILS_KEY = 'event-order:pending-details';
const ORDER_KEY = 'event-order:order-number';

type Area = 'local' | 'session';

function storage(area: Area): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  return area === 'local' ? window.localStorage : window.sessionStorage;
}

function readRaw(area: Area, key: string): string | null {
  try {
    return storage(area)?.getItem(key) ?? null;
  } catch {
    // Private browsing with storage disabled: the flow still works via the URL.
    return null;
  }
}

// Same-tab writes do not fire `storage`, so keep our own listener set.
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (typeof window !== 'undefined') window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onChange);
  };
}

/**
 * Builds a store whose snapshot is referentially stable: the parsed value is
 * cached against the raw string, so repeated reads return the same object and
 * useSyncExternalStore does not loop.
 */
function createStore<T>(area: Area, key: string) {
  let cachedRaw: string | null = null;
  let cachedValue: T | null = null;
  let primed = false;

  function get(): T | null {
    const raw = readRaw(area, key);
    if (!primed || raw !== cachedRaw) {
      primed = true;
      cachedRaw = raw;
      try {
        cachedValue = raw ? (JSON.parse(raw) as T) : null;
      } catch {
        cachedValue = null;
      }
    }
    return cachedValue;
  }

  return {
    get,
    set(value: T) {
      try {
        storage(area)?.setItem(key, JSON.stringify(value));
      } catch {
        /* storage unavailable */
      }
      notify();
    },
    clear() {
      try {
        storage(area)?.removeItem(key);
      } catch {
        /* storage unavailable */
      }
      notify();
    },
    subscribe,
  };
}

export const selectionStore = createStore<StoredSelection>('local', SELECTION_KEY);

/** Name and phone held only for the verification step, in session storage. */
export const detailsStore = createStore<PendingDetails>('session', DETAILS_KEY);

/** The confirmed order number, so refreshing the confirmation page still works. */
export const orderStore = createStore<string>('local', ORDER_KEY);

const alwaysFalse = () => false;
const alwaysTrue = () => true;
const nullSnapshot = () => null;

/** True once the browser has taken over from the server-rendered markup. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, alwaysTrue, alwaysFalse);
}

export function useStoredSelection(): StoredSelection | null {
  return useSyncExternalStore(selectionStore.subscribe, selectionStore.get, nullSnapshot);
}

export function usePendingDetails(): PendingDetails | null {
  return useSyncExternalStore(detailsStore.subscribe, detailsStore.get, nullSnapshot);
}
