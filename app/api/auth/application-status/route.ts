import { NextResponse } from 'next/server';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  under_review: 'Under Review',
  approved: 'Approved',
  active: 'Approved',
  rejected: 'Rejected',
  on_hold: 'On Hold',
  suspended: 'Suspended',
};

function isUuid(val: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase is not connected yet.' },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const tracking = searchParams.get('tracking')?.trim();

  const reader = createSupabaseAdminClient() ?? (await createSupabaseServerClient());
  if (!reader) {
    return NextResponse.json({ error: 'Database client unavailable.' }, { status: 503 });
  }

  let school: Record<string, unknown> | null = null;
  let appRow: Record<string, unknown> | null = null;

  if (tracking) {
    if (isUuid(tracking)) {
      const { data: appMatch } = await reader
        .from('school_applications')
        .select('*')
        .eq('id', tracking)
        .maybeSingle();

      if (appMatch) {
        appRow = appMatch as Record<string, unknown>;
        const { data: sMatch } = await reader
          .from('schools')
          .select('*')
          .eq('id', String(appMatch.school_id))
          .maybeSingle();
        school = (sMatch as Record<string, unknown> | null) ?? null;
      } else {
        const { data: sMatch } = await reader
          .from('schools')
          .select('*')
          .eq('id', tracking)
          .maybeSingle();
        school = (sMatch as Record<string, unknown> | null) ?? null;
      }
    }

    if (!school) {
      const { data: byReg } = await reader
        .from('schools')
        .select('*')
        .or(`school_code.ilike.${tracking},registration_number.ilike.${tracking},email.ilike.${tracking},tracking_number.ilike.${tracking}`)
        .limit(1)
        .maybeSingle();
      school = (byReg as Record<string, unknown> | null) ?? null;
    }

    if (!school) {
      return NextResponse.json(
        { error: 'No application found with that tracking ID, registration number, or school email.' },
        { status: 404 }
      );
    }
  } else {
    const serverClient = await createSupabaseServerClient();
    const {
      data: { user },
    } = (await serverClient?.auth.getUser()) ?? { data: { user: null } };

    if (!user) {
      return NextResponse.json(
        { error: 'Provide an Application Tracking ID, Registration No, or School Email.' },
        { status: 400 }
      );
    }

    const { data: owned } = await reader
      .from('schools')
      .select('*')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    school = (owned as Record<string, unknown> | null) ?? null;
  }

  if (!school) {
    return NextResponse.json({ error: 'No school application linked to this account.' }, { status: 404 });
  }

  if (!appRow) {
    const { data: latestApp } = await reader
      .from('school_applications')
      .select('*')
      .eq('school_id', String(school.id))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    appRow = (latestApp as Record<string, unknown> | null) ?? null;
  }

  const rawStatus = String(school.status || appRow?.status || 'pending').toLowerCase();

  const adminClient = createSupabaseAdminClient();
  if (
    adminClient &&
    (rawStatus === 'approved' || rawStatus === 'active') &&
    typeof school.owner_user_id === 'string' &&
    school.owner_user_id
  ) {
    try {
      const { data: ownerAuth } = await adminClient.auth.admin.getUserById(school.owner_user_id);
      if (ownerAuth?.user && !ownerAuth.user.email_confirmed_at) {
        await adminClient.auth.admin.updateUserById(school.owner_user_id, {
          email_confirm: true,
        });
      }
    } catch {
      // Non-blocking best-effort confirmation
    }
  }

  return NextResponse.json({
    application: {
      id: school.id,
      name_en: school.name_en,
      name_ur: school.name_ur,
      city: school.district || school.tehsil,
      province: school.province,
      board_type: school.bise_peira_number || school.school_type,
      registration_number: school.registration_number,
      tracking_number: String(appRow?.id || school.id),
      application_status: STATUS_LABELS[rawStatus] || rawStatus,
      status_reason: (appRow?.reviewer_notes as string | null) ?? null,
      created_at: school.created_at,
      updated_at: school.updated_at,
    },
  });
}
