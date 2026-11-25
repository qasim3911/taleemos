-- Add dedicated student_id column to students table so Student IDs are stored separately from qr_token
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS student_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS students_school_student_id_uidx
  ON public.students (school_id, student_id)
  WHERE student_id IS NOT NULL;
