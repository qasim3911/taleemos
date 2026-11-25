import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { getSupabasePublicConfig, isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required.').max(128),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters.')
      .max(128, 'New password must be 128 characters or fewer.'),
    confirmPassword: z.string().min(8, 'Please confirm your new password.').max(128),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'New password and confirmation do not match.',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'New password must be different from your current password.',
    path: ['newPassword'],
  });

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Authentication service is not configured.' }, { status: 503 });
  }

  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'settings')) {
    return NextResponse.json({ error: 'Insufficient permissions for School Settings.' }, { status: 403 });
  }

  if (!context.userEmail) {
    return NextResponse.json(
      { error: 'Your account does not have an email address associated with password sign-in.' },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const parsed = ChangePasswordSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message || 'Invalid password details.';
      return NextResponse.json({ error: firstIssue }, { status: 400 });
    }

    const { url, anonKey } = getSupabasePublicConfig();
    const verifierClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: verifyData, error: verifyError } = await verifierClient.auth.signInWithPassword({
      email: context.userEmail,
      password: parsed.data.currentPassword,
    });

    if (verifyError || !verifyData.user || verifyData.user.id !== context.userId) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const serverClient = await createSupabaseServerClient();

    if (admin) {
      const { error: updateErr } = await admin.auth.admin.updateUserById(context.userId, {
        password: parsed.data.newPassword,
      });
      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 400 });
      }
    } else if (serverClient) {
      const { error: updateErr } = await serverClient.auth.updateUser({
        password: parsed.data.newPassword,
      });
      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: 'Authentication client unavailable.' }, { status: 500 });
    }

    if (serverClient) {
      await serverClient.auth
        .signInWithPassword({
          email: context.userEmail,
          password: parsed.data.newPassword,
        })
        .catch(() => null);
    }

    const db = admin ?? serverClient;
    if (db) {
      await db
        .from('audit_logs')
        .insert({
          school_id: context.school.id,
          user_id: context.userId,
          action: 'ACCOUNT_PASSWORD_CHANGED',
          table_name: 'users',
          record_id: context.userId,
          new_values: {
            email: context.userEmail,
            changed_via: 'school_settings',
          },
        })
        .then(() => null, () => null);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to update password.' },
      { status: 500 }
    );
  }
}
