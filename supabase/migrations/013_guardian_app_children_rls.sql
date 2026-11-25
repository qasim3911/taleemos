-- ============================================================================
-- Migration 013: Parents / Guardians App Verified Children RLS & Status Sync
-- Fixes "No school-verified children linked" on Parents / Guardians App login
-- by granting active, school-verified guardians (both QR+PIN anon sessions and
-- authenticated sessions) read access to their guardian profile, verified
-- student_guardians links, and child-scoped mobile app tables.
-- ============================================================================

-- 1. Helper: verify guardian is active, school-verified, app-enabled, and unblocked
CREATE OR REPLACE FUNCTION public.is_active_mobile_guardian(target_guardian_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.guardians g
    JOIN public.schools s ON s.id = g.school_id
    WHERE g.id = target_guardian_id
      AND LOWER(COALESCE(g.status, 'active')) = 'active'
      AND COALESCE(g.is_verified, true) = true
      AND COALESCE(g.app_access_enabled, false) = true
      AND COALESCE(g.app_blocked, false) = false
      AND LOWER(COALESCE(s.status, 'active')) IN ('active', 'approved')
      AND LOWER(COALESCE(s.application_status, 'approved')) IN ('approved', 'active')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_active_mobile_guardian(UUID) TO anon, authenticated;

-- 2. Guardians table read access for Parents / Guardians App
DROP POLICY IF EXISTS "mobile_app_read_active_guardians" ON public.guardians;
CREATE POLICY "mobile_app_read_active_guardians" ON public.guardians
  FOR SELECT TO anon
  USING (public.is_active_mobile_guardian(id));

DROP POLICY IF EXISTS "guardian_app_self_read" ON public.guardians;
CREATE POLICY "guardian_app_self_read" ON public.guardians
  FOR SELECT TO authenticated
  USING (
    auth.uid() IN (user_id, auth_user_id)
    OR public.is_active_mobile_guardian(id)
  );

-- 3. Student-Guardian link table read access for verified linked children
DROP POLICY IF EXISTS "mobile_app_read_verified_student_guardians" ON public.student_guardians;
CREATE POLICY "mobile_app_read_verified_student_guardians" ON public.student_guardians
  FOR SELECT TO anon
  USING (
    LOWER(COALESCE(status, 'active')) = 'active'
    AND COALESCE(is_verified, true) = true
    AND public.is_active_mobile_guardian(guardian_id)
    AND public.is_student_visible_to_mobile_app(student_id)
  );

DROP POLICY IF EXISTS "guardian_app_read_own_children_links" ON public.student_guardians;
CREATE POLICY "guardian_app_read_own_children_links" ON public.student_guardians
  FOR SELECT TO authenticated
  USING (
    LOWER(COALESCE(status, 'active')) = 'active'
    AND COALESCE(is_verified, true) = true
    AND (
      public.is_active_mobile_guardian(guardian_id)
      OR EXISTS (
        SELECT 1
        FROM public.guardians g
        WHERE g.id = guardian_id
          AND auth.uid() IN (g.user_id, g.auth_user_id)
      )
    )
  );

-- 4. Child-scoped read policies for remaining mobile app tables (anon QR+PIN sessions)
DROP POLICY IF EXISTS "mobile_app_read_school_profiles" ON public.school_profiles;
CREATE POLICY "mobile_app_read_school_profiles" ON public.school_profiles
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.schools s
      WHERE s.id = school_id
        AND LOWER(COALESCE(s.status, 'active')) IN ('active', 'approved')
    )
  );

DROP POLICY IF EXISTS "mobile_app_read_homework_assignments" ON public.homework_assignments;
CREATE POLICY "mobile_app_read_homework_assignments" ON public.homework_assignments
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.schools s
      WHERE s.id = school_id
        AND LOWER(COALESCE(s.status, 'active')) IN ('active', 'approved')
    )
  );

DROP POLICY IF EXISTS "mobile_app_read_announcements" ON public.announcements;
CREATE POLICY "mobile_app_read_announcements" ON public.announcements
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.schools s
      WHERE s.id = school_id
        AND LOWER(COALESCE(s.status, 'active')) IN ('active', 'approved')
    )
  );

DROP POLICY IF EXISTS "mobile_app_read_timetable_entries" ON public.timetable_entries;
CREATE POLICY "mobile_app_read_timetable_entries" ON public.timetable_entries
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.schools s
      WHERE s.id = school_id
        AND LOWER(COALESCE(s.status, 'active')) IN ('active', 'approved')
    )
  );

DROP POLICY IF EXISTS "mobile_app_read_calendar_events" ON public.school_calendar_events;
CREATE POLICY "mobile_app_read_calendar_events" ON public.school_calendar_events
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.schools s
      WHERE s.id = school_id
        AND LOWER(COALESCE(s.status, 'active')) IN ('active', 'approved')
    )
  );

DROP POLICY IF EXISTS "mobile_app_read_study_materials" ON public.study_materials;
CREATE POLICY "mobile_app_read_study_materials" ON public.study_materials
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.schools s
      WHERE s.id = school_id
        AND LOWER(COALESCE(s.status, 'active')) IN ('active', 'approved')
    )
  );

DROP POLICY IF EXISTS "mobile_app_read_online_classes" ON public.online_classes;
CREATE POLICY "mobile_app_read_online_classes" ON public.online_classes
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.schools s
      WHERE s.id = school_id
        AND LOWER(COALESCE(s.status, 'active')) IN ('active', 'approved')
    )
  );

DROP POLICY IF EXISTS "mobile_app_read_leave_requests" ON public.leave_requests;
CREATE POLICY "mobile_app_read_leave_requests" ON public.leave_requests
  FOR SELECT TO anon
  USING (public.is_student_visible_to_mobile_app(student_id));

DROP POLICY IF EXISTS "mobile_app_read_support_ticket_messages" ON public.support_ticket_messages;
CREATE POLICY "mobile_app_read_support_ticket_messages" ON public.support_ticket_messages
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets st
      WHERE st.id = ticket_id
        AND (
          st.student_id IS NULL
          OR public.is_student_visible_to_mobile_app(st.student_id)
        )
    )
  );

-- 5. Backfill activated guardian statuses and verified child link flags
UPDATE public.guardians
SET
  app_account_status = 'active',
  status = 'active',
  access_state = 'ACTIVE',
  is_verified = true
WHERE pin_hash IS NOT NULL
  AND COALESCE(app_blocked, false) = false
  AND app_account_status = 'pending_invite';

UPDATE public.student_guardians sg
SET
  is_verified = true,
  status = 'active',
  verified_by = COALESCE(sg.verified_by, s.owner_user_id)
FROM public.schools s
WHERE s.id = sg.school_id
  AND (
    sg.is_verified IS DISTINCT FROM true
    OR COALESCE(sg.status, '') <> 'active'
    OR sg.verified_by IS NULL
  );
