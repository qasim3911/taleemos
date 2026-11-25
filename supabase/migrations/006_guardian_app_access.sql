-- ============================================================================
-- Migration 006: Guardian App Access & QR Activation Support
-- ============================================================================

ALTER TABLE public.guardians 
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS app_access_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS app_account_status TEXT NOT NULL DEFAULT 'not_provisioned' CHECK (app_account_status IN ('not_provisioned', 'pending_invite', 'active', 'blocked', 'deactivated')),
  ADD COLUMN IF NOT EXISTS qr_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS app_invited_at TIMESTAMPTZ;
