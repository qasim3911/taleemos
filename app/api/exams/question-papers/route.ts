import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { ensurePublicUserProfile } from '@/lib/auth/ensure-user-profile';
import {
  calculatePaperTotalMarks,
  deleteQuestionPaper,
  listQuestionPapers,
  saveQuestionPaper,
} from '@/lib/exams/question-papers';

const QuestionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['mcq', 'short', 'long', 'fill_blank', 'true_false']),
  prompt: z.string().trim().min(1),
  marks: z.coerce.number().min(0).max(500).default(1),
  options: z.array(z.string()).optional(),
  correctAnswer: z.string().optional(),
  isRtl: z.boolean().optional(),
});

const SectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  instructions: z.string().max(400).optional(),
  questions: z.array(QuestionSchema),
});

const SavePaperSchema = z.object({
  id: z.string().uuid().optional(),
  exam_id: z.string().uuid().nullable().optional(),
  class_id: z.string().uuid().nullable().optional(),
  section_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(200),
  paper_code: z.string().trim().max(50).nullable().optional(),
  paper_type: z.enum(['Test', 'Quiz', 'Monthly', 'Midterm', 'Final', 'Exam']).default('Exam'),
  exam_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  time_allowed: z.string().trim().min(1).max(80).default('1 Hour 30 Mins'),
  total_marks: z.coerce.number().min(0).max(10000).optional(),
  passing_marks: z.coerce.number().min(0).max(10000).optional(),
  academic_session: z.string().trim().max(80).nullable().optional(),
  instructions: z.string().max(1500).nullable().optional(),
  language: z.enum(['en', 'ur', 'bilingual']).default('en'),
  show_student_info_box: z.boolean().default(true),
  show_answer_lines: z.boolean().default(false),
  sections: z.array(SectionSchema).min(1),
  status: z.enum(['draft', 'finalized']).default('draft'),
});

export async function GET() {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'exams')) {
    return NextResponse.json({ error: 'Insufficient permissions for Exams.' }, { status: 403 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const result = await listQuestionPapers(db, context.school.id);

  return NextResponse.json({
    papers: result.papers,
    storageMode: result.storageMode,
  });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'exams')) {
    return NextResponse.json({ error: 'Insufficient permissions for Exams.' }, { status: 403 });
  }

  try {
    const body = await request.json();

    if (body?.action === 'duplicate' && typeof body?.id === 'string') {
      const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
      const { papers } = await listQuestionPapers(db, context.school.id);
      const source = papers.find((p) => p.id === body.id);
      if (!source) {
        return NextResponse.json({ error: 'Source question paper not found.' }, { status: 404 });
      }
      await ensurePublicUserProfile(db, context.userId, context.userEmail, context.member.full_name);

      const copyResult = await saveQuestionPaper(db, {
        school_id: context.school.id,
        exam_id: source.exam_id,
        class_id: source.class_id,
        section_id: source.section_id,
        subject_id: source.subject_id,
        title: `${source.title} (Copy)`,
        paper_code: source.paper_code ? `${source.paper_code}-COPY` : null,
        paper_type: source.paper_type,
        exam_date: source.exam_date,
        time_allowed: source.time_allowed,
        total_marks: source.total_marks,
        passing_marks: source.passing_marks,
        academic_session: source.academic_session,
        instructions: source.instructions,
        language: source.language,
        show_student_info_box: source.show_student_info_box,
        show_answer_lines: source.show_answer_lines,
        sections: source.sections.map((s) => ({
          ...s,
          id: crypto.randomUUID(),
          questions: s.questions.map((q) => ({ ...q, id: crypto.randomUUID() })),
        })),
        status: 'draft',
        created_by: context.userId,
      });

      if (copyResult.error || !copyResult.paper) {
        return NextResponse.json(
          { error: copyResult.error || 'Unable to duplicate paper.' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        paper: copyResult.paper,
        storageMode: copyResult.storageMode,
      });
    }

    const parsed = SavePaperSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Please complete the question paper title and at least one section.', issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    await ensurePublicUserProfile(db, context.userId, context.userEmail, context.member.full_name);

    const computedMarks = calculatePaperTotalMarks(input.sections);
    const totalMarks =
      typeof input.total_marks === 'number' && input.total_marks > 0
        ? input.total_marks
        : computedMarks;
    const passingMarks =
      typeof input.passing_marks === 'number' && input.passing_marks >= 0
        ? Math.min(totalMarks, input.passing_marks)
        : Math.round(totalMarks * 0.33);

    const saved = await saveQuestionPaper(db, {
      id: input.id,
      school_id: context.school.id,
      exam_id: input.exam_id || null,
      class_id: input.class_id || null,
      section_id: input.section_id || null,
      subject_id: input.subject_id || null,
      title: input.title,
      paper_code: input.paper_code || null,
      paper_type: input.paper_type,
      exam_date: input.exam_date || null,
      time_allowed: input.time_allowed,
      total_marks: totalMarks,
      passing_marks: passingMarks,
      academic_session: input.academic_session || null,
      instructions: input.instructions || null,
      language: input.language,
      show_student_info_box: input.show_student_info_box,
      show_answer_lines: input.show_answer_lines,
      sections: input.sections,
      status: input.status,
      created_by: context.userId,
    });

    if (saved.error || !saved.paper) {
      return NextResponse.json(
        { error: saved.error || 'Unable to save question paper.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      paper: saved.paper,
      storageMode: saved.storageMode,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to save question paper.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'exams')) {
    return NextResponse.json({ error: 'Insufficient permissions for Exams.' }, { status: 403 });
  }

  const url = new URL(request.url);
  let id = url.searchParams.get('id');
  if (!id) {
    const body = await request.json().catch(() => ({}));
    if (typeof body.id === 'string') id = body.id;
  }

  if (!id) {
    return NextResponse.json({ error: 'Question paper id is required.' }, { status: 400 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const res = await deleteQuestionPaper(db, context.school.id, id);
  if (res.error) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
