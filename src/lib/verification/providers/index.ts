import 'server-only';

import { developmentProvider } from './dev';
import { whatsappCloudProvider } from './whatsapp-cloud';
import type { VerificationProvider } from './types';

export type { IncomingMessage, VerificationProvider } from './types';

const PROVIDERS: Record<string, VerificationProvider> = {
  whatsapp_cloud: whatsappCloudProvider,
  dev: developmentProvider,
};

/**
 * The active provider.
 *
 * Defaults to the real WhatsApp integration; `VERIFICATION_PROVIDER=dev` selects
 * the local one and is rejected outright when NODE_ENV is "production", so a
 * stray environment variable cannot turn off verification on a live deployment.
 */
export function getVerificationProvider(): VerificationProvider {
  const requested = process.env.VERIFICATION_PROVIDER?.trim() || 'whatsapp_cloud';
  const provider = PROVIDERS[requested];

  if (!provider) {
    throw new Error(
      `Unknown VERIFICATION_PROVIDER "${requested}". Expected one of: ${Object.keys(PROVIDERS).join(', ')}.`,
    );
  }

  if (provider.isDevelopment && process.env.NODE_ENV === 'production') {
    throw new Error(
      'VERIFICATION_PROVIDER="dev" cannot be used in production. Configure the WhatsApp provider.',
    );
  }

  return provider;
}

/** True when the local simulate-a-message shortcut may be offered. */
export function isDevelopmentVerificationEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    return getVerificationProvider().isDevelopment;
  } catch {
    return false;
  }
}
