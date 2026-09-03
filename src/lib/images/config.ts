/**
 * Shared image rules. Imported by the browser uploader, the upload route and the
 * tests, so the client and the server can never disagree about what is allowed.
 */

export const IMAGE_BUCKET = 'menu-images';

/** 5 MB — mirrored by the bucket's own `file_size_limit`. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** `accept` attribute for the file input. */
export const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

const EXTENSION_BY_TYPE: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const MAX_IMAGE_LABEL = formatBytes(MAX_IMAGE_BYTES);

export function isAllowedType(type: string): type is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

export function extensionFor(type: AllowedImageType): string {
  return EXTENSION_BY_TYPE[type];
}

export type ImageCheck = { ok: true } | { ok: false; error: string };

/**
 * Extension + declared MIME + size. Both the extension and the MIME type must
 * be on the allow-list, so renaming `payload.svg` to `photo.jpg` fails here and
 * a spoofed MIME still has to survive the magic-byte check on the server.
 */
export function checkImageFile(file: { name: string; type: string; size: number }): ImageCheck {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return { ok: false, error: 'Choose a JPG, PNG or WebP image.' };
  }
  if (!isAllowedType(file.type)) {
    return { ok: false, error: 'Choose a JPG, PNG or WebP image.' };
  }
  if (file.size === 0) {
    return { ok: false, error: 'That file is empty.' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `Image must be ${MAX_IMAGE_LABEL} or smaller. That one is ${formatBytes(file.size)}.`,
    };
  }
  return { ok: true };
}

/**
 * Content sniffing from the leading bytes. The browser-reported MIME type is
 * attacker-controlled, so the server confirms the bytes really are an image.
 * Returns the detected type, or null when the signature is not recognised.
 */
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b)) return 'image/png';

  // WebP: "RIFF" .... "WEBP"
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  if (riff.every((b, i) => bytes[i] === b) && webp.every((b, i) => bytes[8 + i] === b)) {
    return 'image/webp';
  }

  return null;
}

/** Strips anything that could escape the intended folder in a storage key. */
export function sanitizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}
