-- 0006 — Manual UPI payment-proof workflow (UTR + Cloudinary screenshot +
-- admin verification + Telegram notification).
--
-- New canonical proof lifecycle in proof_status / payment_proof_status:
--   PENDING_PAYMENT | PAYMENT_PROOF_SUBMITTED | PAYMENT_APPROVED | PAYMENT_REJECTED
-- The legacy status / payment_status columns stay in sync (Pending /
-- Pending Verification / Success|Paid / Rejected|Failed) so older readers keep
-- working. Run in the Supabase SQL editor (the app also applies these as
-- idempotent ALTERs on startup via app/core/supabase_db.py).

alter table public.payments
  add column if not exists proof_status text not null default 'PENDING_PAYMENT',
  add column if not exists payment_screenshot_url text not null default '',
  add column if not exists payment_screenshot_public_id text not null default '',
  add column if not exists payment_submitted_at timestamptz,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_verified_by text not null default '',
  add column if not exists payment_rejection_reason text not null default '';

create index if not exists idx_payments_proof_status on public.payments (proof_status);

alter table public.parent_orders
  add column if not exists payment_proof_status text not null default 'PENDING_PAYMENT',
  add column if not exists payment_screenshot_url text not null default '',
  add column if not exists payment_screenshot_public_id text not null default '',
  add column if not exists payment_submitted_at timestamptz,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_verified_by text not null default '',
  add column if not exists payment_rejection_reason text not null default '';

create index if not exists idx_parent_orders_proof_status on public.parent_orders (payment_proof_status);
