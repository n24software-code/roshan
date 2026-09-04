import 'server-only';

import type { IncomingMessage, VerificationProvider, WebhookChallenge } from './types';

/**
 * Development-only provider.
 *
 * It exists so the whole flow — request, message, webhook, verified session —
 * can be exercised without a WhatsApp Business account. It refuses to do
 * anything when NODE_ENV is "production", and `getVerificationProvider` refuses
 * to select it there in the first place, so the bypass cannot be reached by
 * misconfiguration alone.
 */

function allowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export const developmentProvider: VerificationProvider = {
  id: 'dev',
  isDevelopment: true,

  isConfigured() {
    return allowed();
  },

  /** Still opens WhatsApp if a number is configured, so the UI can be tested. */
  buildHandoffUrl(message) {
    const number = process.env.WHATSAPP_BUSINESS_NUMBER?.replace(/\D/g, '');
    if (!number || number.length < 8) return null;
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  },

  handleWebhookChallenge(url): WebhookChallenge | null {
    if (!allowed()) return { status: 403, body: 'Forbidden' };
    const challenge = url.searchParams.get('hub.challenge');
    return challenge ? { status: 200, body: challenge } : null;
  },

  verifyWebhookSignature() {
    return allowed();
  },

  /** Accepts the plain `{ from, text }` shape, so the webhook can be curl'ed. */
  parseIncomingMessages(payload) {
    if (!allowed()) return [];
    const body = payload as { from?: unknown; text?: unknown };
    if (typeof body?.from !== 'string' || typeof body?.text !== 'string') return [];
    return [{ from: body.from, text: body.text } satisfies IncomingMessage];
  },
};
