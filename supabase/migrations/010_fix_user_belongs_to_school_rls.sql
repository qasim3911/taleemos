-- ============================================================================
-- Fix public.user_belongs_to_school(UUID) to support lowercase 'approved' /
-- 'active' school statuses as well as school_memberships & owner_user_id,
-- and ensure complaints tables are included in supabase_realtime publication.
-- ============================================================================

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

DO $$
DECLARE
  rt_tbl TEXT;
BEGIN
  FOREACH rt_tbl IN ARRAY ARRAY['complaints', 'complaint_replies'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = rt_tbl
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = rt_tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', rt_tbl);
    END IF;
  END LOOP;
END $$;
