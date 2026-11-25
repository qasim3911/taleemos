import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { ensureTeacherAuthLinked } from '@/lib/auth/teacher-link';

const ToggleSchema = z.object({
  targetType: z.enum(['teacher', 'student']),
  targetIds: z.array(z.string().uuid()).min(1),
  action: z.enum(['enable', 'disable', 'block', 'unblock', 'deactivate', 'activate']),
});

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'app_access')) {
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = ToggleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid toggle payload.' }, { status: 400 });
    }

    const { targetType, targetIds, action } = parsed.data;
    const table = targetType === 'teacher' ? 'teachers' : 'students';
    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    let appAccessEnabled = false;
    let appBlocked = false;

    if (action === 'enable' || action === 'activate' || action === 'unblock') {
      appAccessEnabled = true;
      appBlocked = false;
    } else if (action === 'block') {
      appAccessEnabled = false;
      appBlocked = true;
    } else if (action === 'disable' || action === 'deactivate') {
      appAccessEnabled = false;
      appBlocked = false;
    }

    const emailColumn = targetType === 'teacher' ? 'email' : 'student_email';
    const { data: targetRows } = await db
      .from(table)
      .select(`id, ${emailColumn}`)
      .in('id', targetIds)
      .eq('school_id', context.school.id);

    const emailMap = new Map(
      ((targetRows ?? []) as Array<Record<string, unknown>>).map((row) => [
        String(row.id),
        String(row[emailColumn] || 'No email'),
      ])
    );

    const { error } = await db
      .from(table)
      .update({
        app_access_enabled: appAccessEnabled,
        app_blocked: appBlocked,
      })
      .in('id', targetIds)
      .eq('school_id', context.school.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (targetType === 'teacher' && appAccessEnabled) {
      await Promise.all(
        targetIds.map((teacherId) =>
          ensureTeacherAuthLinked(db, {
            schoolId: context.school.id,
            teacherId,
          }).catch(() => null)
        )
      );
    }

    const logActionMap: Record<string, string> = {
      enable: 'enabled',
      disable: 'disabled',
      block: 'blocked',
      unblock: 'unblocked',
      deactivate: 'deactivated',
      activate: 'activated',
    };

    const logs = targetIds.map((id) => ({
      school_id: context.school.id,
      target_type: targetType,
      target_id: id,
      email: emailMap.get(id) || 'No email',
      action: logActionMap[action],
      status: 'Applied',
      performed_by: context.userId,
    }));

    await db.from('app_invitation_logs').insert(logs);

    await db.from('audit_logs').insert({
      school_id: context.school.id,
      user_id: context.userId,
      action: `APP_ACCESS_${action.toUpperCase()}`,
      table_name: table,
      new_values: { count: targetIds.length, targetIds },
    });

    return NextResponse.json({ success: true, updatedCount: targetIds.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to update app access.' },
      { status: 500 }
    );
  }
}
