'use client';

import { MediaImage } from '@/components/ui/MediaImage';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  deleteCategory,
  deleteMenuItem,
  saveCategory,
  saveMenuItem,
  setMenuItemAvailability,
} from '@/lib/admin/actions';
import { Modal } from './Modal';
import { useToast } from './Toaster';
import { FormRow, Toggle, adminInput, adminSelect, adminTextarea } from './AdminForm';
import { Button } from '@/components/ui/Button';
import { ImageUploader } from './ImageUploader';
import { useUploadTracker } from '@/lib/images/client';
import { TableShell, Td, Th } from './DataTable';
import type { MenuCategoryRow, MenuItemRow, RestaurantRow } from '@/types/database';

type CategoryForm = {
  id?: string;
  restaurant_id: string;
  name_en: string;
  name_ar: string;
  display_order: number;
};

type ItemForm = {
  id?: string;
  restaurant_id: string;
  category_id: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  price: number;
  image_url: string;
  is_available: boolean;
  display_order: number;
};

export function MenuManager({
  restaurants,
  restaurant,
  categories,
  items,
}: {
  restaurants: RestaurantRow[];
  restaurant: RestaurantRow | null;
  categories: MenuCategoryRow[];
  items: MenuItemRow[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [categoryForm, setCategoryForm] = useState<CategoryForm | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploads = useUploadTracker();

  /** Closes the item dialog, removing any image uploaded but never saved. */
  function closeItemForm() {
    void uploads.discard(null);
    setItemForm(null);
  }

  function selectRestaurant(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('restaurant', id);
    else params.delete('restaurant');
    router.replace(`/admin/menu?${params.toString()}`);
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast({ title: 'Action failed', body: result.error, tone: 'error' });
        return;
      }
      toast({ title: success, tone: 'success' });
      router.refresh();
    });
  }

  function saveCategoryForm() {
    if (!categoryForm) return;
    setError(null);
    startTransition(async () => {
      const result = await saveCategory(categoryForm);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: categoryForm.id ? 'Category updated' : 'Category added', tone: 'success' });
      setCategoryForm(null);
      router.refresh();
    });
  }

  function saveItemForm() {
    if (!itemForm) return;
    setError(null);
    startTransition(async () => {
      const result = await saveMenuItem(itemForm);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: itemForm.id ? 'Menu item updated' : 'Menu item added', tone: 'success' });
      void uploads.discard(itemForm.image_url || null);
      setItemForm(null);
      router.refresh();
    });
  }

  const categoryName = (id: string | null) =>
    categories.find((category) => category.id === id)?.name_en ?? '—';

  return (
    <>
      {/* ------------------------------------------------ restaurant picker */}
      <div className="card-surface mb-6 flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="menu-restaurant" className="block text-sm font-semibold text-ink-700">
            Restaurant
          </label>
          <select
            id="menu-restaurant"
            value={restaurant?.id ?? ''}
            onChange={(event) => selectRestaurant(event.target.value)}
            className={`${adminSelect} mt-1.5`}
          >
            <option value="">Select a restaurant…</option>
            {restaurants.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name_en}
                {entry.status === 'disabled' ? ' (disabled)' : ''}
              </option>
            ))}
          </select>
        </div>

        {restaurant && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setCategoryForm({
                  restaurant_id: restaurant.id,
                  name_en: '',
                  name_ar: '',
                  display_order: categories.length + 1,
                })
              }
            >
              + Add category
            </Button>
            <Button
              size="sm"
              disabled={categories.length === 0}
              onClick={() =>
                setItemForm({
                  restaurant_id: restaurant.id,
                  category_id: categories[0]?.id ?? '',
                  name_en: '',
                  name_ar: '',
                  description_en: '',
                  description_ar: '',
                  price: 0,
                  image_url: '',
                  is_available: true,
                  display_order: items.length + 1,
                })
              }
            >
              + Add item
            </Button>
          </div>
        )}
      </div>

      {!restaurant ? (
        <div className="card-surface px-6 py-16 text-center">
          <p className="font-semibold text-ink-800">Select a restaurant</p>
          <p className="mt-1 text-sm text-ink-500">
            Choose a restaurant above to manage its categories and menu items.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* ------------------------------------------------- categories */}
          <section aria-labelledby="categories-heading">
            <h2 id="categories-heading" className="mb-3 text-lg font-extrabold text-ink-900">
              Categories
            </h2>
            <TableShell
              isEmpty={categories.length === 0}
              empty={
                <>
                  <p className="font-semibold text-ink-800">No categories yet.</p>
                  <p className="mt-1 text-sm text-ink-500">
                    Add a category before adding menu items.
                  </p>
                </>
              }
              head={
                <>
                  <Th>Name (EN)</Th>
                  <Th>Name (AR)</Th>
                  <Th className="text-center">Order</Th>
                  <Th className="text-center">Items</Th>
                  <Th className="text-right">Actions</Th>
                </>
              }
            >
              {categories.map((category) => (
                <tr key={category.id} className="hover:bg-sand-50">
                  <Td className="font-semibold text-ink-900">{category.name_en}</Td>
                  <Td dir="rtl">{category.name_ar}</Td>
                  <Td className="numeric text-center">{category.display_order}</Td>
                  <Td className="numeric text-center">
                    {items.filter((item) => item.category_id === category.id).length}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setCategoryForm({
                            id: category.id,
                            restaurant_id: category.restaurant_id,
                            name_en: category.name_en,
                            name_ar: category.name_ar,
                            display_order: category.display_order,
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => run(() => deleteCategory(category.id), 'Category deleted')}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </TableShell>
          </section>

          {/* ------------------------------------------------------ items */}
          <section aria-labelledby="items-heading">
            <h2 id="items-heading" className="mb-3 text-lg font-extrabold text-ink-900">
              Menu items
            </h2>
            <TableShell
              isEmpty={items.length === 0}
              empty={
                <>
                  <p className="font-semibold text-ink-800">No menu items available.</p>
                  <p className="mt-1 text-sm text-ink-500">Add the first item for this menu.</p>
                </>
              }
              head={
                <>
                  <Th>Item</Th>
                  <Th>Category</Th>
                  <Th className="text-right">Price</Th>
                  <Th className="text-center">Order</Th>
                  <Th>Available</Th>
                  <Th className="text-right">Actions</Th>
                </>
              }
            >
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-sand-50">
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-sand-200">
                        <MediaImage reference={item.image_url} alt="" sizes="40px" />
                      </div>
                      <div>
                        <p className="font-bold text-ink-900">{item.name_en}</p>
                        <p className="text-xs text-ink-500">{item.name_ar}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>{categoryName(item.category_id)}</Td>
                  <Td className="numeric text-right font-semibold">
                    SAR {Number(item.price).toFixed(2)}
                  </Td>
                  <Td className="numeric text-center">{item.display_order}</Td>
                  <Td>
                    <Toggle
                      checked={item.is_available}
                      disabled={pending}
                      label={item.is_available ? 'Available' : 'Unavailable'}
                      onChange={(next) =>
                        run(
                          () => setMenuItemAvailability(item.id, next),
                          next ? 'Item is available' : 'Item is unavailable',
                        )
                      }
                    />
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setItemForm({
                            id: item.id,
                            restaurant_id: item.restaurant_id,
                            category_id: item.category_id ?? categories[0]?.id ?? '',
                            name_en: item.name_en,
                            name_ar: item.name_ar,
                            description_en: item.description_en ?? '',
                            description_ar: item.description_ar ?? '',
                            price: Number(item.price),
                            image_url: item.image_url ?? '',
                            is_available: item.is_available,
                            display_order: item.display_order,
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => run(() => deleteMenuItem(item.id), 'Menu item deleted')}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </TableShell>
          </section>
        </div>
      )}

      {/* --------------------------------------------------- category modal */}
      <Modal
        open={categoryForm !== null}
        onClose={() => setCategoryForm(null)}
        title={categoryForm?.id ? 'Edit category' : 'Add category'}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCategoryForm(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveCategoryForm} disabled={pending}>
              {pending ? 'Saving...' : 'Save category'}
            </Button>
          </>
        }
      >
        {categoryForm && (
          <div className="space-y-4">
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
              >
                {error}
              </p>
            )}
            <FormRow label="Name (English)" htmlFor="c-name-en" required>
              <input
                id="c-name-en"
                className={adminInput}
                value={categoryForm.name_en}
                onChange={(event) =>
                  setCategoryForm({ ...categoryForm, name_en: event.target.value })
                }
              />
            </FormRow>
            <FormRow label="Name (Arabic)" htmlFor="c-name-ar" required>
              <input
                id="c-name-ar"
                dir="rtl"
                className={adminInput}
                value={categoryForm.name_ar}
                onChange={(event) =>
                  setCategoryForm({ ...categoryForm, name_ar: event.target.value })
                }
              />
            </FormRow>
            <FormRow label="Display order" htmlFor="c-order">
              <input
                id="c-order"
                type="number"
                min={0}
                className={adminInput}
                value={categoryForm.display_order}
                onChange={(event) =>
                  setCategoryForm({ ...categoryForm, display_order: Number(event.target.value) })
                }
              />
            </FormRow>
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------- item modal */}
      <Modal
        open={itemForm !== null}
        onClose={closeItemForm}
        wide
        title={itemForm?.id ? 'Edit menu item' : 'Add menu item'}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={closeItemForm}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveItemForm} disabled={pending}>
              {pending ? 'Saving...' : 'Save item'}
            </Button>
          </>
        }
      >
        {itemForm && (
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
              <FormRow label="Name (English)" htmlFor="i-name-en" required>
                <input
                  id="i-name-en"
                  className={adminInput}
                  value={itemForm.name_en}
                  onChange={(event) => setItemForm({ ...itemForm, name_en: event.target.value })}
                />
              </FormRow>
              <FormRow label="Name (Arabic)" htmlFor="i-name-ar" required>
                <input
                  id="i-name-ar"
                  dir="rtl"
                  className={adminInput}
                  value={itemForm.name_ar}
                  onChange={(event) => setItemForm({ ...itemForm, name_ar: event.target.value })}
                />
              </FormRow>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Description (English)" htmlFor="i-desc-en">
                <textarea
                  id="i-desc-en"
                  className={adminTextarea}
                  value={itemForm.description_en}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, description_en: event.target.value })
                  }
                />
              </FormRow>
              <FormRow label="Description (Arabic)" htmlFor="i-desc-ar">
                <textarea
                  id="i-desc-ar"
                  dir="rtl"
                  className={adminTextarea}
                  value={itemForm.description_ar}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, description_ar: event.target.value })
                  }
                />
              </FormRow>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormRow label="Price (SAR)" htmlFor="i-price" required>
                <input
                  id="i-price"
                  type="number"
                  min={0}
                  step="0.01"
                  className={adminInput}
                  value={itemForm.price}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, price: Number(event.target.value) })
                  }
                />
              </FormRow>
              <FormRow label="Category" htmlFor="i-category" required>
                <select
                  id="i-category"
                  className={adminSelect}
                  value={itemForm.category_id}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, category_id: event.target.value })
                  }
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name_en}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Display order" htmlFor="i-order">
                <input
                  id="i-order"
                  type="number"
                  min={0}
                  className={adminInput}
                  value={itemForm.display_order}
                  onChange={(event) =>
                    setItemForm({ ...itemForm, display_order: Number(event.target.value) })
                  }
                />
              </FormRow>
            </div>

            <ImageUploader
              label="Menu item image"
              folder="menu-items"
              owner={itemForm.id ?? 'new'}
              value={itemForm.image_url || null}
              onUploaded={uploads.track}
              onChange={(next) => setItemForm({ ...itemForm, image_url: next ?? '' })}
              hint="Shown on the menu card in both languages."
            />

            <Toggle
              checked={itemForm.is_available}
              onChange={(next) => setItemForm({ ...itemForm, is_available: next })}
              label={itemForm.is_available ? 'Available to order' : 'Unavailable'}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
