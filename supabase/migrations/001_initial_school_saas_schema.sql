-- ============================================================================
-- TaleemOS — Multi-School SaaS Platform (Pakistan)
-- Migration 001: Idempotent Core Schema (Safe for Existing & New Databases)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. SCHOOLS & REGISTRATION APPLICATIONS
CREATE TABLE IF NOT EXISTS public.schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en TEXT NOT NULL,
  name_ur TEXT,
  board_type TEXT NOT NULL DEFAULT 'Punjab Board' CHECK (board_type IN ('Punjab Board', 'Federal Board', 'Sindh Board', 'KP Board', 'Balochistan Board', 'Cambridge / O-A Level', 'Custom')),
  registration_number TEXT,
  tracking_number TEXT UNIQUE NOT NULL,
  application_status TEXT NOT NULL DEFAULT 'Pending' CHECK (application_status IN ('Pending', 'Under Review', 'Approved', 'Rejected', 'On Hold', 'Suspended')),
  status_reason TEXT,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  province TEXT NOT NULL DEFAULT 'Punjab',
  logo_url TEXT,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  settings JSONB NOT NULL DEFAULT '{
    "attendance": {"qr_gate_enabled": true, "late_after_minutes": 15, "auto_notify_absence": true},
    "fees": {"currency": "PKR", "late_fine_per_day": 0, "default_due_day": 10},
    "notifications": {"attendance_alerts": true, "fee_reminders": true, "exam_alerts": true},
    "app_access": {"auto_enable_teachers": false, "auto_enable_students": false},
    "documents": {"header_color": "#0f766e", "footer_note": "Computer generated document."}
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. SUBSCRIPTION PLANS (READ-ONLY FOR SCHOOLS; MANAGED BY SUPER ADMIN PANEL)
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Free', 'Basic', 'Standard', 'Premium')),
  price_monthly NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_quarterly NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_six_months NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_yearly NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_students INTEGER NOT NULL DEFAULT 50,
  max_teachers INTEGER NOT NULL DEFAULT 10,
  max_storage_mb INTEGER NOT NULL DEFAULT 512,
  enabled_features JSONB NOT NULL DEFAULT '[]'::jsonb,
  disabled_features JSONB NOT NULL DEFAULT '[]'::jsonb,
  payment_instructions TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.school_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Trial', 'Active', 'Past Due', 'Expired', 'Suspended', 'Cancelled')),
  billing_period TEXT NOT NULL DEFAULT 'Monthly' CHECK (billing_period IN ('Monthly', 'Quarterly', '6 Months', 'Yearly')),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE NOT NULL,
  student_limit_override INTEGER,
  teacher_limit_override INTEGER,
  storage_limit_override_mb INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id)
);

CREATE TABLE IF NOT EXISTS public.subscription_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  requested_plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  billing_period TEXT NOT NULL CHECK (billing_period IN ('Monthly', 'Quarterly', '6 Months', 'Yearly')),
  request_type TEXT NOT NULL DEFAULT 'Renewal' CHECK (request_type IN ('New', 'Renewal', 'Upgrade')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Bank Transfer', 'JazzCash', 'Easypaisa', 'Cash', 'Other')),
  transaction_ref TEXT NOT NULL,
  amount_pkr NUMERIC(12,2) NOT NULL DEFAULT 0,
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Verified', 'Rejected')),
  admin_notes TEXT,
  submitted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscription_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.school_subscriptions(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  billing_period TEXT NOT NULL,
  amount_pkr NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Paid', 'Unpaid', 'Void')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  UNIQUE (school_id, invoice_number)
);

-- 3. SCHOOL ROLES & MEMBERS (RBAC FOR WEBSITE STAFF)
CREATE TABLE IF NOT EXISTS public.school_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS public.school_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL DEFAULT 'School Owner',
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_id)
);

-- 4. ACADEMIC STRUCTURE
CREATE TABLE IF NOT EXISTS public.academic_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  board_standard TEXT DEFAULT 'Punjab Board',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS public.sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER DEFAULT 40,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, class_id, name)
);

CREATE TABLE IF NOT EXISTS public.subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  subject_type TEXT DEFAULT 'Compulsory' CHECK (subject_type IN ('Compulsory', 'Elective', 'Practical', 'Language')),
  syllabus_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS public.class_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  max_marks INTEGER NOT NULL DEFAULT 100,
  passing_marks INTEGER NOT NULL DEFAULT 33,
  UNIQUE (school_id, class_id, subject_id)
);

-- 5. TEACHERS & STAFF
CREATE TABLE IF NOT EXISTS public.teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_code TEXT NOT NULL,
  name TEXT NOT NULL,
  cnic TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  qualification TEXT,
  experience_years NUMERIC(4,1) DEFAULT 0,
  address TEXT,
  joining_date DATE NOT NULL DEFAULT CURRENT_DATE,
  designation TEXT NOT NULL DEFAULT 'Teacher',
  department TEXT NOT NULL DEFAULT 'Academics',
  is_teaching_staff BOOLEAN NOT NULL DEFAULT true,
  base_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  employment_status TEXT NOT NULL DEFAULT 'Active' CHECK (employment_status IN ('Active', 'On Leave', 'Resigned', 'Terminated', 'Archived')),
  photo_url TEXT,
  document_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  app_access_enabled BOOLEAN NOT NULL DEFAULT false,
  app_account_status TEXT NOT NULL DEFAULT 'not_provisioned' CHECK (app_account_status IN ('not_provisioned', 'pending_invite', 'active', 'blocked', 'deactivated')),
  app_invited_at TIMESTAMPTZ,
  app_last_login_at TIMESTAMPTZ,
  app_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, employee_code)
);

CREATE TABLE IF NOT EXISTS public.teacher_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.academic_sessions(id) ON DELETE SET NULL,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  section_id UUID REFERENCES public.sections(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  is_class_incharge BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. STUDENTS & ADMINISTRATIVE GUARDIAN RECORDS (NO PARENT LOGIN)
CREATE TABLE IF NOT EXISTS public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  admission_no TEXT NOT NULL,
  roll_no TEXT,
  name_en TEXT NOT NULL,
  name_ur TEXT,
  b_form TEXT,
  dob DATE,
  gender TEXT NOT NULL DEFAULT 'Male' CHECK (gender IN ('Male', 'Female', 'Other')),
  address TEXT,
  admission_date DATE NOT NULL DEFAULT CURRENT_DATE,
  session_id UUID REFERENCES public.academic_sessions(id) ON DELETE SET NULL,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  section_id UUID REFERENCES public.sections(id) ON DELETE SET NULL,
  email TEXT,
  emergency_contact TEXT,
  photo_url TEXT,
  student_id TEXT,
  qr_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Promoted', 'Transferred', 'Withdrawn', 'Graduated', 'Archived')),
  app_access_enabled BOOLEAN NOT NULL DEFAULT false,
  app_account_status TEXT NOT NULL DEFAULT 'not_provisioned' CHECK (app_account_status IN ('not_provisioned', 'pending_invite', 'active', 'blocked', 'deactivated')),
  app_invited_at TIMESTAMPTZ,
  app_last_login_at TIMESTAMPTZ,
  app_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, admission_no)
);

CREATE TABLE IF NOT EXISTS public.student_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('Admission', 'Promotion', 'Transfer', 'Withdrawal', 'Status Change')),
  from_class TEXT,
  to_class TEXT,
  notes TEXT,
  recorded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT 'Father' CHECK (relationship IN ('Father', 'Mother', 'Guardian', 'Other')),
  phone TEXT NOT NULL,
  email TEXT,
  cnic TEXT,
  address TEXT,
  emergency_contact TEXT,
  communication_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.student_guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  guardian_id UUID NOT NULL REFERENCES public.guardians(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (student_id, guardian_id)
);

-- 7. MOBILE APP INVITATION & ACCESS AUDIT HISTORY
CREATE TABLE IF NOT EXISTS public.app_invitation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('teacher', 'student')),
  target_id UUID NOT NULL,
  email TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('invited', 'resent', 'password_reset_sent', 'enabled', 'disabled', 'blocked', 'unblocked', 'deactivated', 'activated')),
  status TEXT NOT NULL DEFAULT 'Sent',
  performed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. ATTENDANCE (STUDENT + TEACHER + LEAVE RECORDS)
CREATE TABLE IF NOT EXISTS public.student_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  section_id UUID REFERENCES public.sections(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL CHECK (status IN ('Present', 'Absent', 'Late', 'Leave')),
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'qr_gate', 'teacher_app')),
  remarks TEXT,
  marked_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, student_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS public.teacher_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL CHECK (status IN ('Present', 'Absent', 'Late', 'Leave')),
  remarks TEXT,
  marked_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, teacher_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS public.staff_leave_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL DEFAULT 'Casual',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Approved' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.student_leave_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL DEFAULT 'Casual',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  reviewer_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. FEES & FINANCE
CREATE TABLE IF NOT EXISTS public.fee_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  tuition_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  admission_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  exam_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  transport_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_charges NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fee_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  voucher_no TEXT NOT NULL,
  billing_month TEXT NOT NULL,
  due_date DATE NOT NULL,
  gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  fine_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid', 'Partial', 'Paid', 'Overdue', 'Cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, voucher_no)
);

CREATE TABLE IF NOT EXISTS public.fee_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  voucher_id UUID NOT NULL REFERENCES public.fee_vouchers(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  receipt_no TEXT NOT NULL,
  amount_paid NUMERIC(12,2) NOT NULL CHECK (amount_paid > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'Bank', 'JazzCash', 'Easypaisa')),
  transaction_ref TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT true,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by UUID REFERENCES auth.users(id),
  UNIQUE (school_id, receipt_no)
);

-- 10. PAYROLL & SALARY
CREATE TABLE IF NOT EXISTS public.salary_slips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  payroll_month TEXT NOT NULL,
  base_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  allowances NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonuses NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  advance_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  absent_days INTEGER NOT NULL DEFAULT 0,
  attendance_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid', 'Paid')),
  payment_method TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, teacher_id, payroll_month)
);

-- 11. EXAMS & RESULTS (WITH PUBLICATION GATE FOR STUDENT APP)
CREATE TABLE IF NOT EXISTS public.exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.academic_sessions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  exam_type TEXT NOT NULL DEFAULT 'Term Exam' CHECK (exam_type IN ('Monthly Test', 'Mid-Term', 'Term Exam', 'Final Exam', 'Send-Up', 'Pre-Board')),
  start_date DATE,
  end_date DATE,
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.exam_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  exam_date DATE NOT NULL,
  start_time TEXT,
  room_no TEXT,
  total_marks NUMERIC(6,2) NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS public.exam_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  total_marks NUMERIC(6,2) NOT NULL DEFAULT 100,
  obtained_marks NUMERIC(6,2) NOT NULL DEFAULT 0,
  grade TEXT,
  remarks TEXT,
  entered_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, exam_id, student_id, subject_id)
);

-- 12. HOMEWORK, STUDY MATERIALS, TIMETABLE & ONLINE CLASSES
CREATE TABLE IF NOT EXISTS public.homework_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  section_id UUID REFERENCES public.sections(id) ON DELETE SET NULL,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE NOT NULL,
  attachment_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homework_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  homework_id UUID NOT NULL REFERENCES public.homework_assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  submission_url TEXT,
  notes TEXT,
  teacher_feedback TEXT,
  status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Reviewed', 'Late')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (homework_id, student_id)
);

CREATE TABLE IF NOT EXISTS public.study_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  material_type TEXT NOT NULL DEFAULT 'PDF Notes' CHECK (material_type IN ('PDF Notes', 'Digital Book', 'Syllabus', 'Chapter Material', 'Educational Video')),
  chapter_name TEXT,
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT,
  video_url TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.timetable_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  section_id UUID REFERENCES public.sections(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  room_no TEXT
);

CREATE TABLE IF NOT EXISTS public.school_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'Event' CHECK (event_type IN ('Holiday', 'Event', 'Exam Calendar', 'Parent Meeting')),
  start_date DATE NOT NULL,
  end_date DATE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.online_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  section_id UUID REFERENCES public.sections(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'LiveKit' CHECK (provider IN ('LiveKit', 'Agora', 'Google Meet', 'Zoom', 'Custom')),
  room_name TEXT NOT NULL,
  meeting_url TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 45,
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Live', 'Completed', 'Cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 13. LIBRARY, TRANSPORT & INVENTORY
CREATE TABLE IF NOT EXISTS public.library_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT,
  isbn TEXT,
  category TEXT NOT NULL DEFAULT 'General',
  total_copies INTEGER NOT NULL DEFAULT 1,
  available_copies INTEGER NOT NULL DEFAULT 1,
  shelf_location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.library_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.library_books(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  issued_at DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  returned_at DATE,
  late_fine NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Issued' CHECK (status IN ('Issued', 'Returned', 'Overdue'))
);

CREATE TABLE IF NOT EXISTS public.transport_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  vehicle_no TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'Van',
  capacity INTEGER NOT NULL DEFAULT 15,
  driver_name TEXT NOT NULL,
  driver_phone TEXT NOT NULL,
  driver_license TEXT,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Maintenance', 'Inactive'))
);

CREATE TABLE IF NOT EXISTS public.transport_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES public.transport_vehicles(id) ON DELETE SET NULL,
  route_name TEXT NOT NULL,
  stops JSONB NOT NULL DEFAULT '[]'::jsonb,
  monthly_fee NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.transport_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES public.transport_routes(id) ON DELETE CASCADE,
  stop_name TEXT NOT NULL,
  monthly_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  UNIQUE (school_id, student_id)
);

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Stationery' CHECK (category IN ('Assets', 'Stationery', 'Equipment', 'Lab', 'Furniture')),
  quantity INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pcs',
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  supplier_name TEXT,
  supplier_phone TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  tx_type TEXT NOT NULL CHECK (tx_type IN ('Purchase', 'Issue', 'Adjustment')),
  quantity INTEGER NOT NULL,
  issued_to TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 14. CERTIFICATES, COMMUNICATION, SUPPORT TICKETS & AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.certificates_issued (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  certificate_type TEXT NOT NULL CHECK (certificate_type IN ('School Leaving', 'Character', 'Bonafide', 'Admission Letter')),
  serial_no TEXT NOT NULL,
  issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
  remarks TEXT,
  issued_by UUID REFERENCES auth.users(id),
  UNIQUE (school_id, serial_no)
);

CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'All' CHECK (audience IN ('All', 'Teachers', 'Students')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_role TEXT NOT NULL DEFAULT 'All',
  category TEXT NOT NULL DEFAULT 'General',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  ticket_number TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Waiting for School', 'Resolved', 'Closed')),
  attachment_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('school', 'super_admin')),
  sender_user_id UUID REFERENCES auth.users(id),
  message TEXT NOT NULL,
  attachment_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id),
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
