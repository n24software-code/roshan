-- =============================================================
-- Image storage
--
-- One public bucket holds every image the storefront needs. Reads are public
-- because the storefront and next/image fetch them anonymously; every write is
-- restricted to accounts holding the `admin` role.
--
-- The bucket also enforces the size and MIME allow-list itself, so the limits
-- hold even if a caller bypasses the application's own checks.
-- =============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-images',
  'menu-images',
  true,
  5242880,                                             -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------- policies ----------
-- Anyone may read: the storefront is public and unauthenticated.
drop policy if exists menu_images_public_read on storage.objects;
create policy menu_images_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'menu-images');

-- Only admins may add, replace or remove images.
drop policy if exists menu_images_admin_insert on storage.objects;
create policy menu_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-images' and public.is_admin());

drop policy if exists menu_images_admin_update on storage.objects;
create policy menu_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-images' and public.is_admin())
  with check (bucket_id = 'menu-images' and public.is_admin());

drop policy if exists menu_images_admin_delete on storage.objects;
create policy menu_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-images' and public.is_admin());
