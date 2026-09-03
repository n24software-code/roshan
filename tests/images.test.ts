import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  checkImageFile,
  extensionFor,
  isAllowedType,
  sanitizeSegment,
  sniffImageType,
} from '@/lib/images/config';
import { isStoredObject, resolveImageUrl } from '@/lib/images/url';
import { menuItemFormSchema, restaurantFormSchema } from '@/lib/validation/schemas';

const UUID = '0f1e2d3c-4b5a-6978-8765-4321fedcba09';

/** Builds the leading bytes of a file with the given signature. */
function bytes(...values: number[]): Uint8Array {
  const buffer = new Uint8Array(16);
  values.forEach((value, index) => {
    buffer[index] = value;
  });
  return buffer;
}

describe('file type rules', () => {
  it('accepts jpg, jpeg, png and webp', () => {
    for (const [name, type] of [
      ['photo.jpg', 'image/jpeg'],
      ['photo.jpeg', 'image/jpeg'],
      ['photo.png', 'image/png'],
      ['photo.webp', 'image/webp'],
    ] as const) {
      expect(checkImageFile({ name, type, size: 1000 }).ok, name).toBe(true);
    }
  });

  it('rejects svg, gif, pdf, exe and zip', () => {
    for (const [name, type] of [
      ['icon.svg', 'image/svg+xml'],
      ['loop.gif', 'image/gif'],
      ['menu.pdf', 'application/pdf'],
      ['setup.exe', 'application/x-msdownload'],
      ['bundle.zip', 'application/zip'],
    ] as const) {
      const result = checkImageFile({ name, type, size: 1000 });
      expect(result.ok, name).toBe(false);
    }
  });

  it('rejects a disallowed file renamed to .jpg — the MIME type is checked too', () => {
    expect(checkImageFile({ name: 'payload.jpg', type: 'image/svg+xml', size: 1000 }).ok).toBe(
      false,
    );
  });

  it('rejects a jpg whose extension was swapped to .exe', () => {
    expect(checkImageFile({ name: 'photo.exe', type: 'image/jpeg', size: 1000 }).ok).toBe(false);
  });

  it('accepts a file exactly at the limit and rejects one byte over', () => {
    expect(checkImageFile({ name: 'a.jpg', type: 'image/jpeg', size: MAX_IMAGE_BYTES }).ok).toBe(
      true,
    );

    const over = checkImageFile({
      name: 'a.jpg',
      type: 'image/jpeg',
      size: MAX_IMAGE_BYTES + 1,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toContain('5.0 MB or smaller');
  });

  it('rejects an empty file', () => {
    expect(checkImageFile({ name: 'a.jpg', type: 'image/jpeg', size: 0 }).ok).toBe(false);
  });

  it('maps allowed types to extensions', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/webp')).toBe('webp');
    expect(isAllowedType('image/gif')).toBe(false);
  });
});

describe('magic byte sniffing', () => {
  it('recognises real JPEG, PNG and WebP signatures', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(
      sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50)),
    ).toBe('image/webp');
  });

  it('rejects content that only claims to be an image', () => {
    // "<svg" — an SVG renamed to .jpg with a spoofed MIME type.
    expect(sniffImageType(bytes(0x3c, 0x73, 0x76, 0x67))).toBeNull();
    // "MZ" — a Windows executable.
    expect(sniffImageType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
    // "%PDF"
    expect(sniffImageType(bytes(0x25, 0x50, 0x44, 0x46))).toBeNull();
    // "PK" — a zip archive.
    expect(sniffImageType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
    // GIF89a
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBeNull();
  });

  it('rejects a truncated file', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe('storage key safety', () => {
  it('strips anything that could escape the folder', () => {
    expect(sanitizeSegment('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeSegment('Robert"); DROP TABLE--')).toBe('robert-drop-table');
    expect(sanitizeSegment('abc-123')).toBe('abc-123');
  });

  it('caps the length', () => {
    expect(sanitizeSegment('a'.repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe('image reference resolution', () => {
  it('passes through legacy absolute URLs', () => {
    expect(resolveImageUrl('https://images.example/a.jpg')).toBe('https://images.example/a.jpg');
  });

  it('passes through files shipped in /public', () => {
    expect(resolveImageUrl('/menu/kfc-logo.jpg')).toBe('/menu/kfc-logo.jpg');
  });

  it('builds a public storage URL for an uploaded object', () => {
    const url = resolveImageUrl(`restaurants/abc/${UUID}.jpg`);
    expect(url).toContain('/storage/v1/object/public/menu-images/');
    expect(url).toContain(`restaurants/abc/${UUID}.jpg`);
  });

  it('returns null when there is no image, so a placeholder can render', () => {
    expect(resolveImageUrl(null)).toBeNull();
    expect(resolveImageUrl('')).toBeNull();
    expect(resolveImageUrl('   ')).toBeNull();
    expect(resolveImageUrl(undefined)).toBeNull();
  });

  it('knows which references are objects we own', () => {
    expect(isStoredObject(`menu-items/x/${UUID}.png`)).toBe(true);
    expect(isStoredObject('/menu/kfc-logo.jpg')).toBe(false);
    expect(isStoredObject('https://images.example/a.jpg')).toBe(false);
    expect(isStoredObject(null)).toBe(false);
  });
});

describe('image reference validation', () => {
  const restaurant = {
    name_en: 'KFC',
    name_ar: 'كنتاكي',
    slug: 'kfc',
    display_order: 1,
    status: 'active' as const,
    event_ids: [],
  };

  const parse = (logo_url: unknown) => restaurantFormSchema.safeParse({ ...restaurant, logo_url });

  it('accepts every shape that already exists in the database', () => {
    expect(parse('/menu/kfc-logo.jpg').success).toBe(true);
    expect(parse('https://images.unsplash.com/photo-1.jpg').success).toBe(true);
    expect(parse('').success).toBe(true);
    expect(parse(null).success).toBe(true);
    expect(parse(undefined).success).toBe(true);
  });

  it('accepts an uploaded storage object path', () => {
    expect(parse(`restaurants/abc-123/${UUID}.jpg`).success).toBe(true);
    expect(parse(`events/abc-123/${UUID}.webp`).success).toBe(true);
  });

  it('rejects script and data URIs', () => {
    expect(parse('javascript:alert(1)').success).toBe(false);
    expect(parse('data:image/svg+xml;base64,PHN2Zz4=').success).toBe(false);
    expect(parse('vbscript:msgbox(1)').success).toBe(false);
  });

  it('rejects path traversal in a storage reference', () => {
    expect(parse('restaurants/../../secret.jpg').success).toBe(false);
    expect(parse('../../../etc/passwd').success).toBe(false);
  });

  it('rejects an object path outside the known folders', () => {
    expect(parse(`secrets/abc/${UUID}.jpg`).success).toBe(false);
  });

  it('applies the same rules to menu items', () => {
    const item = {
      restaurant_id: '11111111-2222-4333-8444-555555555555',
      category_id: '11111111-2222-4333-8444-555555555556',
      name_en: 'Zinger',
      name_ar: 'زنجر',
      price: 45,
      is_available: true,
      display_order: 1,
    };
    expect(menuItemFormSchema.safeParse({ ...item, image_url: '/menu/a.jpg' }).success).toBe(true);
    expect(
      menuItemFormSchema.safeParse({ ...item, image_url: `menu-items/x/${UUID}.png` }).success,
    ).toBe(true);
    expect(
      menuItemFormSchema.safeParse({ ...item, image_url: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });
});
