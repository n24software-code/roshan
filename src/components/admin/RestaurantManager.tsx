'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteRestaurant, saveRestaurant, setRestaurantStatus } from '@/lib/admin/actions';
import { Modal } from './Modal';
import { useToast } from './Toaster';
import { FormRow, Toggle, adminInput, adminTextarea } from './AdminForm';
import { Button } from '@/components/ui/Button';
import { TableShell, Td, Th } from './DataTable';
import type { EventRow, RestaurantRow } from '@/types/database';

type Restaurant = RestaurantRow & { event_restaurants: { event_id: string }[] };

const BLANK = {
  name_en: '',
  name_ar: '',
  slug: '',
  description_en: '',
  description_ar: '',
  cuisine_en: '',
  cuisine_ar: '',
  logo_url: '',
  cover_image_url: '',
  display_order: 0,
  status: 'active' as const,
};

type FormState = typeof BLANK & { id?: string; event_ids: string[] };

function toForm(restaurant: Restaurant): FormState {
  return {
    id: restaurant.id,
    name_en: restaurant.name_en,
    name_ar: restaurant.name_ar,
    slug: restaurant.slug,
    description_en: restaurant.description_en ?? '',
    description_ar: restaurant.description_ar ?? '',
    cuisine_en: restaurant.cuisine_en ?? '',
    cuisine_ar: restaurant.cuisine_ar ?? '',
    logo_url: restaurant.logo_url ?? '',
    cover_image_url: restaurant.cover_image_url ?? '',
    display_order: restaurant.display_order,
    status: restaurant.status as 'active',
    event_ids: restaurant.event_restaurants.map((link) => link.event_id),
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function RestaurantManager({
  restaurants,
  events,
}: {
  restaurants: Restaurant[];
  events: EventRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Restaurant | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function save() {
    if (!form) return;
    setError(null);
    startTransition(async () => {
      const result = await saveRestaurant(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: form.id ? 'Restaurant updated' : 'Restaurant created', tone: 'success' });
      setForm(null);
      router.refresh();
    });
  }

  function toggleStatus(restaurant: Restaurant) {
    const next = restaurant.status === 'active' ? 'disabled' : 'active';
    startTransition(async () => {
      const result = await setRestaurantStatus(restaurant.id, next);
      if (!result.ok) {
        toast({ title: 'Could not change the status', body: result.error, tone: 'error' });
        return;
      }
      toast({
        title: `${restaurant.name_en} is now ${next}`,
        body:
          next === 'disabled'
            ? 'New orders are blocked. Existing orders are unaffected.'
            : 'The restaurant is accepting orders again.',
        tone: 'success',
      });
      router.refresh();
    });
  }

  function remove() {
    if (!confirmDelete) return;
    startTransition(async () => {
      const result = await deleteRestaurant(confirmDelete.id);
      if (!result.ok) {
        toast({ title: 'Could not delete', body: result.error, tone: 'error' });
        setConfirmDelete(null);
        return;
      }
      toast({ title: 'Restaurant deleted', tone: 'success' });
      setConfirmDelete(null);
      router.refresh();
    });
  }

  return (
    <>
      <div className="mb-5 flex justify-end">
        <Button
          size="sm"
          onClick={() =>
            setForm({
              ...BLANK,
              event_ids: events.filter((e) => e.status === 'active').map((e) => e.id),
            })
          }
        >
          + Add restaurant
        </Button>
      </div>

      <TableShell
        isEmpty={restaurants.length === 0}
        empty={
          <>
            <p className="font-semibold text-ink-800">No restaurants yet.</p>
            <p className="mt-1 text-sm text-ink-500">No restaurants have been added yet.</p>
          </>
        }
        head={
          <>
            <Th>Restaurant</Th>
            <Th>Cuisine</Th>
            <Th>Events</Th>
            <Th className="text-center">Order</Th>
            <Th>Status</Th>
            <Th className="text-right">Actions</Th>
          </>
        }
      >
        {restaurants.map((restaurant) => (
          <tr key={restaurant.id} className="transition-colors hover:bg-sand-50">
            <Td>
              <div className="flex items-center gap-3">
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-sand-200">
                  {restaurant.logo_url && (
                    <Image
                      src={restaurant.logo_url}
                      alt=""
                      fill
                      sizes="40px"
                      className="object-cover"
                    />
                  )}
                </div>
                <div>
                  <p className="font-bold text-ink-900">{restaurant.name_en}</p>
                  <p className="text-xs text-ink-500">{restaurant.name_ar}</p>
                </div>
              </div>
            </Td>
            <Td>{restaurant.cuisine_en ?? '—'}</Td>
            <Td className="numeric">{restaurant.event_restaurants.length}</Td>
            <Td className="numeric text-center">{restaurant.display_order}</Td>
            <Td>
              <span
                className={
                  restaurant.status === 'active'
                    ? 'inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-800'
                    : 'inline-flex items-center gap-1.5 rounded-full border border-sand-300 bg-sand-100 px-2.5 py-1 text-xs font-bold text-ink-600'
                }
              >
                <span aria-hidden="true">{restaurant.status === 'active' ? '●' : '○'}</span>
                {restaurant.status === 'active' ? 'Active' : 'Disabled'}
              </span>
            </Td>
            <Td className="text-right whitespace-nowrap">
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleStatus(restaurant)}
                  disabled={pending}
                >
                  {restaurant.status === 'active' ? 'Disable' : 'Activate'}
                </Button>
                <Link
                  href={`/admin/menu?restaurant=${restaurant.id}`}
                  className="rounded-full px-3.5 py-1.5 text-sm font-semibold text-ink-700 hover:bg-sand-100"
                >
                  Menu
                </Link>
                <Button size="sm" variant="secondary" onClick={() => setForm(toForm(restaurant))}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(restaurant)}>
                  Delete
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </TableShell>

      {/* ------------------------------------------------------ edit dialog */}
      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        wide
        title={form?.id ? 'Edit restaurant' : 'Add restaurant'}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? 'Saving...' : 'Save restaurant'}
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-5">
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
              >
                {error}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Name (English)" htmlFor="r-name-en" required>
                <input
                  id="r-name-en"
                  className={adminInput}
                  value={form.name_en}
                  onChange={(event) => {
                    update('name_en', event.target.value);
                    if (!form.id && !form.slug) update('slug', slugify(event.target.value));
                  }}
                />
              </FormRow>
              <FormRow label="Name (Arabic)" htmlFor="r-name-ar" required>
                <input
                  id="r-name-ar"
                  dir="rtl"
                  className={adminInput}
                  value={form.name_ar}
                  onChange={(event) => update('name_ar', event.target.value)}
                />
              </FormRow>
            </div>

            <FormRow label="Slug" htmlFor="r-slug" required hint="Used in the storefront URL.">
              <input
                id="r-slug"
                className={adminInput}
                value={form.slug}
                onChange={(event) => update('slug', slugify(event.target.value))}
              />
            </FormRow>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Description (English)" htmlFor="r-desc-en">
                <textarea
                  id="r-desc-en"
                  className={adminTextarea}
                  value={form.description_en}
                  onChange={(event) => update('description_en', event.target.value)}
                />
              </FormRow>
              <FormRow label="Description (Arabic)" htmlFor="r-desc-ar">
                <textarea
                  id="r-desc-ar"
                  dir="rtl"
                  className={adminTextarea}
                  value={form.description_ar}
                  onChange={(event) => update('description_ar', event.target.value)}
                />
              </FormRow>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Cuisine (English)" htmlFor="r-cuisine-en">
                <input
                  id="r-cuisine-en"
                  className={adminInput}
                  value={form.cuisine_en}
                  onChange={(event) => update('cuisine_en', event.target.value)}
                />
              </FormRow>
              <FormRow label="Cuisine (Arabic)" htmlFor="r-cuisine-ar">
                <input
                  id="r-cuisine-ar"
                  dir="rtl"
                  className={adminInput}
                  value={form.cuisine_ar}
                  onChange={(event) => update('cuisine_ar', event.target.value)}
                />
              </FormRow>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Logo URL" htmlFor="r-logo">
                <input
                  id="r-logo"
                  className={adminInput}
                  value={form.logo_url}
                  onChange={(event) => update('logo_url', event.target.value)}
                  placeholder="https://..."
                />
              </FormRow>
              <FormRow label="Cover image URL" htmlFor="r-cover">
                <input
                  id="r-cover"
                  className={adminInput}
                  value={form.cover_image_url}
                  onChange={(event) => update('cover_image_url', event.target.value)}
                  placeholder="https://..."
                />
              </FormRow>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Display order" htmlFor="r-order">
                <input
                  id="r-order"
                  type="number"
                  min={0}
                  className={adminInput}
                  value={form.display_order}
                  onChange={(event) => update('display_order', Number(event.target.value))}
                />
              </FormRow>
              <FormRow label="Status" htmlFor="r-status">
                <div className="pt-2">
                  <Toggle
                    checked={form.status === 'active'}
                    onChange={(next) =>
                      update('status', (next ? 'active' : 'disabled') as 'active')
                    }
                    label={form.status === 'active' ? 'Active' : 'Disabled'}
                  />
                </div>
              </FormRow>
            </div>

            <fieldset>
              <legend className="text-sm font-semibold text-ink-700">Events</legend>
              <p className="mt-1 mb-2 text-xs text-ink-500">
                Guests can only order from a restaurant that takes part in the running event.
              </p>
              <div className="space-y-2">
                {events.map((event) => (
                  <label key={event.id} className="flex items-center gap-2.5 text-sm text-ink-700">
                    <input
                      type="checkbox"
                      checked={form.event_ids.includes(event.id)}
                      onChange={(changeEvent) =>
                        update(
                          'event_ids',
                          changeEvent.target.checked
                            ? [...form.event_ids, event.id]
                            : form.event_ids.filter((id) => id !== event.id),
                        )
                      }
                      className="h-4 w-4 rounded border-sand-300 accent-brand-700"
                    />
                    {event.name_en}
                    <span className="text-xs text-ink-400">({event.status})</span>
                  </label>
                ))}
                {events.length === 0 && (
                  <p className="text-sm text-ink-500">Create an event first.</p>
                )}
              </div>
            </fieldset>
          </div>
        )}
      </Modal>

      {/* --------------------------------------------------- delete dialog */}
      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.name_en ?? ''}?`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={remove} disabled={pending}>
              {pending ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          This removes the restaurant, its categories and its menu items. Restaurants that already
          have orders cannot be deleted — disable them instead.
        </p>
      </Modal>
    </>
  );
}
