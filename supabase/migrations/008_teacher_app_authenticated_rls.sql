-- ============================================================================
-- Migration 008: Authenticated Teacher App RLS & School Name Sync
-- Fixes public.is_active_app_teacher(UUID) to match live schema columns
-- (teachers.user_id, lowercase schools.application_status = 'approved')
-- and grants logged-in Teacher App JWTs read access to their school's profile,
-- logo, classes, sections, subjects, students, and exams.
-- ============================================================================

-- 1. Ensure schools.name and schools.school_name mirror schools.name_en if null
UPDATE public.schools
SET
  name = COALESCE(NULLIF(name, ''), name_en),
  school_name = COALESCE(NULLIF(school_name, ''), name_en)
WHERE (name IS NULL OR name = '' OR school_name IS NULL OR school_name = '')
  AND name_en IS NOT NULL;

-- 2. Fix is_active_app_teacher(UUID) helper so authenticated Teacher App JWTs pass RLS
CREATE OR REPLACE FUNCTION public.is_active_app_teacher(target_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teachers t
    JOIN public.schools s ON s.id = t.school_id
    WHERE t.school_id = target_school_id
      AND t.user_id = auth.uid()
      AND COALESCE(t.app_access_enabled, false) = true
      AND COALESCE(t.app_blocked, false) = false
      AND LOWER(COALESCE(t.status, 'active')) = 'active'
      AND LOWER(COALESCE(s.status, 'active')) = 'active'
      AND LOWER(COALESCE(s.application_status, 'approved')) = 'approved'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_active_app_teacher(UUID) TO authenticated;

-- 3. Allow active logged-in Teachers to read their school's name, logo, and academic data
DROP POLICY IF EXISTS "teacher_app_read_school" ON public.schools;
CREATE POLICY "teacher_app_read_school" ON public.schools
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(id));

DROP POLICY IF EXISTS "teacher_app_read_school_profiles" ON public.school_profiles;
CREATE POLICY "teacher_app_read_school_profiles" ON public.school_profiles
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));

DROP POLICY IF EXISTS "teacher_app_read_classes" ON public.classes;
CREATE POLICY "teacher_app_read_classes" ON public.classes
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));

DROP POLICY IF EXISTS "teacher_app_read_sections" ON public.sections;
CREATE POLICY "teacher_app_read_sections" ON public.sections
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));

DROP POLICY IF EXISTS "teacher_app_read_subjects" ON public.subjects;
CREATE POLICY "teacher_app_read_subjects" ON public.subjects
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));

DROP POLICY IF EXISTS "teacher_app_read_academic_sessions" ON public.academic_sessions;
CREATE POLICY "teacher_app_read_academic_sessions" ON public.academic_sessions
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));

DROP POLICY IF EXISTS "teacher_app_read_students" ON public.students;
CREATE POLICY "teacher_app_read_students" ON public.students
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));

DROP POLICY IF EXISTS "teacher_app_read_exams" ON public.exams;
CREATE POLICY "teacher_app_read_exams" ON public.exams
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));

DROP POLICY IF EXISTS "teacher_app_read_exam_schedules" ON public.exam_schedules;
CREATE POLICY "teacher_app_read_exam_schedules" ON public.exam_schedules
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));

DROP POLICY IF EXISTS "teacher_app_read_calendar" ON public.school_calendar_events;
CREATE POLICY "teacher_app_read_calendar" ON public.school_calendar_events
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));
