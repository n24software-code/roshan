import { NextResponse, type NextRequest } from 'next/server';
import { getVerificationProvider } from '@/lib/verification/providers';
import { verifyIncomingMessage } from '@/lib/verification/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Inbound WhatsApp webhook.
 *
 * This is the only place a phone number can become verified. Clicking the
 * "Verify via WhatsApp" button does nothing on its own — the number stays
 * pending until a message signed by the provider arrives here from that number
 * carrying a live code.
 */

/** Provider handshake. Meta calls this once before it will deliver messages. */
export async function GET(request: NextRequest) {
  let provider;
  try {
    provider = getVerificationProvider();
  } catch {
    return new NextResponse('Verification provider is not configured.', { status: 503 });
  }

  const challenge = provider.handleWebhookChallenge(new URL(request.url));
  if (!challenge) return new NextResponse('Bad Request', { status: 400 });

  return new NextResponse(challenge.body, {
    status: challenge.status,
    headers: { 'content-type': 'text/plain' },
  });
}

export async function POST(request: NextRequest) {
  let provider;
  try {
    provider = getVerificationProvider();
  } catch {
    return new NextResponse('Verification provider is not configured.', { status: 503 });
  }

  // The signature covers the exact bytes, so the body is read as text first.
  const raw = await request.text();
  if (!provider.verifyWebhookSignature(raw, request.headers)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return new NextResponse('Bad Request', { status: 400 });
  }

  const messages = provider.parseIncomingMessages(payload);

  let verified = 0;
  for (const message of messages) {
    const outcome = await verifyIncomingMessage(message);
    if (outcome === 'verified') verified += 1;
  }

  // Always acknowledge: an unrecognised message is not a delivery failure, and
  // a non-200 makes the provider redeliver the same payload indefinitely.
  return NextResponse.json({ received: messages.length, verified });
}
