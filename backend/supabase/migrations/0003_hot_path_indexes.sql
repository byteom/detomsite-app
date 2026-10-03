-- DETOMSITE performance migration 0003 — hot-path read indexes.
-- Apply once in Supabase SQL editor (or `supabase db push`); idempotent.
--
-- Why: /orders and /orders/parent filtered in Python after loading hundreds of
-- rows; per-student reads now filter in SQL on owner_user_id. These covering
-- indexes serve the WHERE + ORDER BY directly so polls stay fast as tables grow.

create index if not exists idx_parent_orders_owner_created
  on public.parent_orders (owner_user_id, created_at desc);

create index if not exists idx_orders_owner_created
  on public.orders (owner_user_id, created_at desc);

create index if not exists idx_shop_sub_orders_shop_status
  on public.shop_sub_orders (shop_id, status);

create index if not exists idx_order_items_sub_order
  on public.order_items (sub_order_id);

create index if not exists idx_products_shop_available
  on public.products (shop_id, available);

create index if not exists idx_shops_storefront
  on public.shops (approval_status, present, status);

create index if not exists idx_notifications_role_created
  on public.notifications (target_role, created_at desc);

-- Verification:
-- select indexname from pg_indexes where schemaname = 'public'
--   and indexname in (
--     'idx_parent_orders_owner_created',
--     'idx_orders_owner_created',
--     'idx_shop_sub_orders_shop_status',
--     'idx_order_items_sub_order',
--     'idx_products_shop_available',
--     'idx_shops_storefront',
--     'idx_notifications_role_created'
--   );