-- ============================================================================
-- Migration 007: Non-Destructive Read RLS for Universal Student & Guardian App
-- Enables QR+PIN mobile app sessions (anon role) to read school-verified
-- linked children, school metadata, classes, sections, fees, and published exams.
-- ============================================================================

-- Helper: checks whether a student is authorized for Student App OR has a
-- school-verified, active, unblocked Guardian with app access enabled.
CREATE OR REPLACE FUNCTION public.is_student_visible_to_mobile_app(target_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students st
    JOIN public.schools s ON s.id = st.school_id
    WHERE st.id = target_student_id
      AND st.status = 'active'
      AND st.app_blocked = false
      AND s.status = 'active'
      AND (
        st.app_access_enabled = true
        OR EXISTS (
          SELECT 1
          FROM public.student_guardians sg
          JOIN public.guardians g ON g.id = sg.guardian_id
          WHERE sg.student_id = st.id
            AND sg.status = 'active'
            AND sg.is_verified = true
            AND g.status = 'active'
            AND g.app_access_enabled = true
            AND g.app_blocked = false
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_student_visible_to_mobile_app(UUID) TO anon, authenticated;

-- 1. Schools metadata for active approved schools
DROP POLICY IF EXISTS "mobile_app_read_active_schools" ON public.schools;
CREATE POLICY "mobile_app_read_active_schools" ON public.schools
  FOR SELECT TO anon
  USING (status = 'active' AND lower(coalesce(application_status, 'approved')) = 'approved');

-- 2. Linked / enabled students
DROP POLICY IF EXISTS "mobile_app_read_linked_students" ON public.students;
CREATE POLICY "mobile_app_read_linked_students" ON public.students
  FOR SELECT TO anon
  USING (public.is_student_visible_to_mobile_app(id));

-- 3. Classes, sections, subjects, academic_sessions for active schools
DROP POLICY IF EXISTS "mobile_app_read_classes" ON public.classes;
CREATE POLICY "mobile_app_read_classes" ON public.classes
  FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND s.status = 'active'));

DROP POLICY IF EXISTS "mobile_app_read_sections" ON public.sections;
CREATE POLICY "mobile_app_read_sections" ON public.sections
  FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND s.status = 'active'));

DROP POLICY IF EXISTS "mobile_app_read_subjects" ON public.subjects;
CREATE POLICY "mobile_app_read_subjects" ON public.subjects
  FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND s.status = 'active'));

DROP POLICY IF EXISTS "mobile_app_read_academic_sessions" ON public.academic_sessions;
CREATE POLICY "mobile_app_read_academic_sessions" ON public.academic_sessions
  FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND s.status = 'active'));

-- 4. Fee vouchers & payments for linked / enabled students
DROP POLICY IF EXISTS "mobile_app_read_fee_vouchers" ON public.fee_vouchers;
CREATE POLICY "mobile_app_read_fee_vouchers" ON public.fee_vouchers
  FOR SELECT TO anon
  USING (public.is_student_visible_to_mobile_app(student_id));

DROP POLICY IF EXISTS "mobile_app_read_fee_payments" ON public.fee_payments;
CREATE POLICY "mobile_app_read_fee_payments" ON public.fee_payments
  FOR SELECT TO anon
  USING (public.is_student_visible_to_mobile_app(student_id));

-- 5. Published exams, schedules & marks for linked / enabled students
DROP POLICY IF EXISTS "mobile_app_read_published_exams" ON public.exams;
CREATE POLICY "mobile_app_read_published_exams" ON public.exams
  FOR SELECT TO anon
  USING (is_published = true);

DROP POLICY IF EXISTS "mobile_app_read_exam_schedules" ON public.exam_schedules;
CREATE POLICY "mobile_app_read_exam_schedules" ON public.exam_schedules
  FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND e.is_published = true));

DROP POLICY IF EXISTS "mobile_app_read_exam_marks" ON public.exam_marks;
CREATE POLICY "mobile_app_read_exam_marks" ON public.exam_marks
  FOR SELECT TO anon
  USING (
    public.is_student_visible_to_mobile_app(student_id)
    AND EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND e.is_published = true)
  );
