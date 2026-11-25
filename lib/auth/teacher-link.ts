import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { findAuthUserByEmail } from '@/lib/auth/portal-emails';

async function ensureSchoolNameSynced(
  admin: SupabaseClient,
  schoolId: string
): Promise<void> {
  const { data: schoolRow } = await admin
    .from('schools')
    .select('id, name_en, name, school_name, district, tehsil, city, mobile_number, phone')
    .eq('id', schoolId)
    .maybeSingle();

  if (!schoolRow?.name_en) return;

  const expectedName = String(schoolRow.name_en).trim();
  if (!expectedName) return;

  const schoolUpdates: Record<string, string> = {};
  if (!schoolRow.name) schoolUpdates.name = expectedName;
  if (!schoolRow.school_name) schoolUpdates.school_name = expectedName;
  if (!schoolRow.city && (schoolRow.district || schoolRow.tehsil)) {
    schoolUpdates.city = String(schoolRow.district || schoolRow.tehsil);
  }
  if (!schoolRow.phone && schoolRow.mobile_number) {
    schoolUpdates.phone = String(schoolRow.mobile_number);
  }

  if (Object.keys(schoolUpdates).length > 0) {
    await admin.from('schools').update(schoolUpdates).eq('id', schoolId);
  }

  const { data: profileRow } = await admin
    .from('school_profiles')
    .select('school_id, name, school_name')
    .eq('school_id', schoolId)
    .maybeSingle();

  if (profileRow && (!profileRow.name || !profileRow.school_name)) {
    await admin
      .from('school_profiles')
      .update({
        name: profileRow.name || expectedName,
        school_name: profileRow.school_name || expectedName,
      })
      .eq('school_id', schoolId);
  }
}

/**
 * Ensures a teacher row has a valid Supabase Auth user (`teachers.user_id`)
 * and a matching `public.users` profile so QR scanning, PIN login, and Teacher App
 * session linking never fail with "Teacher login not linked".
 */
export async function ensureTeacherAuthLinked(
  db: SupabaseClient,
  params: { schoolId: string; teacherId: string; password?: string; enableAppAccess?: boolean }
): Promise<string | null> {
  const admin = createSupabaseAdminClient() ?? db;
  const { schoolId, teacherId } = params;

  await ensureSchoolNameSynced(admin, schoolId);

  const { data: teacherRow, error: fetchErr } = await admin
    .from('teachers')
    .select('id, school_id, user_id, employee_code, full_name, mobile_number, email, photo_url')
    .eq('id', teacherId)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (fetchErr || !teacherRow) {
    return null;
  }

  let authUserId: string | null = teacherRow.user_id ? String(teacherRow.user_id) : null;
  let resolvedAuthEmail: string | null = null;

  if (authUserId) {
    const { data: byId } = await admin.auth.admin.getUserById(authUserId);
    if (byId?.user) {
      resolvedAuthEmail = byId.user.email ?? null;
    } else {
      authUserId = null;
    }
  }

  const syntheticEmail = `teacher-${teacherRow.id}@taleemos.local`;

  if (!authUserId) {
    const rawEmail = (teacherRow.email || '').trim().toLowerCase();
    const isRealEmail = Boolean(
      rawEmail &&
        rawEmail.includes('@') &&
        !rawEmail.endsWith('@school.local') &&
        !rawEmail.endsWith('@taleemos.local')
    );

    let candidateEmail = isRealEmail ? rawEmail : syntheticEmail;
    let matchedUser = await findAuthUserByEmail(admin, candidateEmail);

    if (matchedUser) {
      const { data: otherTeacher } = await admin
        .from('teachers')
        .select('id')
        .eq('user_id', matchedUser.id)
        .neq('id', teacherRow.id)
        .limit(1)
        .maybeSingle();

      if (otherTeacher) {
        candidateEmail = syntheticEmail;
        matchedUser = await findAuthUserByEmail(admin, candidateEmail);
      }
    }

    if (matchedUser) {
      authUserId = matchedUser.id;
      resolvedAuthEmail = matchedUser.email ?? candidateEmail;

      const existingMeta = (matchedUser.user_metadata ?? {}) as Record<string, unknown>;
      const existingRoles = Array.isArray(existingMeta.portal_roles)
        ? existingMeta.portal_roles.map((r) => String(r))
        : existingMeta.role
          ? [String(existingMeta.role)]
          : [];
      const portalRoles = Array.from(new Set([...existingRoles, 'teacher']));

      await admin.auth.admin.updateUserById(authUserId, {
        email_confirm: true,
        user_metadata: {
          ...existingMeta,
          role: existingMeta.role === 'school_owner' ? 'school_owner' : 'teacher',
          portal_roles: portalRoles,
          school_id: existingMeta.school_id || schoolId,
          teacher_school_id: schoolId,
          teacher_record_id: teacherRow.id,
          full_name: existingMeta.full_name || teacherRow.full_name || 'Teacher',
        },
      });
    } else {
      const randomPassword = `${crypto.randomBytes(16).toString('hex')}Aa1!`;
      const metadata = {
        role: 'teacher',
        portal_roles: ['teacher'],
        school_id: schoolId,
        teacher_school_id: schoolId,
        teacher_record_id: teacherRow.id,
        full_name: teacherRow.full_name || 'Teacher',
      };

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: candidateEmail,
        password: randomPassword,
        email_confirm: true,
        user_metadata: metadata,
      });

      if (!createErr && created.user) {
        authUserId = created.user.id;
        resolvedAuthEmail = created.user.email ?? candidateEmail;
      } else {
        // Retry lookup or fallback to synthetic email
        const retryExisting = await findAuthUserByEmail(admin, candidateEmail);
        if (retryExisting) {
          authUserId = retryExisting.id;
          resolvedAuthEmail = retryExisting.email ?? candidateEmail;
        } else if (candidateEmail !== syntheticEmail) {
          const { data: synCreated } = await admin.auth.admin.createUser({
            email: syntheticEmail,
            password: randomPassword,
            email_confirm: true,
            user_metadata: metadata,
          });
          if (synCreated?.user) {
            authUserId = synCreated.user.id;
            resolvedAuthEmail = synCreated.user.email ?? syntheticEmail;
          }
        }
      }
    }
  }

  if (!authUserId) {
    return null;
  }

  const { data: existingProfile } = await admin
    .from('users')
    .select('id')
    .eq('id', authUserId)
    .maybeSingle();

  if (!existingProfile) {
    const profileEmail = (
      resolvedAuthEmail ||
      teacherRow.email ||
      syntheticEmail
    )
      .trim()
      .toLowerCase();

    const { error: profileInsertErr } = await admin.from('users').insert({
      id: authUserId,
      email: profileEmail,
      full_name: teacherRow.full_name || 'Teacher',
      phone: teacherRow.mobile_number || null,
      avatar_url: teacherRow.photo_url || null,
      is_super_admin: false,
      preferred_language: 'en',
      account_status: 'active',
    });

    if (profileInsertErr && profileEmail !== syntheticEmail) {
      await admin.from('users').insert({
        id: authUserId,
        email: syntheticEmail,
        full_name: teacherRow.full_name || 'Teacher',
        phone: teacherRow.mobile_number || null,
        avatar_url: teacherRow.photo_url || null,
        is_super_admin: false,
        preferred_language: 'en',
        account_status: 'active',
      });
    }
  }

  if (teacherRow.user_id !== authUserId) {
    const updateData: Record<string, unknown> = {
      user_id: authUserId,
      email_verified: true,
      updated_at: new Date().toISOString(),
    };
    if (params.enableAppAccess) {
      updateData.app_access_enabled = true;
      updateData.app_blocked = false;
    }
    await admin
      .from('teachers')
      .update(updateData)
      .eq('id', teacherRow.id)
      .eq('school_id', schoolId);
  } else if (params.enableAppAccess) {
    await admin
      .from('teachers')
      .update({ app_access_enabled: true, app_blocked: false, updated_at: new Date().toISOString() })
      .eq('id', teacherRow.id)
      .eq('school_id', schoolId);
  }

  if (params.password && authUserId) {
    try {
      await admin.auth.admin.updateUserById(authUserId, {
        password: params.password,
      });
    } catch {
      // Non-fatal
    }
  }

  return authUserId;
}

export async function ensureTeacherAuthLinkedDetailed(
  db: SupabaseClient,
  params: { schoolId: string; teacherId: string; password?: string; enableAppAccess?: boolean }
): Promise<{ userId: string | null; authEmail: string | null }> {
  const admin = createSupabaseAdminClient() ?? db;
  const userId = await ensureTeacherAuthLinked(admin, {
    schoolId: params.schoolId,
    teacherId: params.teacherId,
  });

  let authEmail: string | null = null;
  if (userId) {
    const { data } = await admin.auth.admin.getUserById(userId);
    authEmail = data?.user?.email ?? null;

    if (params.password) {
      try {
        await admin.auth.admin.updateUserById(userId, { password: params.password });
      } catch {
        // Non-fatal
      }
    }

    if (params.enableAppAccess) {
      await admin
        .from('teachers')
        .update({ app_access_enabled: true, app_blocked: false })
        .eq('id', params.teacherId)
        .eq('school_id', params.schoolId);
    }
  }

  return { userId, authEmail };
}

