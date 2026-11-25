import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

const LinkSchema = z.object({
  guardianId: z.string().uuid(),
  studentId: z.string().uuid(),
  relationshipType: z.string().default('Father'),
  isPrimary: z.boolean().default(true),
});

const UnlinkSchema = z.object({
  guardianId: z.string().uuid(),
  studentId: z.string().uuid(),
});

export async function GET(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const url = new URL(request.url);
  const studentId = url.searchParams.get('studentId');
  const guardianId = url.searchParams.get('guardianId');

  if (studentId) {
    const { data: links, error: lErr } = await db
      .from('student_guardians')
      .select('id, guardian_id, is_primary')
      .eq('school_id', context.school.id)
      .eq('student_id', studentId);

    if (lErr) {
      return NextResponse.json({ error: lErr.message }, { status: 400 });
    }

    const guardianIds = (links ?? []).map((l) => l.guardian_id);
    const { data: guardians } =
      guardianIds.length > 0
        ? await db.from('guardians').select('*').in('id', guardianIds)
        : { data: [] };

    const gMap = new Map((guardians ?? []).map((g) => [g.id, g]));
    const result = (links ?? []).map((l) => ({
      linkId: l.id,
      guardian: gMap.get(l.guardian_id) ?? null,
      isPrimary: l.is_primary,
    }));

    return NextResponse.json({ links: result });
  }

  if (guardianId) {
    const { data: links, error: lErr } = await db
      .from('student_guardians')
      .select('id, student_id, is_primary')
      .eq('school_id', context.school.id)
      .eq('guardian_id', guardianId);

    if (lErr) {
      return NextResponse.json({ error: lErr.message }, { status: 400 });
    }

    const studentIds = (links ?? []).map((l) => l.student_id);
    const [{ data: students }, { data: classes }, { data: sections }] = await Promise.all([
      studentIds.length > 0
        ? db.from('students').select('*').in('id', studentIds)
        : Promise.resolve({ data: [] }),
      db.from('classes').select('id, name').eq('school_id', context.school.id),
      db.from('sections').select('id, name').eq('school_id', context.school.id),
    ]);

    const classMap = new Map((classes ?? []).map((c) => [c.id as string, c.name as string]));
    const sectionMap = new Map((sections ?? []).map((s) => [s.id as string, s.name as string]));
    const sMap = new Map((students ?? []).map((s) => [s.id, s]));

    const result = (links ?? []).map((l) => {
      const s = sMap.get(l.student_id);
      return {
        linkId: l.id,
        student: s
          ? {
              ...s,
              className: s.class_id ? classMap.get(s.class_id) || 'Class' : 'Unassigned',
              sectionName: s.section_id ? sectionMap.get(s.section_id) || '' : '',
            }
          : null,
        isPrimary: l.is_primary,
      };
    });

    return NextResponse.json({ links: result });
  }

  return NextResponse.json({ error: 'Specify either studentId or guardianId.' }, { status: 400 });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'parents') && !hasModulePermission(context.member, 'students')) {
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = LinkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid link payload.', issues: parsed.error.issues }, { status: 400 });
    }

    const { guardianId, studentId, relationshipType, isPrimary } = parsed.data;
    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    // Validate both guardian and student belong to this school
    const [{ data: guardian }, { data: student }] = await Promise.all([
      db.from('guardians').select('id, full_name, phone').eq('id', guardianId).eq('school_id', context.school.id).maybeSingle(),
      db.from('students').select('id, name_en, admission_number').eq('id', studentId).eq('school_id', context.school.id).maybeSingle(),
    ]);

    if (!guardian) {
      return NextResponse.json({ error: 'Guardian not found in this school.' }, { status: 404 });
    }
    if (!student) {
      return NextResponse.json({ error: 'Student not found in this school.' }, { status: 404 });
    }

    // Check if active relationship already exists
    const { data: existingLink } = await db
      .from('student_guardians')
      .select('id, is_verified, status')
      .eq('school_id', context.school.id)
      .eq('guardian_id', guardianId)
      .eq('student_id', studentId)
      .maybeSingle();

    let linkId: string | undefined = existingLink?.id ? String(existingLink.id) : undefined;

    if (existingLink) {
      if (existingLink.is_verified === true && existingLink.status === 'active') {
        return NextResponse.json(
          { error: `Student "${student.name_en}" is already linked to Guardian "${guardian.full_name}".` },
          { status: 409 }
        );
      }

      const { error: reactivateErr } = await db
        .from('student_guardians')
        .update({
          relationship_type: relationshipType,
          is_primary: isPrimary,
          is_verified: true,
          status: 'active',
          verified_by: context.userId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingLink.id)
        .eq('school_id', context.school.id);

      if (reactivateErr) {
        return NextResponse.json({ error: reactivateErr.message }, { status: 400 });
      }
    } else {
      const { data: link, error: linkErr } = await db
        .from('student_guardians')
        .insert({
          school_id: context.school.id,
          guardian_id: guardianId,
          student_id: studentId,
          relationship_type: relationshipType,
          is_primary: isPrimary,
          is_verified: true,
          status: 'active',
          verified_by: context.userId,
        })
        .select('id')
        .single();

      if (linkErr) {
        return NextResponse.json({ error: linkErr.message }, { status: 400 });
      }
      linkId = link?.id ? String(link.id) : undefined;
    }

    // Ensure the guardian profile is marked active & verified when a school-verified child is linked
    await db
      .from('guardians')
      .update({
        is_verified: true,
        status: 'active',
        access_state: 'ACTIVE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', guardianId)
      .eq('school_id', context.school.id);

    await db.from('audit_logs').insert({
      school_id: context.school.id,
      user_id: context.userId,
      action: 'GUARDIAN_STUDENT_LINKED',
      table_name: 'student_guardians',
      record_id: linkId,
      new_values: {
        guardianId,
        studentId,
        guardianName: guardian.full_name,
        studentName: student.name_en,
        relationshipType,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Linked ${student.name_en} to ${guardian.full_name}.`,
      linkId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Linking failed.' },
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
  if (!hasModulePermission(context.member, 'parents') && !hasModulePermission(context.member, 'students')) {
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = UnlinkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid unlink payload.', issues: parsed.error.issues }, { status: 400 });
    }

    const { guardianId, studentId } = parsed.data;
    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    const { error: delErr } = await db
      .from('student_guardians')
      .delete()
      .eq('school_id', context.school.id)
      .eq('guardian_id', guardianId)
      .eq('student_id', studentId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    await db.from('audit_logs').insert({
      school_id: context.school.id,
      user_id: context.userId,
      action: 'GUARDIAN_STUDENT_UNLINKED',
      table_name: 'student_guardians',
      new_values: { guardianId, studentId },
    });

    return NextResponse.json({ success: true, message: 'Student unlinked from guardian.' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unlinking failed.' },
      { status: 500 }
    );
  }
}
