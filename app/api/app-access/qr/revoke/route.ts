import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { revokeActiveQRToken, type ActivationRole } from '@/lib/qr/token-service';

const RevokeQRSchema = z.object({
  targetType: z.enum(['teacher', 'student', 'guardian']),
  targetId: z.string().uuid(),
  reason: z.string().optional(),
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
    const parsed = RevokeQRSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid revoke request.' }, { status: 400 });
    }

    const { targetType, targetId } = parsed.data;
    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    await revokeActiveQRToken(db, {
      schoolId: context.school.id,
      targetType: targetType as ActivationRole,
      targetId,
    });

    if (targetType === 'guardian') {
      await db
        .from('guardians')
        .update({
          status: 'active',
          app_access_enabled: false,
          app_account_status: 'deactivated',
        })
        .eq('id', targetId)
        .eq('school_id', context.school.id);
    } else {
      const table = targetType === 'teacher' ? 'teachers' : 'students';
      await db
        .from(table)
        .update({
          app_access_enabled: false,
        })
        .eq('id', targetId)
        .eq('school_id', context.school.id);
    }

    return NextResponse.json({ success: true, message: 'QR token revoked.' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to revoke QR.' },
      { status: 500 }
    );
  }
}
