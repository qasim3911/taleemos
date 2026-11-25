-- ============================================================================
-- Migration 009: Teacher App RLS for Assignments, Timetables, and Students
-- Grants logged-in Teacher App JWTs read/write access to teacher_assignments,
-- timetable_entries, timetables, and students in their school.
-- ============================================================================

-- 1. teacher_assignments
DROP POLICY IF EXISTS "teacher_app_read_teacher_assignments" ON public.teacher_assignments;
CREATE POLICY "teacher_app_read_teacher_assignments" ON public.teacher_assignments
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));

-- 2. timetable_entries
DROP POLICY IF EXISTS "teacher_app_read_timetable_entries" ON public.timetable_entries;
CREATE POLICY "teacher_app_read_timetable_entries" ON public.timetable_entries
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));

-- 3. timetables
DROP POLICY IF EXISTS "teacher_app_read_timetables" ON public.timetables;
CREATE POLICY "teacher_app_read_timetables" ON public.timetables
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));

-- 4. students (teachers need to see students in their school / assigned classes)
DROP POLICY IF EXISTS "teacher_app_read_students" ON public.students;
CREATE POLICY "teacher_app_read_students" ON public.students
  FOR SELECT TO authenticated
  USING (public.is_active_app_teacher(school_id));

-- 5. teacher_attendance (attendance marking)
DROP POLICY IF EXISTS "teacher_app_attendance_rw" ON public.student_attendance;
CREATE POLICY "teacher_app_attendance_rw" ON public.student_attendance
  FOR ALL TO authenticated
  USING (public.is_active_app_teacher(school_id))
  WITH CHECK (public.is_active_app_teacher(school_id));
