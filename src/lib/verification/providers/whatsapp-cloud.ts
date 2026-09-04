import 'server-only';

import { createHmac } from 'node:crypto';
import { safeEquals } from '../codes';
import type { IncomingMessage, VerificationProvider, WebhookChallenge } from './types';

/**
 * Meta WhatsApp Cloud API.
 *
 * Attendees message the business number; Meta posts the message to
 * /api/verification/whatsapp, signed with the app secret.
 */

function businessNumber(): string | null {
  const raw = process.env.WHATSAPP_BUSINESS_NUMBER?.replace(/\D/g, '');
  return raw && raw.length >= 8 ? raw : null;
}

type CloudPayload = {
  entry?: {
    changes?: {
      value?: {
        messages?: { from?: string; id?: string; type?: string; text?: { body?: string } }[];
      };
    }[];
  }[];
};

export const whatsappCloudProvider: VerificationProvider = {
  id: 'whatsapp_cloud',
  isDevelopment: false,

  isConfigured() {
    return Boolean(
      businessNumber() &&
      process.env.WHATSAPP_APP_SECRET &&
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    );
  },

  buildHandoffUrl(message) {
    const number = businessNumber();
    if (!number) return null;
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  },

  handleWebhookChallenge(url): WebhookChallenge | null {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode !== 'subscribe' || !challenge) return null;

    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (!expected || !token || !safeEquals(token, expected)) {
      return { status: 403, body: 'Forbidden' };
    }
    return { status: 200, body: challenge };
  },

  verifyWebhookSignature(rawBody, headers) {
    const secret = process.env.WHATSAPP_APP_SECRET;
    const header = headers.get('x-hub-signature-256');
    if (!secret || !header?.startsWith('sha256=')) return false;

    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    return safeEquals(header.slice('sha256='.length), expected);
  },

  parseIncomingMessages(payload) {
    const body = payload as CloudPayload;
    const messages: IncomingMessage[] = [];

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const message of change?.value?.messages ?? []) {
          if (message?.type !== 'text') continue;
          const text = message.text?.body;
          if (!message.from || !text) continue;
          messages.push({ from: message.from, text, providerMessageId: message.id });
        }
      }
    }

    return messages;
  },
};
