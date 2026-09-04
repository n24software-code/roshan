/**
 * Verification provider contract.
 *
 * Everything WhatsApp-specific lives behind this interface so the channel can be
 * swapped (a different WhatsApp BSP, SMS, Telegram) without touching the
 * database functions, the server actions or the UI.
 */

export interface IncomingMessage {
  /** Sender as reported by the provider — the only trustworthy identity here. */
  from: string;
  text: string;
  providerMessageId?: string;
}

export interface WebhookChallenge {
  status: number;
  body: string;
}

export interface VerificationProvider {
  /** Stored on the verification row for auditing. */
  readonly id: string;
  /** True for providers that must never run in production. */
  readonly isDevelopment: boolean;

  /** Whether the environment carries everything this provider needs. */
  isConfigured(): boolean;

  /**
   * Deep link that opens WhatsApp with the message prefilled, or null when no
   * business number is configured (development).
   */
  buildHandoffUrl(message: string): string | null;

  /** Provider webhook handshake (Meta sends a GET before it will deliver). */
  handleWebhookChallenge(url: URL): WebhookChallenge | null;

  /** Rejects payloads that did not come from the provider. */
  verifyWebhookSignature(rawBody: string, headers: Headers): boolean;

  /** Extracts the inbound text messages from a provider payload. */
  parseIncomingMessages(payload: unknown): IncomingMessage[];
}
