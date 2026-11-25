import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isSupabaseAdminConfigured } from '@/lib/supabase/config';

const ConfirmSchema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ confirmed: false }, { status: 503 });
  }

  try {
    const body = await request.json();
    const parsed = ConfirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ confirmed: false, error: 'Invalid email.' }, { status: 400 });
    }

    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const admin = createSupabaseAdminClient()!;

    let authUser:
      | {
          id: string;
          email?: string;
          email_confirmed_at?: string | null;
          user_metadata?: Record<string, unknown>;
        }
      | undefined;

    for (let page = 1; page <= 10; page++) {
      const { data: userList } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      const batch = userList?.users ?? [];
      authUser = batch.find((u) => u.email?.toLowerCase() === normalizedEmail);
      if (authUser || batch.length < 1000) break;
    }

    if (!authUser) {
      return NextResponse.json({ confirmed: false }, { status: 404 });
    }

    if (authUser.email_confirmed_at) {
      return NextResponse.json({ confirmed: true });
    }

    // Verify this user is legitimately registered in the platform (school, application, membership, teacher, student, or profile)
    const [
      { data: ownedSchool },
      { data: emailSchool },
      { data: appRow },
      { data: membership },
      { data: teacherRow },
      { data: studentRow },
      { data: profileRow },
    ] = await Promise.all([
      admin
        .from('schools')
        .select('id')
        .eq('owner_user_id', authUser.id)
        .limit(1)
        .maybeSingle(),
      admin
        .from('schools')
        .select('id')
        .ilike('email', normalizedEmail)
        .limit(1)
        .maybeSingle(),
      admin
        .from('school_applications')
        .select('id')
        .eq('applicant_user_id', authUser.id)
        .limit(1)
        .maybeSingle(),
      admin
        .from('school_memberships')
        .select('id')
        .eq('user_id', authUser.id)
        .limit(1)
        .maybeSingle(),
      admin
        .from('teachers')
        .select('id')
        .or(`user_id.eq.${authUser.id},email.ilike.${normalizedEmail}`)
        .limit(1)
        .maybeSingle(),
      admin
        .from('students')
        .select('id')
        .or(`user_id.eq.${authUser.id},student_email.ilike.${normalizedEmail}`)
        .limit(1)
        .maybeSingle(),
      admin
        .from('users')
        .select('id')
        .or(`id.eq.${authUser.id},email.ilike.${normalizedEmail}`)
        .limit(1)
        .maybeSingle(),
    ]);

    if (
      !ownedSchool &&
      !emailSchool &&
      !appRow &&
      !membership &&
      !teacherRow &&
      !studentRow &&
      !profileRow
    ) {
      return NextResponse.json({ confirmed: false }, { status: 403 });
    }

    const { error: confirmErr } = await admin.auth.admin.updateUserById(authUser.id, {
      email_confirm: true,
    });

    if (confirmErr) {
      return NextResponse.json(
        { confirmed: false, error: confirmErr.message },
        { status: 400 }
      );
    }

    // Ensure public.users profile row exists as well
    const { data: existingProfile } = await admin
      .from('users')
      .select('id')
      .eq('id', authUser.id)
      .maybeSingle();

    if (!existingProfile) {
      await admin.from('users').insert({
        id: authUser.id,
        email: normalizedEmail,
        full_name:
          (authUser.user_metadata?.full_name as string | undefined) ||
          normalizedEmail.split('@')[0],
        is_super_admin: false,
        preferred_language: 'en',
        account_status: 'active',
      });
    }

    return NextResponse.json({ confirmed: true });
  } catch (err) {
    return NextResponse.json(
      {
        confirmed: false,
        error: err instanceof Error ? err.message : 'Unable to verify school account.',
      },
      { status: 500 }
    );
  }
}
