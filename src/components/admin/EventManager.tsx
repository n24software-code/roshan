'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveEvent, setEventStatus } from '@/lib/admin/actions';
import { Modal } from './Modal';
import { useToast } from './Toaster';
import { FormRow, adminInput, adminSelect, adminTextarea } from './AdminForm';
import { Button } from '@/components/ui/Button';
import { TableShell, Td, Th } from './DataTable';
import { ImageUploader } from './ImageUploader';
import { useUploadTracker } from '@/lib/images/client';
import { cn } from '@/lib/cn';
import type { EventRow, EventStatus } from '@/types/database';

type FormState = {
  id?: string;
  name_en: string;
  name_ar: string;
  slug: string;
  description_en: string;
  description_ar: string;
  logo_url: string;
  hero_image_url: string;
  order_prefix: string;
  start_date: string;
  end_date: string;
  status: EventStatus;
};

const BLANK: FormState = {
  name_en: '',
  name_ar: '',
  slug: '',
  description_en: '',
  description_ar: '',
  logo_url: '',
  hero_image_url: '',
  order_prefix: 'A',
  start_date: '',
  end_date: '',
  status: 'draft',
};

/** ISO timestamp -> value for <input type="datetime-local">. */
function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const STATUS_STYLE: Record<EventStatus, string> = {
  active: 'border-brand-200 bg-brand-50 text-brand-800',
  inactive: 'border-sand-300 bg-sand-100 text-ink-600',
  draft: 'border-amber-200 bg-amber-50 text-amber-900',
};

export function EventManager({ events }: { events: EventRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploads = useUploadTracker();

  /** Closes the dialog, removing any images uploaded but never saved. */
  function closeForm() {
    void uploads.discard(null);
    setForm(null);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function save() {
    if (!form) return;
    setError(null);
    startTransition(async () => {
      const payload = {
        ...form,
        start_date: form.start_date ? new Date(form.start_date).toISOString() : null,
        end_date: form.end_date ? new Date(form.end_date).toISOString() : null,
      };
      const result = await saveEvent(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: form.id ? 'Event updated' : 'Event created', tone: 'success' });
      void uploads.discard(null);
      setForm(null);
      router.refresh();
    });
  }

  function changeStatus(event: EventRow, status: EventStatus) {
    startTransition(async () => {
      const result = await setEventStatus(event.id, status);
      if (!result.ok) {
        toast({ title: 'Could not change the status', body: result.error, tone: 'error' });
        return;
      }
      toast({
        title: `${event.name_en} is now ${status}`,
        body: status === 'active' ? 'Any other active event has been stood down.' : undefined,
        tone: 'success',
      });
      router.refresh();
    });
  }

  return (
    <>
      <div className="mb-5 flex justify-end">
        <Button size="sm" onClick={() => setForm({ ...BLANK })}>
          + Create event
        </Button>
      </div>

      <TableShell
        isEmpty={events.length === 0}
        empty={
          <>
            <p className="font-semibold text-ink-800">No events yet.</p>
            <p className="mt-1 text-sm text-ink-500">Create an event to start taking orders.</p>
          </>
        }
        head={
          <>
            <Th>Event</Th>
            <Th>Slug</Th>
            <Th>Dates</Th>
            <Th className="text-center">Prefix</Th>
            <Th>Status</Th>
            <Th className="text-right">Actions</Th>
          </>
        }
      >
        {events.map((event) => (
          <tr key={event.id} className="hover:bg-sand-50">
            <Td>
              <p className="font-bold text-ink-900">{event.name_en}</p>
              <p className="text-xs text-ink-500">{event.name_ar}</p>
            </Td>
            <Td className="font-mono text-xs">{event.slug}</Td>
            <Td className="numeric text-xs whitespace-nowrap text-ink-500">
              {event.start_date
                ? new Date(event.start_date).toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                  })
                : '—'}
              {' → '}
              {event.end_date
                ? new Date(event.end_date).toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                  })
                : '—'}
            </Td>
            <Td className="numeric text-center">{event.order_prefix}</Td>
            <Td>
              <span
                className={cn(
                  'inline-flex rounded-full border px-2.5 py-1 text-xs font-bold capitalize',
                  STATUS_STYLE[event.status],
                )}
              >
                {event.status}
              </span>
            </Td>
            <Td className="text-right">
              <div className="flex justify-end gap-2">
                {event.status === 'active' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => changeStatus(event, 'inactive')}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => changeStatus(event, 'active')}
                  >
                    Activate
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setForm({
                      id: event.id,
                      name_en: event.name_en,
                      name_ar: event.name_ar,
                      slug: event.slug,
                      description_en: event.description_en ?? '',
                      description_ar: event.description_ar ?? '',
                      logo_url: event.logo_url ?? '',
                      hero_image_url: event.hero_image_url ?? '',
                      order_prefix: event.order_prefix,
                      start_date: toLocalInput(event.start_date),
                      end_date: toLocalInput(event.end_date),
                      status: event.status,
                    })
                  }
                >
                  Edit
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </TableShell>

      <Modal
        open={form !== null}
        onClose={closeForm}
        wide
        title={form?.id ? 'Edit event' : 'Create event'}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={closeForm}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? 'Saving...' : 'Save event'}
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
              <FormRow label="Event name (English)" htmlFor="e-name-en" required>
                <input
                  id="e-name-en"
                  className={adminInput}
                  value={form.name_en}
                  onChange={(changeEvent) => {
                    update('name_en', changeEvent.target.value);
                    if (!form.id && !form.slug) update('slug', slugify(changeEvent.target.value));
                  }}
                />
              </FormRow>
              <FormRow label="Event name (Arabic)" htmlFor="e-name-ar" required>
                <input
                  id="e-name-ar"
                  dir="rtl"
                  className={adminInput}
                  value={form.name_ar}
                  onChange={(changeEvent) => update('name_ar', changeEvent.target.value)}
                />
              </FormRow>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Slug" htmlFor="e-slug" required>
                <input
                  id="e-slug"
                  className={adminInput}
                  value={form.slug}
                  onChange={(changeEvent) => update('slug', slugify(changeEvent.target.value))}
                />
              </FormRow>
              <FormRow
                label="Order number prefix"
                htmlFor="e-prefix"
                required
                hint="Order numbers look like A-1048."
              >
                <input
                  id="e-prefix"
                  className={adminInput}
                  maxLength={4}
                  value={form.order_prefix}
                  onChange={(changeEvent) =>
                    update('order_prefix', changeEvent.target.value.toUpperCase())
                  }
                />
              </FormRow>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Description (English)" htmlFor="e-desc-en">
                <textarea
                  id="e-desc-en"
                  className={adminTextarea}
                  value={form.description_en}
                  onChange={(changeEvent) => update('description_en', changeEvent.target.value)}
                />
              </FormRow>
              <FormRow label="Description (Arabic)" htmlFor="e-desc-ar">
                <textarea
                  id="e-desc-ar"
                  dir="rtl"
                  className={adminTextarea}
                  value={form.description_ar}
                  onChange={(changeEvent) => update('description_ar', changeEvent.target.value)}
                />
              </FormRow>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <ImageUploader
                label="Event logo"
                folder="events"
                owner={form.id ?? 'new'}
                aspect="square"
                value={form.logo_url || null}
                onUploaded={uploads.track}
                onChange={(next) => update('logo_url', next ?? '')}
              />
              <ImageUploader
                label="Hero image"
                folder="events"
                owner={form.id ?? 'new'}
                value={form.hero_image_url || null}
                onUploaded={uploads.track}
                onChange={(next) => update('hero_image_url', next ?? '')}
                hint="Wide banner behind the storefront title."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormRow label="Start date" htmlFor="e-start">
                <input
                  id="e-start"
                  type="datetime-local"
                  className={adminInput}
                  value={form.start_date}
                  onChange={(changeEvent) => update('start_date', changeEvent.target.value)}
                />
              </FormRow>
              <FormRow label="End date" htmlFor="e-end">
                <input
                  id="e-end"
                  type="datetime-local"
                  className={adminInput}
                  value={form.end_date}
                  onChange={(changeEvent) => update('end_date', changeEvent.target.value)}
                />
              </FormRow>
              <FormRow label="Status" htmlFor="e-status">
                <select
                  id="e-status"
                  className={adminSelect}
                  value={form.status}
                  onChange={(changeEvent) =>
                    update('status', changeEvent.target.value as EventStatus)
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </FormRow>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
