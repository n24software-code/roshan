import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAdminContext, auditLog } from '@/lib/auth/admin';
import {
  checkImageFile,
  extensionFor,
  sanitizeSegment,
  sniffImageType,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LABEL,
} from '@/lib/images/config';
import { deleteImageObject, uploadImageObject } from '@/lib/images/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Folders an admin may upload into — a client cannot invent its own. */
const FOLDERS = ['restaurants', 'menu-items', 'events'] as const;
type Folder = (typeof FOLDERS)[number];

function isFolder(value: string): value is Folder {
  return (FOLDERS as readonly string[]).includes(value);
}

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/**
 * POST — upload one image.
 *
 * Authorization happens first, then the file is validated three ways: declared
 * MIME + extension, byte length, and the actual magic bytes. The stored key is
 * generated server-side from a UUID, so a hostile filename cannot influence it.
 */
export async function POST(request: NextRequest) {
  const context = await getAdminContext();
  if (!context) return bad('Not authorized.', 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad('Could not read the upload.');
  }

  const file = form.get('file');
  const folderRaw = String(form.get('folder') ?? '');
  const ownerRaw = String(form.get('owner') ?? 'new');

  if (!(file instanceof File)) return bad('No file was received.');
  if (!isFolder(folderRaw)) return bad('Unknown upload target.');

  const basic = checkImageFile({ name: file.name, type: file.type, size: file.size });
  if (!basic.ok) return bad(basic.error);

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return bad(`Image must be ${MAX_IMAGE_LABEL} or smaller.`);
  }

  // The declared type is attacker-controlled; trust the bytes instead.
  const sniffed = sniffImageType(new Uint8Array(buffer.slice(0, 16)));
  if (!sniffed) return bad('That file is not a valid JPG, PNG or WebP image.');
  if (sniffed !== file.type) {
    return bad('The file contents do not match its type.');
  }

  const owner = sanitizeSegment(ownerRaw) || 'new';
  const path = `${folderRaw}/${owner}/${randomUUID()}.${extensionFor(sniffed)}`;

  const result = await uploadImageObject(path, buffer, sniffed);
  if (!result.ok) return bad(`Upload failed: ${result.error}`, 502);

  await auditLog(context.supabase, context.user.id, 'image.upload', folderRaw, owner, { path });

  return NextResponse.json({ path });
}

/**
 * DELETE — remove an object the admin just uploaded but did not keep, so a
 * cancelled dialog does not leave an orphan behind.
 */
export async function DELETE(request: NextRequest) {
  const context = await getAdminContext();
  if (!context) return bad('Not authorized.', 403);

  const path = request.nextUrl.searchParams.get('path');
  if (!path) return bad('No path given.');

  const result = await deleteImageObject(path);
  if (!result.ok) return bad(`Could not remove the image: ${result.error}`, 502);

  await auditLog(context.supabase, context.user.id, 'image.delete', 'storage', path);

  return NextResponse.json({ removed: result.removed });
}
