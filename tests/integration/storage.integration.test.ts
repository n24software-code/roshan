/**
 * Exercises the real storage lifecycle helpers against a live Supabase project.
 * Skipped automatically when no service-role key is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { IMAGE_BUCKET } from '@/lib/images/config';
import { cleanupReplacedImage, deleteImageObject, uploadImageObject } from '@/lib/images/storage';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const live = Boolean(url && serviceKey);
const describeLive = live ? describe : describe.skip;

/** Smallest valid JPEG header plus padding — enough for a real upload. */
function jpegBytes(): ArrayBuffer {
  const buffer = new Uint8Array(64);
  buffer.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return buffer.buffer;
}

describeLive('image storage lifecycle', () => {
  let admin: SupabaseClient;
  const created: string[] = [];

  const key = (name: string) =>
    `menu-items/vitest-fixture/${name}-0f1e2d3c-4b5a-6978-8765-4321fedcba09.jpg`;

  async function exists(path: string) {
    const folder = path.split('/').slice(0, -1).join('/');
    const file = path.split('/').pop();
    const { data } = await admin.storage.from(IMAGE_BUCKET).list(folder);
    return (data ?? []).some((entry) => entry.name === file);
  }

  beforeAll(() => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  });

  afterAll(async () => {
    if (!live) return;
    await admin.storage.from(IMAGE_BUCKET).remove(created);
  });

  it('uploads an object and it becomes readable', async () => {
    const path = key('upload');
    created.push(path);

    const result = await uploadImageObject(path, jpegBytes(), 'image/jpeg');
    expect(result.ok).toBe(true);
    expect(await exists(path)).toBe(true);
  });

  it('deletes the previous object once the new one is in place', async () => {
    const oldPath = key('old');
    const newPath = key('new');
    created.push(oldPath, newPath);

    await uploadImageObject(oldPath, jpegBytes(), 'image/jpeg');
    await uploadImageObject(newPath, jpegBytes(), 'image/jpeg');
    expect(await exists(oldPath)).toBe(true);

    const warning = await cleanupReplacedImage(oldPath, newPath);

    expect(warning).toBeNull();
    expect(await exists(oldPath)).toBe(false);
    expect(await exists(newPath), 'the replacement must survive').toBe(true);
  });

  it('keeps the object when the reference did not change', async () => {
    const path = key('unchanged');
    created.push(path);
    await uploadImageObject(path, jpegBytes(), 'image/jpeg');

    await cleanupReplacedImage(path, path);

    expect(await exists(path)).toBe(true);
  });

  it('never deletes files shipped in /public or external URLs', async () => {
    // These are not ours to remove — the seeded KFC images live in /public.
    expect(await cleanupReplacedImage('/menu/kfc-logo.jpg', 'menu-items/x/y.jpg')).toBeNull();
    expect(
      await cleanupReplacedImage('https://images.example/a.jpg', 'menu-items/x/y.jpg'),
    ).toBeNull();

    const response = await fetch(`${url}/menu/kfc-logo.jpg`).catch(() => null);
    void response; // the point is simply that no delete was attempted
  });

  it('removing an image clears storage', async () => {
    const path = key('removed');
    created.push(path);
    await uploadImageObject(path, jpegBytes(), 'image/jpeg');
    expect(await exists(path)).toBe(true);

    const result = await deleteImageObject(path);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.removed).toBe(true);
    expect(await exists(path)).toBe(false);
  });

  it('reports no-op for references that are not storage objects', async () => {
    const result = await deleteImageObject('/menu/kfc-logo.jpg');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.removed).toBe(false);
  });
});
