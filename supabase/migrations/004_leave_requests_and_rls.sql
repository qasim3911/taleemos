-- Ensure leave_requests table exists and allow active app students & teachers to submit/view their own leave requests
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL DEFAULT 'sick',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  attachment_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_all" ON public.leave_requests;
CREATE POLICY "tenant_isolation_all" ON public.leave_requests
  FOR ALL USING (public.user_belongs_to_school(school_id))
  WITH CHECK (public.user_belongs_to_school(school_id));

DROP POLICY IF EXISTS "student_app_own_leave_requests" ON public.leave_requests;
CREATE POLICY "student_app_own_leave_requests" ON public.leave_requests
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.students st
      WHERE st.id = leave_requests.student_id
        AND st.school_id = leave_requests.school_id
        AND st.user_id = auth.uid()
        AND st.app_access_enabled = true
        AND st.app_blocked = false
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.students st
      WHERE st.id = leave_requests.student_id
        AND st.school_id = leave_requests.school_id
        AND st.user_id = auth.uid()
        AND st.app_access_enabled = true
        AND st.app_blocked = false
    )
  );

DROP POLICY IF EXISTS "teacher_app_own_staff_leaves" ON public.staff_leave_records;
CREATE POLICY "teacher_app_own_staff_leaves" ON public.staff_leave_records
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = staff_leave_records.teacher_id
        AND t.school_id = staff_leave_records.school_id
        AND t.user_id = auth.uid()
        AND t.app_access_enabled = true
        AND t.app_blocked = false
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = staff_leave_records.teacher_id
        AND t.school_id = staff_leave_records.school_id
        AND t.user_id = auth.uid()
        AND t.app_access_enabled = true
        AND t.app_blocked = false
    )
  );
