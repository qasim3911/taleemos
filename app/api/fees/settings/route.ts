import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { getSchoolFeeSettings, normalizeFeeSettings } from '@/lib/fees/auto-challan';

const FeeSettingsSchema = z.object({
  auto_generate_monthly: z.boolean(),
  generate_day: z.coerce.number().int().min(1).max(28),
  due_day: z.coerce.number().int().min(1).max(28),
  grace_days: z.coerce.number().int().min(0).max(30).default(5),
  late_fine_pkr: z.coerce.number().min(0).default(0),
  default_monthly_fee_pkr: z.coerce.number().min(0).default(0),
  auto_reminders: z.boolean().default(true),
  sync_to_student_app: z.boolean().default(true),
});

export async function GET() {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }
  const { context } = authResult;
  if (!hasModulePermission(context.member, 'fees')) {
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const settings = await getSchoolFeeSettings(db, context.school.id);
  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }
  const { context } = authResult;
  if (!hasModulePermission(context.member, 'fees')) {
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = FeeSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid auto-challan settings.' }, { status: 400 });
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    const settings = normalizeFeeSettings(parsed.data);

    const { error } = await db
      .from('school_profiles')
      .upsert(
        {
          school_id: context.school.id,
          name: context.school.name_en,
          school_name: context.school.name_en,
          fee_settings: settings,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'school_id' }
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to save fee settings.' },
      { status: 500 }
    );
  }
}
