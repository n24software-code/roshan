-- =============================================================
-- Event seed data — KFC
-- Safe to re-run: everything is keyed on slugs.
-- =============================================================

insert into public.events (name_en, name_ar, slug, description_en, description_ar,
                           hero_image_url, order_prefix, start_date, end_date, status)
values (
  'LEAP Riyadh — Staff Dining',
  'ليب الرياض — مطاعم الفريق',
  'leap-riyadh',
  'Choose one dish from our partner kitchen. Verify your mobile number and collect your order at the venue.',
  'اختر طبقًا واحدًا من مطعمنا المشارك. وثّق رقم جوالك واستلم طلبك في الموقع.',
  '/menu/kfc-cover.jpg',
  'A',
  now() - interval '1 day',
  now() + interval '30 days',
  'active'
)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ar = excluded.name_ar,
  description_en = excluded.description_en, description_ar = excluded.description_ar,
  hero_image_url = excluded.hero_image_url,
  start_date = excluded.start_date, end_date = excluded.end_date,
  status = excluded.status;

-- ---------- retire the previous demo restaurants ----------
-- Menu categories and items cascade. Orders use ON DELETE RESTRICT, so this
-- fails loudly rather than silently discarding a restaurant that has orders.
delete from public.restaurants
where slug in ('burger-house', 'italian-kitchen', 'saudi-bites', 'coffee-lab');

-- ---------- restaurant ----------
insert into public.restaurants (slug, name_en, name_ar, description_en, description_ar,
                                cuisine_en, cuisine_ar, cover_image_url, logo_url,
                                display_order, status)
values
  ('kfc', 'KFC', 'كنتاكي',
   'World famous Original Recipe fried chicken, Zinger burgers, Twisters and crispy strips.',
   'دجاج مقلي بالوصفة الأصلية الشهيرة، وبرجر الزنجر، والتويستر، والستربس المقرمشة.',
   'Fast Food / Fried Chicken', 'وجبات سريعة / دجاج مقلي',
   '/menu/kfc-cover.jpg',
   '/menu/kfc-logo.jpg',
   1, 'active')
on conflict (slug) do update set
  name_en = excluded.name_en, name_ar = excluded.name_ar,
  description_en = excluded.description_en, description_ar = excluded.description_ar,
  cuisine_en = excluded.cuisine_en, cuisine_ar = excluded.cuisine_ar,
  cover_image_url = excluded.cover_image_url, logo_url = excluded.logo_url,
  display_order = excluded.display_order, status = excluded.status;

-- link KFC to the event
insert into public.event_restaurants (event_id, restaurant_id, display_order)
select e.id, r.id, r.display_order
from public.events e
cross join public.restaurants r
where e.slug = 'leap-riyadh' and r.slug = 'kfc'
on conflict (event_id, restaurant_id) do nothing;

-- ---------- categories ----------
with data (restaurant_slug, name_en, name_ar, display_order) as (values
  ('kfc', 'Combos & Meals',  'الوجبات',              1),
  ('kfc', 'Dips',            'الصلصات',              2),
  ('kfc', 'Sides & Drinks',  'الإضافات والمشروبات',  3)
)
insert into public.menu_categories (restaurant_id, name_en, name_ar, display_order)
select r.id, d.name_en, d.name_ar, d.display_order
from data d join public.restaurants r on r.slug = d.restaurant_slug
where not exists (
  select 1 from public.menu_categories c
  where c.restaurant_id = r.id and c.name_en = d.name_en
);

-- ---------- menu items ----------
with data (restaurant_slug, category_en, name_en, name_ar, description_en, description_ar,
           price, image_url, is_available, display_order) as (values
  -- Combos & Meals
  ('kfc', 'Combos & Meals', 'Twister Combo', 'وجبة تويستر',
   'Crispy chicken twister wrap with fries and a drink.',
   'راب تويستر بالدجاج المقرمش مع بطاطس ومشروب.', 40.00,
   '/menu/twister-combo.jpg', true, 1),
  ('kfc', 'Combos & Meals', 'Zinger Combo', 'وجبة زنجر',
   'Spicy Zinger chicken fillet burger with fries and a drink.',
   'برجر فيليه دجاج زنجر الحار مع بطاطس ومشروب.', 45.00,
   '/menu/zinger-combo.jpg', true, 2),
  ('kfc', 'Combos & Meals', 'Mighty Zinger Combo', 'وجبة ميتي زنجر',
   'Double Zinger fillets with cheese, served with fries and a drink.',
   'قطعتا فيليه زنجر مع الجبن، تقدم مع بطاطس ومشروب.', 50.00,
   '/menu/mighty-zinger-combo.jpg', true, 3),
  ('kfc', 'Combos & Meals', 'Dinner Meal', 'وجبة الدينر',
   'Original Recipe chicken pieces with fries and a drink.',
   'قطع دجاج بالوصفة الأصلية مع بطاطس ومشروب.', 55.00,
   '/menu/dinner-meal.jpg', true, 4),
  ('kfc', 'Combos & Meals', 'Crispy Strips Meal', 'وجبة ستربس',
   'Crispy chicken strips with fries and a drink.',
   'ستربس دجاج مقرمشة مع بطاطس ومشروب.', 50.00,
   '/menu/crispy-strips-meal.jpg', true, 5),

  -- Dips
  ('kfc', 'Dips', 'BBQ', 'باربكيو',
   'Smoky barbecue dipping sauce.',
   'صلصة الباربكيو المدخنة.', 5.00,
   '/menu/bbq-dip.jpg', true, 1),
  ('kfc', 'Dips', 'Spicy Ranch', 'رانش حار',
   'Creamy ranch with a chilli kick.',
   'صلصة رانش كريمية بلمسة حارة.', 5.00,
   '/menu/spicy-ranch-dip.jpg', true, 2),
  ('kfc', 'Dips', 'Garlic Buttermilk Mayonnaise', 'مايونيز الثوم بالزبدة',
   'Creamy garlic and buttermilk mayonnaise.',
   'مايونيز كريمي بالثوم واللبن.', 5.00,
   '/menu/garlic-mayo-dip.jpg', true, 3),
  ('kfc', 'Dips', 'Dynamite', 'دايناميت',
   'Sweet and spicy dynamite sauce.',
   'صلصة دايناميت حلوة وحارة.', 5.00,
   '/menu/dynamite-dip.jpg', true, 4),
  ('kfc', 'Dips', 'Ranch', 'رانش',
   'Classic creamy ranch dip.',
   'صلصة رانش كريمية كلاسيكية.', 5.00,
   '/menu/ranch-dip.jpg', true, 5),

  -- Sides & Drinks
  ('kfc', 'Sides & Drinks', 'Fries (Medium)', 'بطاطس (وسط)',
   'Medium portion of golden fries.',
   'حصة وسط من البطاطس الذهبية.', 15.00,
   '/menu/fries-medium.jpg', true, 1),
  ('kfc', 'Sides & Drinks', 'Soft Drinks 330ml', 'مشروب غازي 330 مل',
   'Chilled soft drink can, 330ml.',
   'علبة مشروب غازي مثلجة، 330 مل.', 10.00,
   '/menu/soft-drink-330ml.jpg', true, 2),
  ('kfc', 'Sides & Drinks', 'Orange Juice', 'عصير برتقال',
   'Chilled orange juice.',
   'عصير برتقال مثلج.', 20.00,
   '/menu/orange-juice.jpg', true, 3),
  ('kfc', 'Sides & Drinks', 'Spicy Powder', 'بودرة حارة',
   'Spicy seasoning powder for your fries.',
   'بودرة توابل حارة لبطاطسك.', 3.00,
   '/menu/spicy-powder.jpg', true, 4),
  ('kfc', 'Sides & Drinks', 'Water 500ml', 'مياه 500 مل',
   'Bottled drinking water, 500ml.',
   'مياه شرب معبأة، 500 مل.', 8.00,
   '/menu/water-500ml.jpg', true, 5)
)
insert into public.menu_items (restaurant_id, category_id, name_en, name_ar,
                               description_en, description_ar, price, image_url,
                               is_available, display_order)
select r.id, c.id, d.name_en, d.name_ar, d.description_en, d.description_ar,
       d.price, d.image_url, d.is_available, d.display_order
from data d
join public.restaurants r on r.slug = d.restaurant_slug
join public.menu_categories c on c.restaurant_id = r.id and c.name_en = d.category_en
where not exists (
  select 1 from public.menu_items m where m.restaurant_id = r.id and m.name_en = d.name_en
);

insert into public.app_settings (key, value)
values ('general', jsonb_build_object('active_event_slug', 'leap-riyadh', 'sound_notifications', true))
on conflict (key) do nothing;
