import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isSupabaseAdminConfigured } from '@/lib/supabase/config';
import { generateMonthlyChallansForSchool } from '@/lib/fees/auto-challan';

export async function GET(request: Request) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'Supabase admin credentials not configured.' }, { status: 503 });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized cron request.' }, { status: 401 });
  }
  if (!cronSecret && !isVercelCron) {
    return NextResponse.json(
      { error: 'Set CRON_SECRET or invoke via Vercel Cron.' },
      { status: 401 }
    );
  }

  try {
    const admin = createSupabaseAdminClient()!;
    const { data: schools, error } = await admin
      .from('schools')
      .select('id')
      .in('status', ['active', 'approved']);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const billingMonth = new Date().toISOString().slice(0, 7);
    let totalCreated = 0;
    let totalNotifications = 0;
    let schoolsProcessed = 0;

    for (const s of (schools ?? []) as Array<{ id: string }>) {
      const res = await generateMonthlyChallansForSchool({
        db: admin,
        schoolId: s.id,
        billingMonth,
        force: false,
      });
      schoolsProcessed++;
      totalCreated += res.createdCount;
      totalNotifications += res.notificationsSent;
    }

    return NextResponse.json({
      success: true,
      billingMonth,
      schoolsProcessed,
      totalCreated,
      totalNotifications,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron execution failed.' },
      { status: 500 }
    );
  }
}
