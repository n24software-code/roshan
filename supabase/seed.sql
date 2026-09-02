-- =============================================================
-- Development seed data
-- Safe to re-run: everything is keyed on slugs.
-- =============================================================

insert into public.events (name_en, name_ar, slug, description_en, description_ar,
                           hero_image_url, order_prefix, start_date, end_date, status)
values (
  'LEAP Riyadh — Staff Dining',
  'ليب الرياض — مطاعم الفريق',
  'leap-riyadh',
  'Choose one dish from one of our partner kitchens. Verify your mobile number and collect your order at the venue.',
  'اختر طبقًا واحدًا من أحد مطاعمنا المشاركة. وثّق رقم جوالك واستلم طلبك في الموقع.',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=2000&q=80',
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

insert into public.restaurants (slug, name_en, name_ar, description_en, description_ar,
                                cuisine_en, cuisine_ar, cover_image_url, logo_url,
                                display_order, status)
values
  ('burger-house', 'Burger House', 'برجر هاوس',
   'Flame-grilled patties, brioche buns and hand-cut sides.',
   'لحوم مشوية على اللهب، خبز بريوش ومقبلات طازجة.',
   'Burgers', 'برجر',
   'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1400&q=80',
   'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=300&q=80',
   1, 'active'),
  ('italian-kitchen', 'Italian Kitchen', 'المطبخ الإيطالي',
   'Slow-proved dough, fresh pasta and Mediterranean classics.',
   'عجينة مخمرة ببطء، معكرونة طازجة وأطباق متوسطية.',
   'Italian', 'إيطالي',
   'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1400&q=80',
   'https://images.unsplash.com/photo-1595295333158-4742f28fbd85?auto=format&fit=crop&w=300&q=80',
   2, 'active'),
  ('saudi-bites', 'Saudi Bites', 'لقمة سعودية',
   'Home-style Saudi cooking, from kabsa to kunafa.',
   'أطباق سعودية بيتية، من الكبسة إلى الكنافة.',
   'Saudi', 'سعودي',
   'https://images.unsplash.com/photo-1547496502-affa22d38842?auto=format&fit=crop&w=1400&q=80',
   'https://images.unsplash.com/photo-1541518763669-27fef04b14ea?auto=format&fit=crop&w=300&q=80',
   3, 'active'),
  ('coffee-lab', 'Coffee Lab', 'مختبر القهوة',
   'Single-origin coffee, Saudi qahwa and fresh bakes.',
   'قهوة مختصة، قهوة سعودية ومخبوزات طازجة.',
   'Coffee & Bakery', 'قهوة ومخبوزات',
   'https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=1400&q=80',
   'https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=300&q=80',
   4, 'disabled')
on conflict (slug) do update set
  name_en = excluded.name_en, name_ar = excluded.name_ar,
  description_en = excluded.description_en, description_ar = excluded.description_ar,
  cuisine_en = excluded.cuisine_en, cuisine_ar = excluded.cuisine_ar,
  cover_image_url = excluded.cover_image_url, logo_url = excluded.logo_url,
  display_order = excluded.display_order;

-- link every seeded restaurant to the event
insert into public.event_restaurants (event_id, restaurant_id, display_order)
select e.id, r.id, r.display_order
from public.events e
cross join public.restaurants r
where e.slug = 'leap-riyadh'
  and r.slug in ('burger-house', 'italian-kitchen', 'saudi-bites', 'coffee-lab')
on conflict (event_id, restaurant_id) do nothing;

-- ---------- categories ----------
with data (restaurant_slug, name_en, name_ar, display_order) as (values
  ('burger-house',    'Burgers',      'برجر',        1),
  ('burger-house',    'Sides',        'مقبلات',      2),
  ('burger-house',    'Drinks',       'مشروبات',     3),
  ('italian-kitchen', 'Pizza',        'بيتزا',       1),
  ('italian-kitchen', 'Pasta',        'باستا',       2),
  ('italian-kitchen', 'Desserts',     'حلويات',      3),
  ('saudi-bites',     'Main Course',  'الأطباق الرئيسية', 1),
  ('saudi-bites',     'Sides',        'مقبلات',      2),
  ('saudi-bites',     'Desserts',     'حلويات',      3),
  ('coffee-lab',      'Coffee',       'قهوة',        1),
  ('coffee-lab',      'Bakery',       'مخبوزات',     2)
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
  ('burger-house', 'Burgers', 'Classic Beef Burger', 'برجر لحم كلاسيكي',
   'Grilled beef patty, aged cheddar, lettuce, tomato and house sauce.',
   'قطعة لحم مشوية مع جبن شيدر، خس، طماطم وصلصة البيت.', 32.00,
   'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80', true, 1),
  ('burger-house', 'Burgers', 'Crispy Chicken Burger', 'برجر دجاج مقرمش',
   'Buttermilk chicken, pickles and garlic mayo.',
   'دجاج مقرمش مع مخلل ومايونيز الثوم.', 30.00,
   'https://images.unsplash.com/photo-1606755962773-d324e0a13086?auto=format&fit=crop&w=800&q=80', true, 2),
  ('burger-house', 'Burgers', 'Double Cheese Burger', 'برجر جبن مزدوج',
   'Two beef patties with double cheddar.',
   'قطعتا لحم مع جبن شيدر مضاعف.', 38.00,
   'https://images.unsplash.com/photo-1553979459-d2229ba7433a?auto=format&fit=crop&w=800&q=80', true, 3),
  ('burger-house', 'Sides', 'Truffle Fries', 'بطاطس بالكمأة',
   'Hand-cut fries, truffle oil and parmesan.',
   'بطاطس مقطعة يدويًا مع زيت الكمأة والبارميزان.', 22.00,
   'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=800&q=80', true, 1),
  ('burger-house', 'Drinks', 'Fresh Lemon Mint', 'ليمون بالنعناع',
   'Blended lemon and mint over ice.',
   'ليمون مع النعناع مثلج.', 18.00,
   'https://images.unsplash.com/photo-1523371683702-af9ba4a3e0d6?auto=format&fit=crop&w=800&q=80', true, 1),

  ('italian-kitchen', 'Pizza', 'Margherita', 'مارغريتا',
   'San Marzano tomato, fior di latte and basil.',
   'طماطم سان مارزانو مع جبن الموزاريلا والريحان.', 42.00,
   'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=800&q=80', true, 1),
  ('italian-kitchen', 'Pizza', 'Truffle Mushroom Pizza', 'بيتزا الفطر والكمأة',
   'Wild mushrooms, mozzarella and truffle cream.',
   'فطر بري مع موزاريلا وكريمة الكمأة.', 52.00,
   'https://images.unsplash.com/photo-1595854341625-f33ee10dbf94?auto=format&fit=crop&w=800&q=80', true, 2),
  ('italian-kitchen', 'Pasta', 'Penne Arrabbiata', 'بيني أرابياتا',
   'Chilli, garlic and slow-cooked tomato.',
   'فلفل حار وثوم وصلصة طماطم مطهوة ببطء.', 40.00,
   'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=800&q=80', true, 1),
  ('italian-kitchen', 'Pasta', 'Chicken Alfredo', 'ألفريدو بالدجاج',
   'Fettuccine in parmesan cream with grilled chicken.',
   'فيتوتشيني بكريمة البارميزان مع دجاج مشوي.', 46.00,
   'https://images.unsplash.com/photo-1645112411341-6c4fd023714a?auto=format&fit=crop&w=800&q=80', true, 2),
  ('italian-kitchen', 'Desserts', 'Tiramisu', 'تيراميسو',
   'Mascarpone, espresso and cocoa.',
   'ماسكاربوني وإسبريسو وكاكاو.', 26.00,
   'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=800&q=80', false, 1),

  ('saudi-bites', 'Main Course', 'Chicken Kabsa', 'كبسة دجاج',
   'Spiced rice with slow-roasted chicken and daqqous.',
   'أرز بالبهارات مع دجاج مشوي ببطء ودقوس.', 45.00,
   'https://images.unsplash.com/photo-1596797038530-2c107229654b?auto=format&fit=crop&w=800&q=80', true, 1),
  ('saudi-bites', 'Main Course', 'Lamb Mandi', 'مندي لحم',
   'Smoked lamb over aromatic rice.',
   'لحم مدخن على أرز معطر.', 65.00,
   'https://images.unsplash.com/photo-1633945274801-193d6d95c1a0?auto=format&fit=crop&w=800&q=80', true, 2),
  ('saudi-bites', 'Main Course', 'Jareesh', 'جريش',
   'Crushed wheat slow-cooked with yoghurt and onion.',
   'قمح مجروش مطهو ببطء مع اللبن والبصل.', 35.00,
   'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80', true, 3),
  ('saudi-bites', 'Sides', 'Tabbouleh', 'تبولة',
   'Parsley, tomato, bulgur and lemon.',
   'بقدونس وطماطم وبرغل وليمون.', 20.00,
   'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80', true, 1),
  ('saudi-bites', 'Desserts', 'Kunafa', 'كنافة',
   'Warm cheese kunafa with rose syrup.',
   'كنافة بالجبن مع شراب الورد.', 28.00,
   'https://images.unsplash.com/photo-1583350632342-b6e8d5f4b3b4?auto=format&fit=crop&w=800&q=80', true, 1),

  ('coffee-lab', 'Coffee', 'Saudi Qahwa', 'قهوة سعودية',
   'Cardamom and saffron coffee served with dates.',
   'قهوة بالهيل والزعفران تقدم مع التمر.', 16.00,
   'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=800&q=80', true, 1),
  ('coffee-lab', 'Coffee', 'Flat White', 'فلات وايت',
   'Double ristretto with silky milk.',
   'ريستريتو مزدوج مع حليب مخملي.', 20.00,
   'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=800&q=80', true, 2),
  ('coffee-lab', 'Bakery', 'Butter Croissant', 'كرواسون بالزبدة',
   'Laminated all-butter croissant.',
   'كرواسون بالزبدة الفرنسية.', 15.00,
   'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=800&q=80', true, 1)
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
