import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { ensurePublicUserProfile } from '@/lib/auth/ensure-user-profile';

const AssignSchema = z.object({
  teacherId: z.string().uuid(),
  classId: z.string().uuid(),
  sectionId: z.string().uuid().optional().nullable(),
  subjectId: z.string().uuid().optional().nullable(),
  subjectIds: z.array(z.string().uuid()).max(50).optional(),
  sessionId: z.string().uuid().optional().nullable(),
  isClassIncharge: z.boolean().default(false),
});

const UpdateAssignmentSchema = z.object({
  id: z.string().uuid(),
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional().nullable(),
  subjectId: z.string().uuid().optional().nullable(),
  sessionId: z.string().uuid().optional().nullable(),
  isClassIncharge: z.boolean().optional(),
});

const DeleteAssignmentSchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.array(z.string().uuid()).min(1).max(200).optional(),
  teacherId: z.string().uuid().optional(),
});

function canManageTeacherAssignments(member: Parameters<typeof hasModulePermission>[0]) {
  return hasModulePermission(member, 'academics') || hasModulePermission(member, 'staff');
}

export async function GET() {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!canManageTeacherAssignments(context.member)) {
    return NextResponse.json(
      { error: 'Insufficient permissions to manage teacher class assignments.' },
      { status: 403 }
    );
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const schoolId = context.school.id;

  const [
    { data: assignments, error: assignErr },
    { data: teachers, error: teacherErr },
    { data: classes, error: classErr },
    { data: sections, error: sectionErr },
    { data: subjects, error: subjectErr },
    { data: classSubjects, error: classSubErr },
    { data: sessions, error: sessionErr },
  ] = await Promise.all([
    db
      .from('teacher_assignments')
      .select('id, teacher_id, session_id, class_id, section_id, subject_id, is_class_incharge, created_at')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    db
      .from('teachers')
      .select('id, employee_code, full_name, designation, department, status')
      .eq('school_id', schoolId)
      .order('full_name'),
    db
      .from('classes')
      .select('id, name, level_order')
      .eq('school_id', schoolId)
      .order('level_order'),
    db
      .from('sections')
      .select('id, name, class_id')
      .eq('school_id', schoolId)
      .order('name'),
    db
      .from('subjects')
      .select('id, name, code')
      .eq('school_id', schoolId)
      .order('name'),
    db
      .from('class_subjects')
      .select('id, class_id, subject_id')
      .eq('school_id', schoolId),
    db
      .from('academic_sessions')
      .select('id, name, is_current, start_date')
      .eq('school_id', schoolId)
      .order('start_date', { ascending: false }),
  ]);

  const firstError =
    assignErr || teacherErr || classErr || sectionErr || subjectErr || classSubErr || sessionErr;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  return NextResponse.json({
    assignments: assignments ?? [],
    teachers: teachers ?? [],
    classes: classes ?? [],
    sections: sections ?? [],
    subjects: subjects ?? [],
    classSubjects: classSubjects ?? [],
    sessions: sessions ?? [],
  });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!canManageTeacherAssignments(context.member)) {
    return NextResponse.json(
      { error: 'Insufficient permissions to assign teachers to classes.' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const parsed = AssignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Please select a valid teacher, class, and assignment options.' },
        { status: 400 }
      );
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    const schoolId = context.school.id;
    const input = parsed.data;

    await ensurePublicUserProfile(db, context.userId, context.userEmail, context.member.full_name);

    const [{ data: teacherRow }, { data: classRow }] = await Promise.all([
      db
        .from('teachers')
        .select('id, full_name, status')
        .eq('id', input.teacherId)
        .eq('school_id', schoolId)
        .maybeSingle(),
      db
        .from('classes')
        .select('id, name')
        .eq('id', input.classId)
        .eq('school_id', schoolId)
        .maybeSingle(),
    ]);

    if (!teacherRow) {
      return NextResponse.json({ error: 'Selected teacher was not found in your school.' }, { status: 404 });
    }
    if (!classRow) {
      return NextResponse.json({ error: 'Selected class was not found in your school.' }, { status: 404 });
    }

    let validSectionId: string | null = null;
    if (input.sectionId) {
      const { data: sectionRow } = await db
        .from('sections')
        .select('id, class_id')
        .eq('id', input.sectionId)
        .eq('school_id', schoolId)
        .maybeSingle();

      if (!sectionRow) {
        return NextResponse.json({ error: 'Selected section was not found.' }, { status: 404 });
      }
      if (sectionRow.class_id !== input.classId) {
        return NextResponse.json(
          { error: 'Selected section does not belong to the chosen class.' },
          { status: 400 }
        );
      }
      validSectionId = sectionRow.id;
    }

    let validSessionId: string | null = null;
    if (input.sessionId) {
      const { data: sessionRow } = await db
        .from('academic_sessions')
        .select('id')
        .eq('id', input.sessionId)
        .eq('school_id', schoolId)
        .maybeSingle();

      if (!sessionRow) {
        return NextResponse.json({ error: 'Selected academic session was not found.' }, { status: 404 });
      }
      validSessionId = sessionRow.id;
    }

    const requestedSubjectIds =
      input.subjectIds && input.subjectIds.length > 0
        ? Array.from(new Set(input.subjectIds))
        : input.subjectId
          ? [input.subjectId]
          : [];

    if (requestedSubjectIds.length > 0) {
      const { data: validSubjects } = await db
        .from('subjects')
        .select('id')
        .eq('school_id', schoolId)
        .in('id', requestedSubjectIds);

      if (!validSubjects || validSubjects.length !== requestedSubjectIds.length) {
        return NextResponse.json(
          { error: 'One or more selected subjects do not belong to your school.' },
          { status: 400 }
        );
      }
    }

    const targetSubjects: Array<string | null> =
      requestedSubjectIds.length > 0 ? requestedSubjectIds : [null];

    const { data: existingRows, error: existingErr } = await db
      .from('teacher_assignments')
      .select('id, section_id, subject_id')
      .eq('school_id', schoolId)
      .eq('teacher_id', input.teacherId)
      .eq('class_id', input.classId);

    if (existingErr) {
      return NextResponse.json({ error: existingErr.message }, { status: 500 });
    }

    const existingKeys = new Set(
      (existingRows ?? []).map(
        (r: { section_id: string | null; subject_id: string | null }) =>
          `${r.section_id ?? 'NULL'}::${r.subject_id ?? 'NULL'}`
      )
    );

    const rowsToInsert = targetSubjects
      .filter((subjId) => !existingKeys.has(`${validSectionId ?? 'NULL'}::${subjId ?? 'NULL'}`))
      .map((subjId) => ({
        school_id: schoolId,
        teacher_id: input.teacherId,
        session_id: validSessionId,
        class_id: input.classId,
        section_id: validSectionId,
        subject_id: subjId,
        is_class_incharge: input.isClassIncharge,
      }));

    if (rowsToInsert.length === 0) {
      return NextResponse.json(
        { error: 'This teacher is already assigned to the selected class, section, and subject.' },
        { status: 409 }
      );
    }

    const { data: insertedRows, error: insertErr } = await db
      .from('teacher_assignments')
      .insert(rowsToInsert)
      .select('id, teacher_id, session_id, class_id, section_id, subject_id, is_class_incharge, created_at');

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 400 });
    }

    await db.from('audit_logs').insert({
      school_id: schoolId,
      user_id: context.userId,
      action: 'TEACHER_CLASS_ASSIGNED',
      table_name: 'teacher_assignments',
      record_id: insertedRows?.[0]?.id ?? null,
      new_values: {
        teacher_id: input.teacherId,
        teacher_name: teacherRow.full_name,
        class_id: input.classId,
        class_name: classRow.name,
        section_id: validSectionId,
        subject_ids: targetSubjects,
        is_class_incharge: input.isClassIncharge,
        inserted_count: insertedRows?.length ?? 0,
      },
    });

    return NextResponse.json(
      {
        success: true,
        insertedCount: insertedRows?.length ?? 0,
        skippedCount: targetSubjects.length - rowsToInsert.length,
        assignments: insertedRows ?? [],
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to assign class to teacher.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!canManageTeacherAssignments(context.member)) {
    return NextResponse.json(
      { error: 'Insufficient permissions to update teacher class assignments.' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const parsed = UpdateAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid assignment update payload.' }, { status: 400 });
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    const schoolId = context.school.id;
    const input = parsed.data;

    const { data: existingRow, error: fetchErr } = await db
      .from('teacher_assignments')
      .select('id, teacher_id, session_id, class_id, section_id, subject_id, is_class_incharge')
      .eq('id', input.id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (fetchErr || !existingRow) {
      return NextResponse.json({ error: 'Assignment record not found.' }, { status: 404 });
    }

    const nextClassId = input.classId ?? existingRow.class_id;
    const nextSectionId =
      input.sectionId !== undefined
        ? input.sectionId
        : input.classId && input.classId !== existingRow.class_id
          ? null
          : existingRow.section_id;
    const nextSubjectId = input.subjectId !== undefined ? input.subjectId : existingRow.subject_id;
    const nextSessionId = input.sessionId !== undefined ? input.sessionId : existingRow.session_id;
    const nextIncharge =
      input.isClassIncharge !== undefined ? input.isClassIncharge : existingRow.is_class_incharge;

    if (input.classId) {
      const { data: cls } = await db
        .from('classes')
        .select('id')
        .eq('id', nextClassId)
        .eq('school_id', schoolId)
        .maybeSingle();
      if (!cls) {
        return NextResponse.json({ error: 'Selected class was not found.' }, { status: 404 });
      }
    }

    if (nextSectionId) {
      const { data: sec } = await db
        .from('sections')
        .select('id, class_id')
        .eq('id', nextSectionId)
        .eq('school_id', schoolId)
        .maybeSingle();
      if (!sec || sec.class_id !== nextClassId) {
        return NextResponse.json(
          { error: 'Selected section does not belong to the chosen class.' },
          { status: 400 }
        );
      }
    }

    if (nextSubjectId) {
      const { data: subj } = await db
        .from('subjects')
        .select('id')
        .eq('id', nextSubjectId)
        .eq('school_id', schoolId)
        .maybeSingle();
      if (!subj) {
        return NextResponse.json({ error: 'Selected subject was not found.' }, { status: 404 });
      }
    }

    if (nextSessionId) {
      const { data: sess } = await db
        .from('academic_sessions')
        .select('id')
        .eq('id', nextSessionId)
        .eq('school_id', schoolId)
        .maybeSingle();
      if (!sess) {
        return NextResponse.json({ error: 'Selected academic session was not found.' }, { status: 404 });
      }
    }

    const { data: siblingRows } = await db
      .from('teacher_assignments')
      .select('id, section_id, subject_id')
      .eq('school_id', schoolId)
      .eq('teacher_id', existingRow.teacher_id)
      .eq('class_id', nextClassId)
      .neq('id', input.id);

    const hasDuplicate = (siblingRows ?? []).some(
      (r: { section_id: string | null; subject_id: string | null }) =>
        (r.section_id ?? null) === (nextSectionId ?? null) &&
        (r.subject_id ?? null) === (nextSubjectId ?? null)
    );

    if (hasDuplicate) {
      return NextResponse.json(
        { error: 'Another identical class/section/subject assignment already exists for this teacher.' },
        { status: 409 }
      );
    }

    const { data: updated, error: updateErr } = await db
      .from('teacher_assignments')
      .update({
        class_id: nextClassId,
        section_id: nextSectionId ?? null,
        subject_id: nextSubjectId ?? null,
        session_id: nextSessionId ?? null,
        is_class_incharge: nextIncharge,
      })
      .eq('id', input.id)
      .eq('school_id', schoolId)
      .select('id, teacher_id, session_id, class_id, section_id, subject_id, is_class_incharge, created_at')
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    await ensurePublicUserProfile(db, context.userId, context.userEmail, context.member.full_name);
    await db.from('audit_logs').insert({
      school_id: schoolId,
      user_id: context.userId,
      action: 'TEACHER_CLASS_UPDATED',
      table_name: 'teacher_assignments',
      record_id: input.id,
      old_values: existingRow,
      new_values: updated,
    });

    return NextResponse.json({ success: true, assignment: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to update assignment.' },
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
  if (!canManageTeacherAssignments(context.member)) {
    return NextResponse.json(
      { error: 'Insufficient permissions to unassign teacher classes.' },
      { status: 403 }
    );
  }

  try {
    const url = new URL(request.url);
    const queryId = url.searchParams.get('id') || undefined;
    const queryTeacherId = url.searchParams.get('teacherId') || undefined;

    let bodyPayload: Record<string, unknown> = {};
    if (!queryId && !queryTeacherId) {
      bodyPayload = await request.json().catch(() => ({}));
    }

    const parsed = DeleteAssignmentSchema.safeParse({
      id: queryId ?? bodyPayload.id,
      ids: bodyPayload.ids,
      teacherId: queryTeacherId ?? bodyPayload.teacherId,
    });

    if (!parsed.success || (!parsed.data.id && !parsed.data.ids && !parsed.data.teacherId)) {
      return NextResponse.json(
        { error: 'Provide an assignment ID, list of IDs, or teacher ID to unassign.' },
        { status: 400 }
      );
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    const schoolId = context.school.id;
    await ensurePublicUserProfile(db, context.userId, context.userEmail, context.member.full_name);

    let deleteQuery = db
      .from('teacher_assignments')
      .delete()
      .eq('school_id', schoolId);

    if (parsed.data.id) {
      deleteQuery = deleteQuery.eq('id', parsed.data.id);
    } else if (parsed.data.ids && parsed.data.ids.length > 0) {
      deleteQuery = deleteQuery.in('id', parsed.data.ids);
    } else if (parsed.data.teacherId) {
      deleteQuery = deleteQuery.eq('teacher_id', parsed.data.teacherId);
    }

    const { data: deletedRows, error: delErr } = await deleteQuery.select('id, teacher_id, class_id');

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json({ error: 'No matching assignments found to unassign.' }, { status: 404 });
    }

    await db.from('audit_logs').insert({
      school_id: schoolId,
      user_id: context.userId,
      action: 'TEACHER_CLASS_UNASSIGNED',
      table_name: 'teacher_assignments',
      record_id: deletedRows[0].id,
      old_values: {
        removed_count: deletedRows.length,
        removed_ids: deletedRows.map((r: { id: string }) => r.id),
        teacher_id: parsed.data.teacherId ?? deletedRows[0].teacher_id,
      },
    });

    return NextResponse.json({
      success: true,
      removedCount: deletedRows.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to unassign class.' },
      { status: 500 }
    );
  }
}
