-- ============================================================================
-- TaleemOS — Multi-School SaaS Platform (Pakistan)
-- Migration 006: QR-Based App Access, Guardian Management & Multi-Child Linking
-- ============================================================================

-- 1. Extend existing public.guardians table
ALTER TABLE public.guardians 
  ADD COLUMN IF NOT EXISTS father_husband_name TEXT,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS app_access_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS app_blocked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Registered',
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS qr_token TEXT;

-- 2. Extend existing public.student_guardians table for multi-child linking
ALTER TABLE public.student_guardians 
  ADD COLUMN IF NOT EXISTS relationship_type TEXT NOT NULL DEFAULT 'Father',
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3. Extend public.teachers and public.students with pin_hash
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS pin_hash TEXT;

-- 4. Create public.app_qr_tokens table for cryptographically secure, one-time, short-lived QR activation
CREATE TABLE IF NOT EXISTS public.app_qr_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('teacher', 'student', 'guardian')),
  target_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student', 'guardian')),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'teacher_first_activation', 'student_first_activation', 'guardian_first_activation',
    'teacher_pin_reset', 'student_pin_reset', 'guardian_pin_reset'
  )),
  token_hash TEXT NOT NULL UNIQUE,
  token_preview TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_device_id TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Create public.app_devices table for authorized device tracking
CREATE TABLE IF NOT EXISTS public.app_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('teacher', 'student', 'guardian')),
  target_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT,
  device_model TEXT,
  os_version TEXT,
  app_version TEXT,
  status TEXT NOT NULL DEFAULT 'authorized' CHECK (status IN ('authorized', 'blocked', 'revoked')),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, device_id)
);

-- 6. Indexes for high-performance multi-tenant lookups
CREATE INDEX IF NOT EXISTS idx_guardians_school_phone ON public.guardians(school_id, phone);
CREATE INDEX IF NOT EXISTS idx_guardians_school_cnic ON public.guardians(school_id, cnic);
CREATE INDEX IF NOT EXISTS idx_student_guardians_student ON public.student_guardians(student_id);
CREATE INDEX IF NOT EXISTS idx_student_guardians_guardian ON public.student_guardians(guardian_id);
CREATE INDEX IF NOT EXISTS idx_app_qr_tokens_target ON public.app_qr_tokens(school_id, target_type, target_id, status);
CREATE INDEX IF NOT EXISTS idx_app_qr_tokens_hash ON public.app_qr_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_app_devices_target ON public.app_devices(school_id, target_type, target_id);

-- 7. Enable RLS and Tenant Isolation
ALTER TABLE public.app_qr_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_qr_tokens" ON public.app_qr_tokens;
CREATE POLICY "tenant_isolation_qr_tokens" ON public.app_qr_tokens
  FOR ALL USING (public.user_belongs_to_school(school_id))
  WITH CHECK (public.user_belongs_to_school(school_id));

DROP POLICY IF EXISTS "tenant_isolation_devices" ON public.app_devices;
CREATE POLICY "tenant_isolation_devices" ON public.app_devices
  FOR ALL USING (public.user_belongs_to_school(school_id))
  WITH CHECK (public.user_belongs_to_school(school_id));
