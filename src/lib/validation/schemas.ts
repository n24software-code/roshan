import { z } from 'zod';
import { normalizeSaudiPhone } from '@/lib/phone';
import { normalizeEmail } from '@/lib/email';

/** A Saudi mobile number in any accepted format, normalized to E.164 on parse. */
export const saudiPhoneSchema = z
  .string()
  .trim()
  .min(1, 'phone_required')
  .transform((value, ctx) => {
    const normalized = normalizeSaudiPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'phone_invalid' });
      return z.NEVER;
    }
    return normalized;
  });

export const customerNameSchema = z
  .string()
  .trim()
  .min(2, 'name_invalid')
  .max(120, 'name_invalid')
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}\s'.\-]*$/u, 'name_invalid');

/** An email address, trimmed and lowercased on parse. */
export const emailSchema = z
  .string()
  .min(3, 'email_invalid')
  .max(254, 'email_invalid')
  .transform((value) => normalizeEmail(value) ?? '')
  .refine((value) => /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(value), 'email_invalid');

const uuidSchema = z.uuid('invalid_selection');

/** Details collected on the customer information screen. */
export const customerDetailsSchema = z.object({
  name: customerNameSchema,
  email: emailSchema,
  phone: saudiPhoneSchema,
});
export type CustomerDetailsInput = z.input<typeof customerDetailsSchema>;
export type CustomerDetails = z.output<typeof customerDetailsSchema>;

/**
 * Order submission. Ids are lookup keys only — the server re-reads the event,
 * restaurant, item and price from the database before creating anything.
 * There is deliberately no price field: the client cannot influence it, and no
 * "already checked for duplicates" flag: only the database decides that.
 */
export const placeOrderSchema = z.object({
  eventSlug: z.string().trim().min(1, 'invalid_selection'),
  restaurantId: uuidSchema,
  menuItemId: uuidSchema,
  name: customerNameSchema,
  email: emailSchema,
  phone: saudiPhoneSchema,
  deviceId: z.uuid().nullish(),
});
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

// ---------------------------------------------------------------- admin forms

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens.');

/**
 * A stored image reference. Three shapes are valid, matching `resolveImageUrl`:
 *   - `restaurants/<owner>/<uuid>.jpg` — an object uploaded to the bucket
 *   - `/menu/kfc-logo.jpg`             — a file shipped in /public
 *   - `https://…`                      — a URL stored before uploads existed
 *
 * Anything else is rejected, which keeps `javascript:` and `data:` values out
 * of the image columns entirely.
 */
const STORAGE_OBJECT =
  /^(restaurants|menu-items|events)\/[a-z0-9-]{1,64}\/[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$/;
const PUBLIC_ASSET = /^\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const HTTP_URL = /^https?:\/\/[^\s<>"']+$/i;

const imageReference = z
  .union([
    z.literal(''),
    z
      .string()
      .trim()
      .max(500)
      .refine(
        (value) => STORAGE_OBJECT.test(value) || PUBLIC_ASSET.test(value) || HTTP_URL.test(value),
        'That is not a valid image reference.',
      ),
  ])
  .optional()
  .nullable();

export const eventFormSchema = z
  .object({
    id: z.uuid().optional(),
    name_en: z.string().trim().min(2).max(160),
    name_ar: z.string().trim().min(2).max(160),
    slug: slugSchema,
    description_en: z.string().trim().max(2000).optional().nullable(),
    description_ar: z.string().trim().max(2000).optional().nullable(),
    logo_url: imageReference,
    hero_image_url: imageReference,
    order_prefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{1,4}$/, 'One to four letters.'),
    start_date: z.string().trim().optional().nullable(),
    end_date: z.string().trim().optional().nullable(),
    status: z.enum(['draft', 'active', 'inactive']),
  })
  .refine((v) => !v.start_date || !v.end_date || new Date(v.end_date) >= new Date(v.start_date), {
    message: 'End date must be after the start date.',
    path: ['end_date'],
  });

export const restaurantFormSchema = z.object({
  id: z.uuid().optional(),
  name_en: z.string().trim().min(2).max(160),
  name_ar: z.string().trim().min(2).max(160),
  slug: slugSchema,
  description_en: z.string().trim().max(2000).optional().nullable(),
  description_ar: z.string().trim().max(2000).optional().nullable(),
  cuisine_en: z.string().trim().max(80).optional().nullable(),
  cuisine_ar: z.string().trim().max(80).optional().nullable(),
  logo_url: imageReference,
  cover_image_url: imageReference,
  display_order: z.coerce.number().int().min(0).max(9999),
  status: z.enum(['active', 'disabled']),
  event_ids: z.array(z.uuid()).default([]),
});

export const categoryFormSchema = z.object({
  id: z.uuid().optional(),
  restaurant_id: z.uuid(),
  name_en: z.string().trim().min(1).max(120),
  name_ar: z.string().trim().min(1).max(120),
  display_order: z.coerce.number().int().min(0).max(9999),
});

export const menuItemFormSchema = z.object({
  id: z.uuid().optional(),
  restaurant_id: z.uuid(),
  category_id: z.uuid('Choose a category.'),
  name_en: z.string().trim().min(1).max(160),
  name_ar: z.string().trim().min(1).max(160),
  description_en: z.string().trim().max(1000).optional().nullable(),
  description_ar: z.string().trim().max(1000).optional().nullable(),
  price: z.coerce.number().min(0, 'Price cannot be negative.').max(100000),
  image_url: imageReference,
  is_available: z.coerce.boolean(),
  display_order: z.coerce.number().int().min(0).max(9999),
});

export const adminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export const ORDER_STATUSES = [
  'new',
  'accepted',
  'preparing',
  'ready',
  'completed',
  'cancelled',
] as const;

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const updateOrderStatusSchema = z.object({
  orderId: z.uuid(),
  status: orderStatusSchema,
  reason: z.string().trim().max(500).optional().nullable(),
});
