-- DETOMSITE performance migration 0002
-- Non-payment read-path indexes only. Apply once with Supabase CLI or the SQL
-- editor; every statement is idempotent and safe to re-run.

create index if not exists idx_orders_owner_created_at
  on public.orders (owner_user_id, created_at desc);

create index if not exists idx_parent_orders_owner_created_at
  on public.parent_orders (owner_user_id, created_at desc);

create index if not exists idx_orders_shop_created_at
  on public.orders (shop_id, created_at desc);

create index if not exists idx_products_shop_category_name
  on public.products (shop_id, category, name);

create index if not exists idx_shops_approved_rating
  on public.shops (approval_status, rating desc);

-- Verification query for deployment checks:
-- select indexname from pg_indexes where schemaname = 'public'
--   and indexname in (
--     'idx_orders_owner_created_at',
--     'idx_parent_orders_owner_created_at',
--     'idx_orders_shop_created_at',
--     'idx_products_shop_category_name',
--     'idx_shops_approved_rating'
--   );
