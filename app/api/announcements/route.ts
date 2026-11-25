import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

const CreateAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4000),
  audience: z.enum(['All', 'Teachers', 'Students']).default('All'),
});

export async function GET() {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const { data, error } = await db
    .from('announcements')
    .select('*')
    .eq('school_id', context.school.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ announcements: data ?? [] });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'communication')) {
    return NextResponse.json({ error: 'Insufficient permissions for Announcements.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = CreateAnnouncementSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Valid title, message, and audience are required.' }, { status: 400 });
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    const { data: announcement, error } = await db
      .from('announcements')
      .insert({
        school_id: context.school.id,
        title: parsed.data.title,
        message: parsed.data.message,
        audience: parsed.data.audience,
        created_by: context.userId,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await db.from('notifications').insert({
      school_id: context.school.id,
      target_audience: parsed.data.audience,
      category: 'announcements',
      title: parsed.data.title,
      body: parsed.data.message,
      metadata: { announcement_id: announcement.id },
      is_read: false,
    });

    return NextResponse.json({ success: true, announcement });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to publish announcement.' },
      { status: 500 }
    );
  }
}
