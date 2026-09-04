'use client';

import { useEffect } from 'react';
import { ensureAnonymousSession } from '@/lib/auth/anonymous';
import { getDeviceId } from '@/lib/device';

/**
 * Establishes the guest's anonymous identity as soon as they open the event.
 *
 * Renders nothing and shows nothing: the guest never learns that a session
 * exists. Both values are ready by the time the order form is submitted.
 */
export function AnonymousSession() {
  useEffect(() => {
    getDeviceId();
    void ensureAnonymousSession();
  }, []);

  return null;
}
