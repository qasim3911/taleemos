-- ============================================================================
-- TaleemOS — Multi-School SaaS Platform (Pakistan)
-- Migration 002: Multi-Tenant RLS Policies, Mobile Access Enforcement & Storage
-- ============================================================================

-- Helper functions for tenant & mobile app access enforcement
CREATE OR REPLACE FUNCTION public.user_belongs_to_school(target_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.school_members sm
    JOIN public.schools s ON s.id = sm.school_id
    WHERE sm.school_id = target_school_id
      AND sm.user_id = auth.uid()
      AND sm.is_active = true
      AND s.application_status = 'Approved'
  );
$$;

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
      AND t.auth_user_id = auth.uid()
      AND t.app_access_enabled = true
      AND t.app_account_status = 'active'
      AND s.application_status = 'Approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_app_student(target_school_id UUID, target_student_id UUID)
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
      AND st.school_id = target_school_id
      AND st.auth_user_id = auth.uid()
      AND st.app_access_enabled = true
      AND st.app_account_status = 'active'
      AND s.application_status = 'Approved'
  );
$$;

-- Enable RLS across all tables
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_invitation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates_issued ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Schools & Membership policies
DROP POLICY IF EXISTS "school_owner_read_own" ON public.schools;
CREATE POLICY "school_owner_read_own" ON public.schools
  FOR SELECT USING (
    owner_user_id = auth.uid()
    OR public.user_belongs_to_school(id)
    OR public.is_active_app_teacher(id)
  );

DROP POLICY IF EXISTS "school_owner_update_approved" ON public.schools;
CREATE POLICY "school_owner_update_approved" ON public.schools
  FOR UPDATE USING (public.user_belongs_to_school(id))
  WITH CHECK (public.user_belongs_to_school(id));

DROP POLICY IF EXISTS "school_members_read" ON public.school_members;
CREATE POLICY "school_members_read" ON public.school_members
  FOR SELECT USING (user_id = auth.uid() OR public.user_belongs_to_school(school_id));

-- Subscription policies (Read-only plans & subscriptions; Schools can insert requests only)
DROP POLICY IF EXISTS "plans_read_authenticated" ON public.subscription_plans;
CREATE POLICY "plans_read_authenticated" ON public.subscription_plans
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "school_subscriptions_read" ON public.school_subscriptions;
CREATE POLICY "school_subscriptions_read" ON public.school_subscriptions
  FOR SELECT USING (public.user_belongs_to_school(school_id));

DROP POLICY IF EXISTS "school_sub_requests_rw" ON public.subscription_requests;
CREATE POLICY "school_sub_requests_rw" ON public.subscription_requests
  FOR ALL USING (public.user_belongs_to_school(school_id))
  WITH CHECK (public.user_belongs_to_school(school_id));

DROP POLICY IF EXISTS "school_invoices_read" ON public.subscription_invoices;
CREATE POLICY "school_invoices_read" ON public.subscription_invoices
  FOR SELECT USING (public.user_belongs_to_school(school_id));

-- Standard school-scoped tenant policies for core school operations
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'school_roles', 'academic_sessions', 'classes', 'sections', 'subjects', 'class_subjects',
    'teachers', 'teacher_assignments', 'students', 'student_history', 'guardians', 'student_guardians',
    'app_invitation_logs', 'student_attendance', 'teacher_attendance', 'staff_leave_records', 'student_leave_records',
    'fee_structures', 'fee_vouchers', 'fee_payments', 'salary_slips',
    'exams', 'exam_schedules', 'exam_marks', 'homework_assignments', 'homework_submissions',
    'study_materials', 'timetable_entries', 'school_calendar_events', 'online_classes',
    'library_books', 'library_issues', 'transport_vehicles', 'transport_routes', 'transport_assignments',
    'inventory_items', 'inventory_transactions', 'certificates_issued',
    'announcements', 'notifications', 'support_tickets', 'support_ticket_messages', 'audit_logs'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation_all" ON public.%I;', tbl);
    EXECUTE format('CREATE POLICY "tenant_isolation_all" ON public.%I FOR ALL USING (public.user_belongs_to_school(school_id)) WITH CHECK (public.user_belongs_to_school(school_id));', tbl);
  END LOOP;
END $$;

-- Student App Backend Enforcement (students see ONLY their own authorized records + published results)
DROP POLICY IF EXISTS "student_app_self_read" ON public.students;
CREATE POLICY "student_app_self_read" ON public.students
  FOR SELECT USING (auth_user_id = auth.uid() AND app_access_enabled = true AND app_account_status = 'active');

DROP POLICY IF EXISTS "student_app_own_attendance" ON public.student_attendance;
CREATE POLICY "student_app_own_attendance" ON public.student_attendance
  FOR SELECT USING (public.is_active_app_student(school_id, student_id));

DROP POLICY IF EXISTS "student_app_own_fees" ON public.fee_vouchers;
CREATE POLICY "student_app_own_fees" ON public.fee_vouchers
  FOR SELECT USING (public.is_active_app_student(school_id, student_id));

DROP POLICY IF EXISTS "student_app_published_marks" ON public.exam_marks;
CREATE POLICY "student_app_published_marks" ON public.exam_marks
  FOR SELECT USING (
    public.is_active_app_student(school_id, student_id)
    AND EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND e.is_published = true)
  );

-- Teacher App Backend Enforcement (active teacher app account scoped to school_id)
DROP POLICY IF EXISTS "teacher_app_self_read" ON public.teachers;
CREATE POLICY "teacher_app_self_read" ON public.teachers
  FOR SELECT USING (auth_user_id = auth.uid() AND app_access_enabled = true AND app_account_status = 'active');

DROP POLICY IF EXISTS "teacher_app_attendance_rw" ON public.student_attendance;
CREATE POLICY "teacher_app_attendance_rw" ON public.student_attendance
  FOR ALL USING (public.is_active_app_teacher(school_id))
  WITH CHECK (public.is_active_app_teacher(school_id));

DROP POLICY IF EXISTS "teacher_app_homework_rw" ON public.homework_assignments;
CREATE POLICY "teacher_app_homework_rw" ON public.homework_assignments
  FOR ALL USING (public.is_active_app_teacher(school_id))
  WITH CHECK (public.is_active_app_teacher(school_id));

DROP POLICY IF EXISTS "teacher_app_marks_rw" ON public.exam_marks;
CREATE POLICY "teacher_app_marks_rw" ON public.exam_marks
  FOR ALL USING (public.is_active_app_teacher(school_id))
  WITH CHECK (public.is_active_app_teacher(school_id));

-- Storage Buckets (Idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('school-logos', 'school-logos', true),
  ('student-photos', 'student-photos', false),
  ('staff-documents', 'staff-documents', false),
  ('study-materials', 'study-materials', false),
  ('payment-proofs', 'payment-proofs', false),
  ('ticket-attachments', 'ticket-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Realtime Publication for Live Sync across Website, Teacher App, Student App & Super Admin
DO $$
DECLARE
  rt_tbl TEXT;
BEGIN
  FOREACH rt_tbl IN ARRAY ARRAY[
    'student_attendance', 'homework_assignments', 'exams', 'exam_marks',
    'students', 'teachers', 'school_subscriptions', 'announcements',
    'notifications', 'support_tickets', 'support_ticket_messages', 'online_classes'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = rt_tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', rt_tbl);
    END IF;
  END LOOP;
END $$;
