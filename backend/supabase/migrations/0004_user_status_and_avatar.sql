-- Migration 0004: Add status and avatar_url to users table
-- Enables active/suspended account controls and profile avatars

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_users_status ON public.users (status);
