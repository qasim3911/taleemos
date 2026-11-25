import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { generateMonthlyChallansForSchool } from '@/lib/fees/auto-challan';

const AutoGenerateSchema = z.object({
  billingMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  force: z.boolean().default(false),
});

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'fees')) {
    return NextResponse.json({ error: 'Insufficient permissions for Fees module.' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = AutoGenerateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid billingMonth format (expected YYYY-MM).' }, { status: 400 });
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    const result = await generateMonthlyChallansForSchool({
      db,
      schoolId: context.school.id,
      billingMonth: parsed.data.billingMonth,
      performedBy: context.userId,
      force: parsed.data.force,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Auto-generation failed.' },
      { status: 500 }
    );
  }
}
