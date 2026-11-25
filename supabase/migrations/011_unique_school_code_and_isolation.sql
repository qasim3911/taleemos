-- ============================================================================
-- Migration 011: Strict Unique School Code / Identifier & Tenant Data Isolation
-- ============================================================================
-- 1. Ensure school_code column exists on public.schools
-- 2. Create a unique case-insensitive index on school_code
-- 3. Verify public.user_belongs_to_school(target_school_id) protects all tenant tables

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'schools' 
      AND column_name = 'school_code'
  ) THEN
    ALTER TABLE public.schools ADD COLUMN school_code VARCHAR(100);
  END IF;
END $$;

-- Create unique index on TRIM(LOWER(school_code)) to prevent duplicate School IDs across all schools
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_unique_school_code 
ON public.schools (LOWER(TRIM(school_code))) 
WHERE school_code IS NOT NULL AND TRIM(school_code) <> '';

-- Ensure registration_number and tracking_number also have lookup indexes
CREATE INDEX IF NOT EXISTS idx_schools_lookup_reg_no
ON public.schools (LOWER(TRIM(registration_number)))
WHERE registration_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schools_lookup_tracking_no
ON public.schools (LOWER(TRIM(tracking_number)))
WHERE tracking_number IS NOT NULL;

-- Strict Multi-Tenant Membership Verification Function
CREATE OR REPLACE FUNCTION public.user_belongs_to_school(target_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.schools s
    WHERE s.id = target_school_id
      AND (
        lower(coalesce(s.application_status, '')) = 'approved'
        OR lower(coalesce(s.status, '')) = 'active'
      )
      AND (
        s.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.school_members sm
          WHERE sm.school_id = s.id
            AND sm.user_id = auth.uid()
            AND sm.is_active = true
        )
        OR EXISTS (
          SELECT 1
          FROM public.school_memberships sms
          WHERE sms.school_id = s.id
            AND sms.user_id = auth.uid()
            AND lower(coalesce(sms.status, '')) = 'active'
        )
      )
  );
$$;
