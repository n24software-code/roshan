/**
 * Hand-maintained mirror of supabase/migrations. Keep in sync when the schema changes.
 */

export type EventStatus = 'draft' | 'active' | 'inactive';
export type RestaurantStatus = 'active' | 'disabled';
export type OrderStatus = 'new' | 'accepted' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type AppRole = 'admin';

export type EventRow = {
  id: string;
  name_en: string;
  name_ar: string;
  slug: string;
  description_en: string | null;
  description_ar: string | null;
  logo_url: string | null;
  hero_image_url: string | null;
  order_prefix: string;
  start_date: string | null;
  end_date: string | null;
  status: EventStatus;
  created_at: string;
  updated_at: string;
};

export type RestaurantRow = {
  id: string;
  name_en: string;
  name_ar: string;
  slug: string;
  description_en: string | null;
  description_ar: string | null;
  cuisine_en: string | null;
  cuisine_ar: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  display_order: number;
  status: RestaurantStatus;
  created_at: string;
  updated_at: string;
};

export type EventRestaurantRow = {
  id: string;
  event_id: string;
  restaurant_id: string;
  display_order: number;
  created_at: string;
};

export type MenuCategoryRow = {
  id: string;
  restaurant_id: string;
  name_en: string;
  name_ar: string;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export type MenuItemRow = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  price: number;
  image_url: string | null;
  is_available: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export type CustomerRow = {
  id: string;
  auth_user_id: string | null;
  name: string;
  email: string;
  phone: string;
  created_at: string;
  updated_at: string;
};

export type OrderRow = {
  id: string;
  order_number: string;
  event_id: string;
  customer_id: string;
  restaurant_id: string;
  menu_item_id: string;
  unit_price: number;
  item_name_en: string;
  item_name_ar: string;
  status: OrderStatus;
  cancel_reason: string | null;
  /** E.164 snapshot of the guest's phone — half of the per-event duplicate key. */
  normalized_phone: string;
  /** Trimmed, lowercased snapshot of the guest's email — the other half. */
  normalized_email: string;
  /** The anonymous Supabase user that placed the order. */
  auth_user_id: string | null;
  /** Persistent browser id. Secondary signal only, never a business rule. */
  device_id: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderStatusHistoryRow = {
  id: string;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_by: string | null;
  note: string | null;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  order_id: string | null;
  is_read: boolean;
  created_at: string;
};

export type UserRoleRow = {
  id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
};

export type AdminAuditLogRow = {
  id: string;
  user_id: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

export type AppSettingRow = {
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      events: Table<EventRow>;
      restaurants: Table<RestaurantRow>;
      event_restaurants: Table<EventRestaurantRow>;
      menu_categories: Table<MenuCategoryRow>;
      menu_items: Table<MenuItemRow>;
      customers: Table<CustomerRow>;
      orders: Table<OrderRow>;
      order_status_history: Table<OrderStatusHistoryRow>;
      notifications: Table<NotificationRow>;
      user_roles: Table<UserRoleRow>;
      admin_audit_logs: Table<AdminAuditLogRow>;
      app_settings: Table<AppSettingRow>;
    };
    Views: Record<never, never>;
    Functions: {
      is_admin: { Args: { p_user_id?: string }; Returns: boolean };
      current_customer_id: { Args: Record<never, never>; Returns: string };
      customer_visible_to_current_user: { Args: { p_customer_id: string }; Returns: boolean };
      normalize_saudi_phone: { Args: { p_input: string }; Returns: string | null };
      normalize_email: { Args: { p_input: string }; Returns: string | null };
      place_order: {
        Args: {
          p_auth_user_id: string;
          p_phone: string;
          p_event_slug: string;
          p_restaurant_id: string;
          p_menu_item_id: string;
          p_name: string;
          p_email: string;
          p_device_id?: string | null;
        };
        Returns: PlaceOrderResult;
      };
    };
    Enums: {
      event_status: EventStatus;
      restaurant_status: RestaurantStatus;
      order_status: OrderStatus;
      app_role: AppRole;
    };
    CompositeTypes: Record<never, never>;
  };
};

/** Shape returned by the `place_order` database function. */
export type OrderPayload = {
  id: string;
  order_number: string;
  status: OrderStatus;
  unit_price: number;
  created_at: string;
  event: { id: string; slug: string; name_en: string; name_ar: string };
  restaurant: { id: string; slug: string; name_en: string; name_ar: string };
  item: { id: string; name_en: string; name_ar: string };
  customer: { id: string; name: string; email: string; phone: string };
};

export type PlaceOrderResult = {
  result: 'created' | 'duplicate';
  order: OrderPayload;
};
