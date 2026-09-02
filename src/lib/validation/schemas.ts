import { z } from 'zod';
import { normalizeSaudiPhone } from '@/lib/phone';

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

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'email_invalid')
  .max(254, 'email_invalid')
  .regex(/^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/, 'email_invalid');

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, 'otp_invalid');

const uuidSchema = z.uuid('invalid_selection');

/** Details collected on the customer information screen. */
export const customerDetailsSchema = z.object({
  name: customerNameSchema,
  email: emailSchema,
  phone: saudiPhoneSchema,
});
export type CustomerDetailsInput = z.input<typeof customerDetailsSchema>;
export type CustomerDetails = z.output<typeof customerDetailsSchema>;

export const sendOtpSchema = customerDetailsSchema;

export const verifyOtpSchema = z.object({
  phone: saudiPhoneSchema,
  code: otpCodeSchema,
});

/**
 * Order submission. Ids are lookup keys only — the server re-reads the event,
 * restaurant, item and price from the database before creating anything.
 * There is deliberately no price field: the client cannot influence it.
 */
export const placeOrderSchema = z.object({
  eventSlug: z.string().trim().min(1, 'invalid_selection'),
  restaurantId: uuidSchema,
  menuItemId: uuidSchema,
  name: customerNameSchema,
  email: emailSchema,
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

const optionalUrl = z
  .union([z.url(), z.literal('')])
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
    logo_url: optionalUrl,
    hero_image_url: optionalUrl,
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
  logo_url: optionalUrl,
  cover_image_url: optionalUrl,
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
  image_url: optionalUrl,
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
