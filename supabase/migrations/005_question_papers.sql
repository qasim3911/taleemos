-- Question Paper Builder table for Student Exams & Tests
CREATE TABLE IF NOT EXISTS public.question_papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id UUID REFERENCES public.exams(id) ON DELETE SET NULL,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  section_id UUID REFERENCES public.sections(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  paper_code TEXT,
  paper_type TEXT NOT NULL DEFAULT 'Exam' CHECK (paper_type IN ('Test', 'Quiz', 'Monthly', 'Midterm', 'Final', 'Exam')),
  exam_date DATE,
  time_allowed TEXT NOT NULL DEFAULT '1 Hour 30 Mins',
  total_marks NUMERIC(6,2) NOT NULL DEFAULT 50,
  passing_marks NUMERIC(6,2) NOT NULL DEFAULT 17,
  academic_session TEXT,
  instructions TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ur', 'bilingual')),
  show_student_info_box BOOLEAN NOT NULL DEFAULT true,
  show_answer_lines BOOLEAN NOT NULL DEFAULT false,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_question_papers_school
  ON public.question_papers(school_id, updated_at DESC);

ALTER TABLE public.question_papers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "School members can read question papers" ON public.question_papers;
CREATE POLICY "School members can read question papers"
  ON public.question_papers
  FOR SELECT
  USING (public.is_school_member(school_id));

DROP POLICY IF EXISTS "Staff with exams permission can manage question papers" ON public.question_papers;
CREATE POLICY "Staff with exams permission can manage question papers"
  ON public.question_papers
  FOR ALL
  USING (public.has_school_permission(school_id, 'exams'))
  WITH CHECK (public.has_school_permission(school_id, 'exams'));
