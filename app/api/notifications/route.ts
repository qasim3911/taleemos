import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

const VALID_CATEGORIES = [
  'attendance',
  'fees',
  'homework',
  'results',
  'timetable',
  'online_classes',
  'announcements',
  'subscription',
] as const;

const CATEGORY_ALIASES: Record<string, (typeof VALID_CATEGORIES)[number]> = {
  attendance: 'attendance',
  'attendance alert': 'attendance',
  fees: 'fees',
  'fee reminder': 'fees',
  homework: 'homework',
  'homework notification': 'homework',
  results: 'results',
  exam: 'results',
  'exam notification': 'results',
  timetable: 'timetable',
  'timetable update': 'timetable',
  online_classes: 'online_classes',
  'online class': 'online_classes',
  announcements: 'announcements',
  announcement: 'announcements',
  subscription: 'subscription',
};

const CreateNotificationSchema = z.object({
  category: z.string().min(1),
  target_audience: z.enum(['All', 'Teachers', 'Students', 'school_staff', 'all', 'teachers', 'students']).default('Students'),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  recipient_user_id: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// FIX: Mark All ke liye schema update - id optional, mark_all optional
const MarkReadSchema = z.object({
  id: z.string().uuid().optional(),
  mark_all: z.boolean().optional(),
  is_read: z.boolean().default(true),
});

export async function GET(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

  // FIX: Frontend se ?limit=50 aayega, us ko use karo. Max 100 se zyada nahi.
  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get('limit') || '50', 10);
  const limit = Number.isNaN(limitParam) ? 50 : Math.min(Math.max(limitParam, 1), 100);

  const { data, error } = await db
    .from('notifications')
    .select('*')
    .eq('school_id', context.school.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ notifications: data ?? [] });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'communication')) {
    return NextResponse.json({ error: 'Insufficient permissions for Notifications.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = CreateNotificationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Please fill in a valid title, message, and category.' }, { status: 400 });
    }

    const mappedCategory =
      CATEGORY_ALIASES[parsed.data.category.trim().toLowerCase()] ??
      (VALID_CATEGORIES.includes(parsed.data.category as (typeof VALID_CATEGORIES)[number])
        ? (parsed.data.category as (typeof VALID_CATEGORIES)[number])
        : 'announcements');

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    let recipientUserId = parsed.data.recipient_user_id ?? null;
    if (recipientUserId) {
      const { data: userExists } = await db
        .from('users')
        .select('id')
        .eq('id', recipientUserId)
        .maybeSingle();
      if (!userExists) {
        recipientUserId = null;
      }
    }

    const { data, error } = await db
      .from('notifications')
      .insert({
        school_id: context.school.id,
        recipient_user_id: recipientUserId,
        target_audience: parsed.data.target_audience,
        category: mappedCategory,
        title: parsed.data.title,
        body: parsed.data.body,
        metadata: parsed.data.metadata ?? {},
        is_read: false,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, notification: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to send notification.' },
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
  try {
    const body = await request.json();
    const parsed = MarkReadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid notification ID.' }, { status: 400 });
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    // NEW: Mark All Read - saare unread ko ek hi query me Read kar do
    if (parsed.data.mark_all) {
      const { error } = await db
        .from('notifications')
        .update({ is_read: parsed.data.is_read })
        .eq('school_id', context.school.id)
        .eq('is_read', false);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, marked_all: true });
    }

    // OLD: Single Mark Read
    if (!parsed.data.id) {
      return NextResponse.json({ error: 'Invalid notification ID.' }, { status: 400 });
    }

    const { error } = await db
      .from('notifications')
      .update({ is_read: parsed.data.is_read })
      .eq('id', parsed.data.id)
      .eq('school_id', context.school.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to update notification.' },
      { status: 500 }
    );
  }
}