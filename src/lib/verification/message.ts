/**
 * The WhatsApp handoff message.
 *
 * The attendee sends this from their own WhatsApp account, which is what proves
 * they own the number: the webhook reads the sender from the provider payload,
 * never from the message body.
 */

const CODE_LABEL = 'Verification Code';

export function buildVerificationMessage(input: { code: string; phone: string }): string {
  return [
    'ROSHN Event Verification',
    '',
    `Phone: ${input.phone}`,
    `${CODE_LABEL}: ${input.code}`,
    '',
    'Please send this message as it is.',
  ].join('\n');
}

/**
 * Pulls the code out of an inbound message. The labelled form is tried first;
 * a bare six-character token is accepted as a fallback for attendees whose
 * client mangled the prefilled text.
 */
export function extractVerificationCode(text: string): string | null {
  const labelled = text.match(/verification\s*code\s*[:\-]?\s*([A-Za-z0-9]{6})\b/i);
  if (labelled) return labelled[1].toUpperCase();

  const bare = text.match(/\b([A-HJ-NP-Za-hj-np-z2-9]{6})\b/);
  return bare ? bare[1].toUpperCase() : null;
}
