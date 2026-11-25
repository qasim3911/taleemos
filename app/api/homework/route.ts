import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

const CreateHomeworkSchema = z.object({
  class_id: z.string().uuid('Valid class is required'),
  section_id: z.string().uuid().optional().nullable().or(z.literal('')),
  subject_id: z.string().uuid('Valid subject is required'),
  title: z.string().trim().min(1, 'Homework title is required').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  homework_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid due date is required'),
});

const DeleteHomeworkSchema = z.object({
  id: z.string().uuid('Valid homework id is required'),
});

export async function GET() {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'homework')) {
    return NextResponse.json({ error: 'Insufficient module permissions for Homework.' }, { status: 403 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient());
  if (!db) {
    return NextResponse.json({ error: 'Database client unavailable.' }, { status: 500 });
  }

  const [
    { data: homework, error: hwErr },
    { data: classes, error: clsErr },
    { data: sections, error: secErr },
    { data: subjects, error: subErr },
    { data: classSubjects, error: csErr },
  ] = await Promise.all([
    db
      .from('homework_assignments')
      .select('*')
      .eq('school_id', context.school.id)
      .order('created_at', { ascending: false }),
    db.from('classes').select('id, name').eq('school_id', context.school.id).order('level_order'),
    db.from('sections').select('id, name, class_id').eq('school_id', context.school.id).order('name'),
    db.from('subjects').select('id, name').eq('school_id', context.school.id).order('name'),
    db.from('class_subjects').select('class_id, subject_id').eq('school_id', context.school.id),
  ]);

  const firstError = hwErr || clsErr || secErr || subErr || csErr;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 400 });
  }

  return NextResponse.json({
    homework: homework ?? [],
    classes: classes ?? [],
    sections: sections ?? [],
    subjects: subjects ?? [],
    classSubjects: classSubjects ?? [],
  });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'homework')) {
    return NextResponse.json({ error: 'Insufficient module permissions for Homework.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = CreateHomeworkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid homework payload.', issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient());
    if (!db) {
      return NextResponse.json({ error: 'Database client unavailable.' }, { status: 500 });
    }

    const sectionId = parsed.data.section_id ? parsed.data.section_id : null;

    const [{ data: cls }, { data: sub }, secRes] = await Promise.all([
      db
        .from('classes')
        .select('id')
        .eq('id', parsed.data.class_id)
        .eq('school_id', context.school.id)
        .maybeSingle(),
      db
        .from('subjects')
        .select('id')
        .eq('id', parsed.data.subject_id)
        .eq('school_id', context.school.id)
        .maybeSingle(),
      sectionId
        ? db
            .from('sections')
            .select('id')
            .eq('id', sectionId)
            .eq('class_id', parsed.data.class_id)
            .eq('school_id', context.school.id)
            .maybeSingle()
        : Promise.resolve({ data: { id: 'ok' } }),
    ]);

    if (!cls) {
      return NextResponse.json({ error: 'Selected class does not belong to this school.' }, { status: 404 });
    }
    if (!sub) {
      return NextResponse.json({ error: 'Selected subject does not belong to this school.' }, { status: 404 });
    }
    if (sectionId && !secRes.data) {
      return NextResponse.json({ error: 'Selected section does not belong to this class.' }, { status: 404 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const hwDate = parsed.data.homework_date || today;
    const createdAt = hwDate === today ? new Date().toISOString() : `${hwDate}T08:00:00.000Z`;

    const { data: created, error } = await db
      .from('homework_assignments')
      .insert({
        school_id: context.school.id,
        class_id: parsed.data.class_id,
        section_id: sectionId,
        subject_id: parsed.data.subject_id,
        title: parsed.data.title,
        description: parsed.data.description || null,
        due_date: parsed.data.due_date || hwDate,
        created_at: createdAt,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, homework: created });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to save daily homework.' },
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
  if (!hasModulePermission(context.member, 'homework')) {
    return NextResponse.json({ error: 'Insufficient module permissions for Homework.' }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const queryId = url.searchParams.get('id');
    const body = queryId ? { id: queryId } : await request.json().catch(() => ({}));
    const parsed = DeleteHomeworkSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid homework id.' }, { status: 400 });
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient());
    if (!db) {
      return NextResponse.json({ error: 'Database client unavailable.' }, { status: 500 });
    }

    const { data: deleted, error } = await db
      .from('homework_assignments')
      .delete()
      .eq('id', parsed.data.id)
      .eq('school_id', context.school.id)
      .select('id');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'Homework record not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletedId: parsed.data.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to delete daily homework.' },
      { status: 500 }
    );
  }
}
