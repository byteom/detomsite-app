-- DETOMSITE performance migration 0005 — critical performance indexes.
-- Apply once in Supabase SQL editor (or supabase db push); idempotent.
--
-- Why: Eliminates sequential table scans across sessions, payments, tickets,
-- reviews, feedback, and notifications for all high-frequency endpoints.

-- 1. Sessions: fast lookup of last login by email
create index if not exists idx_sessions_email_created
  on public.sessions (lower(email), created_at desc);

-- 2. Payments: fast lookup for parent order payments and batch lookups
create index if not exists idx_payments_parent_order_id
  on public.payments (parent_order_id);

create index if not exists idx_payments_order_created
  on public.payments (order_id, created_at desc);

-- 3. Tickets: fast user ticket lookup and admin sorting
create index if not exists idx_tickets_email_lower
  on public.tickets (lower(email));

create index if not exists idx_tickets_created_at
  on public.tickets (created_at desc);

create index if not exists idx_tickets_status
  on public.tickets (status);

-- 4. Reviews: fast admin reviews list and user reviews overview
create index if not exists idx_reviews_created_at
  on public.reviews (created_at desc);

create index if not exists idx_reviews_user_id
  on public.reviews (user_id);

-- 5. Site feedback: fast admin feedback list
create index if not exists idx_site_feedback_created_at
  on public.site_feedback (created_at desc);

-- 6. Notifications: fast order-scoped notifications join
create index if not exists idx_notifications_order_id
  on public.notifications (order_id);

-- 7. Orders: fast global date range & ordering
create index if not exists idx_orders_created_at_desc
  on public.orders (created_at desc);
