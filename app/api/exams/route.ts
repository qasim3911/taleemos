import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { ensurePublicUserProfile } from '@/lib/auth/ensure-user-profile';
import { hasStudentsColumn } from '@/lib/students/identifiers';
import { computeExamGrade } from '@/lib/exams/grading';

const VALID_EXAM_TYPES = ['Monthly', 'Midterm', 'Final', 'Test'] as const;

const EXAM_TYPE_MAP: Record<string, (typeof VALID_EXAM_TYPES)[number]> = {
  monthly: 'Monthly',
  'monthly test': 'Monthly',
  midterm: 'Midterm',
  'mid-term': 'Midterm',
  'term exam': 'Midterm',
  final: 'Final',
  'final exam': 'Final',
  test: 'Test',
  'send-up': 'Test',
  'pre-board': 'Test',
};

const BulkMarkRowSchema = z.object({
  student_id: z.string().uuid(),
  obtained_marks: z.number().min(0).max(10000),
  attendance_status: z.enum(['present', 'absent']).default('present'),
  remarks: z.string().max(500).nullable().optional(),
});

const ExamActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_exam'),
    title: z.string().trim().min(1).max(200),
    exam_type: z.string().min(1),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    action: z.literal('delete_exam'),
    exam_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal('save_marks'),
    exam_id: z.string().uuid(),
    student_id: z.string().uuid(),
    subject_id: z.string().uuid(),
    total_marks: z.number().positive().max(10000),
    passing_marks: z.number().min(0).max(10000).optional(),
    obtained_marks: z.number().min(0).max(10000),
    attendance_status: z.enum(['present', 'absent']).default('present'),
    remarks: z.string().max(500).nullable().optional(),
  }),
  z.object({
    action: z.literal('bulk_save_marks'),
    exam_id: z.string().uuid(),
    subject_id: z.string().uuid(),
    total_marks: z.number().positive().max(10000),
    passing_marks: z.number().min(0).max(10000).optional(),
    rows: z.array(BulkMarkRowSchema).min(1).max(300),
  }),
  z.object({
    action: z.literal('delete_mark'),
    mark_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal('quick_create_subject'),
    name: z.string().trim().min(1).max(120),
    code: z.string().trim().max(30).optional().nullable(),
  }),
  z.object({
    action: z.literal('toggle_publish'),
    exam_id: z.string().uuid(),
    is_published: z.boolean(),
  }),
]);

export async function GET() {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const supportsStudentId = await hasStudentsColumn(db, 'student_id');
  const studentSelect = supportsStudentId
    ? 'id, admission_number, roll_number, student_id, name_en, class_id, section_id'
    : 'id, admission_number, roll_number, name_en, class_id, section_id';

  const [
    { data: exams, error: eErr },
    { data: students },
    { data: subjects },
    { data: classes },
    { data: sections },
    { data: marks },
  ] = await Promise.all([
    db
      .from('exams')
      .select('*')
      .eq('school_id', context.school.id)
      .order('created_at', { ascending: false }),
    db
      .from('students')
      .select(studentSelect)
      .eq('school_id', context.school.id)
      .in('status', ['active', 'Active'])
      .order('admission_number'),
    db
      .from('subjects')
      .select('id, name, code')
      .eq('school_id', context.school.id)
      .order('name'),
    db
      .from('classes')
      .select('id, name, level_order')
      .eq('school_id', context.school.id)
      .order('level_order'),
    db
      .from('sections')
      .select('id, name, class_id')
      .eq('school_id', context.school.id)
      .order('name'),
    db.from('exam_marks').select('*').eq('school_id', context.school.id),
  ]);

  if (eErr) {
    return NextResponse.json({ error: eErr.message }, { status: 400 });
  }

  return NextResponse.json({
    exams: exams ?? [],
    students: students ?? [],
    subjects: subjects ?? [],
    classes: classes ?? [],
    sections: sections ?? [],
    marks: marks ?? [],
  });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'exams')) {
    return NextResponse.json({ error: 'Insufficient permissions for Exams & Results.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = ExamActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid exam or marks payload.', issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    if (parsed.data.action === 'create_exam') {
      const normalizedType =
        EXAM_TYPE_MAP[parsed.data.exam_type.trim().toLowerCase()] ??
        (VALID_EXAM_TYPES.includes(parsed.data.exam_type as (typeof VALID_EXAM_TYPES)[number])
          ? (parsed.data.exam_type as (typeof VALID_EXAM_TYPES)[number])
          : 'Monthly');

      const { data: exam, error } = await db
        .from('exams')
        .insert({
          school_id: context.school.id,
          title: parsed.data.title,
          exam_type: normalizedType,
          start_date: parsed.data.start_date,
          end_date: parsed.data.end_date < parsed.data.start_date ? parsed.data.start_date : parsed.data.end_date,
          is_published: false,
        })
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, exam });
    }

    if (parsed.data.action === 'delete_exam') {
      const { error } = await db
        .from('exams')
        .delete()
        .eq('id', parsed.data.exam_id)
        .eq('school_id', context.school.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    if (parsed.data.action === 'quick_create_subject') {
      const { data: existingSub } = await db
        .from('subjects')
        .select('id, name, code')
        .eq('school_id', context.school.id)
        .ilike('name', parsed.data.name)
        .maybeSingle();

      if (existingSub) {
        return NextResponse.json({ success: true, subject: existingSub, alreadyExists: true });
      }

      const { data: subject, error } = await db
        .from('subjects')
        .insert({
          school_id: context.school.id,
          name: parsed.data.name,
          code: parsed.data.code?.trim() || null,
        })
        .select('id, name, code')
        .single();

      if (error || !subject) {
        return NextResponse.json(
          { error: error?.message || 'Unable to create subject.' },
          { status: 400 }
        );
      }

      return NextResponse.json({ success: true, subject }, { status: 201 });
    }

    if (parsed.data.action === 'save_marks') {
      if (parsed.data.obtained_marks > parsed.data.total_marks) {
        return NextResponse.json(
          { error: 'Obtained marks cannot exceed total marks.' },
          { status: 400 }
        );
      }

      await ensurePublicUserProfile(
        db,
        context.userId,
        context.userEmail,
        context.member.full_name
      );

      const passing =
        parsed.data.passing_marks !== undefined
          ? Math.min(parsed.data.total_marks, parsed.data.passing_marks)
          : Math.round(parsed.data.total_marks * 0.33);
      const effectiveObtained =
        parsed.data.attendance_status === 'absent' ? 0 : parsed.data.obtained_marks;
      const grade =
        parsed.data.attendance_status === 'absent'
          ? 'F'
          : computeExamGrade(effectiveObtained, parsed.data.total_marks);

      const { data: existing } = await db
        .from('exam_marks')
        .select('id')
        .eq('school_id', context.school.id)
        .eq('exam_id', parsed.data.exam_id)
        .eq('student_id', parsed.data.student_id)
        .eq('subject_id', parsed.data.subject_id)
        .maybeSingle();

      const payload = {
        school_id: context.school.id,
        exam_id: parsed.data.exam_id,
        student_id: parsed.data.student_id,
        subject_id: parsed.data.subject_id,
        total_marks: parsed.data.total_marks,
        obtained_marks: effectiveObtained,
        passing_marks: passing,
        attendance_status: parsed.data.attendance_status,
        grade,
        remarks: parsed.data.remarks?.trim() || null,
        entered_by: context.userId,
        updated_at: new Date().toISOString(),
      };

      const { data: mark, error } = existing
        ? await db.from('exam_marks').update(payload).eq('id', existing.id).select('*').single()
        : await db.from('exam_marks').insert(payload).select('*').single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, mark });
    }

    if (parsed.data.action === 'bulk_save_marks') {
      const { exam_id, subject_id, total_marks, rows } = parsed.data;
      const passing =
        parsed.data.passing_marks !== undefined
          ? Math.min(total_marks, parsed.data.passing_marks)
          : Math.round(total_marks * 0.33);

      for (const row of rows) {
        if (row.attendance_status === 'present' && row.obtained_marks > total_marks) {
          return NextResponse.json(
            { error: `Obtained marks (${row.obtained_marks}) cannot exceed total marks (${total_marks}).` },
            { status: 400 }
          );
        }
      }

      await ensurePublicUserProfile(
        db,
        context.userId,
        context.userEmail,
        context.member.full_name
      );

      const studentIds = rows.map((r) => r.student_id);
      const { data: existingRows } = await db
        .from('exam_marks')
        .select('id, student_id')
        .eq('school_id', context.school.id)
        .eq('exam_id', exam_id)
        .eq('subject_id', subject_id)
        .in('student_id', studentIds);

      const existingMap = new Map<string, string>(
        (existingRows ?? []).map((r) => [String(r.student_id), String(r.id)])
      );

      const now = new Date().toISOString();
      const toInsert: Array<Record<string, unknown>> = [];
      const toUpdate: Array<{ id: string; payload: Record<string, unknown> }> = [];

      for (const row of rows) {
        const effectiveObtained = row.attendance_status === 'absent' ? 0 : row.obtained_marks;
        const grade =
          row.attendance_status === 'absent'
            ? 'F'
            : computeExamGrade(effectiveObtained, total_marks);

        const basePayload = {
          school_id: context.school.id,
          exam_id,
          student_id: row.student_id,
          subject_id,
          total_marks,
          obtained_marks: effectiveObtained,
          passing_marks: passing,
          attendance_status: row.attendance_status,
          grade,
          remarks: row.remarks?.trim() || null,
          entered_by: context.userId,
          updated_at: now,
        };

        const existingId = existingMap.get(row.student_id);
        if (existingId) {
          toUpdate.push({ id: existingId, payload: basePayload });
        } else {
          toInsert.push(basePayload);
        }
      }

      if (toInsert.length > 0) {
        const { error: insErr } = await db.from('exam_marks').insert(toInsert);
        if (insErr) {
          return NextResponse.json({ error: insErr.message }, { status: 400 });
        }
      }

      if (toUpdate.length > 0) {
        const updateResults = await Promise.all(
          toUpdate.map((u) =>
            db
              .from('exam_marks')
              .update(u.payload)
              .eq('id', u.id)
              .eq('school_id', context.school.id)
          )
        );
        const firstErr = updateResults.find((r) => r.error)?.error;
        if (firstErr) {
          return NextResponse.json({ error: firstErr.message }, { status: 400 });
        }
      }

      return NextResponse.json({
        success: true,
        savedCount: rows.length,
        insertedCount: toInsert.length,
        updatedCount: toUpdate.length,
      });
    }

    if (parsed.data.action === 'delete_mark') {
      const { error } = await db
        .from('exam_marks')
        .delete()
        .eq('id', parsed.data.mark_id)
        .eq('school_id', context.school.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    const { data: updatedExam, error } = await db
      .from('exams')
      .update({
        is_published: parsed.data.is_published,
        published_at: parsed.data.is_published ? new Date().toISOString() : null,
      })
      .eq('id', parsed.data.exam_id)
      .eq('school_id', context.school.id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (parsed.data.is_published && updatedExam) {
      await db.from('notifications').insert({
        school_id: context.school.id,
        target_audience: 'Students',
        category: 'results',
        title: `Results Published: ${updatedExam.title}`,
        body: `Results for ${updatedExam.title} are now published and visible in the Student App.`,
        metadata: { exam_id: updatedExam.id },
        is_read: false,
      });
    }

    return NextResponse.json({ success: true, exam: updatedExam });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to save exam data.' },
      { status: 500 }
    );
  }
}
