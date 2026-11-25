import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { findAuthUserByEmail, inspectPortalEmail } from '@/lib/auth/portal-emails';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getSupabasePublicConfig, isSupabaseAdminConfigured } from '@/lib/supabase/config';

const ProvisionSchema = z.object({
  targetType: z.enum(['teacher', 'student']),
  targetId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(8).optional(),
  enableImmediately: z.boolean().default(true),
  mode: z
    .enum(['invite', 'resend', 'password_reset', 'direct_password', 'link_existing'])
    .default('invite'),
});

function resolveRedirectOrigin(request: Request): string {
  const originHeader = request.headers.get('origin');
  if (originHeader) return originHeader.replace(/\/$/, '');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host') || 'localhost:3000';
  return `${proto.split(',')[0].trim()}://${host}`;
}

export async function POST(request: Request) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is required for secure mobile app account provisioning.' },
      { status: 503 }
    );
  }

  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'app_access')) {
    return NextResponse.json({ error: 'Insufficient permissions for App Access management.' }, { status: 403 });
  }

  if (context.entitlements.isRestricted) {
    return NextResponse.json(
      { error: context.entitlements.restrictionReason || 'Subscription restricted.' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const parsed = ProvisionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ||
            'Invalid provisioning request. Password must be at least 8 characters when set directly.',
        },
        { status: 400 }
      );
    }

    const { targetType, targetId, password, enableImmediately, mode } = parsed.data;
    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const admin = createSupabaseAdminClient()!;
    const table = targetType === 'teacher' ? 'teachers' : 'students';
    const roleLabel = targetType === 'teacher' ? 'teacher' : 'student';
    const redirectTo = `${resolveRedirectOrigin(request)}/reset-password`;

    if (mode === 'direct_password' && (!password || password.length < 8)) {
      return NextResponse.json(
        { error: 'Please enter a password of at least 8 characters.' },
        { status: 400 }
      );
    }

    let displayName = targetType === 'teacher' ? 'Teacher' : 'Student';
    let displayPhone: string | null = null;
    let displayAvatarUrl: string | null = null;
    let currentTargetUserId: string | null = null;

    if (targetType === 'teacher') {
      const { data: teacherRow, error: lookupError } = await admin
        .from('teachers')
        .select('id, school_id, user_id, full_name, mobile_number, photo_url')
        .eq('id', targetId)
        .eq('school_id', context.school.id)
        .maybeSingle();

      if (lookupError || !teacherRow) {
        return NextResponse.json({ error: 'Teacher record not found in your school.' }, { status: 404 });
      }
      displayName = teacherRow.full_name || displayName;
      displayPhone = teacherRow.mobile_number || null;
      displayAvatarUrl = teacherRow.photo_url || null;
      currentTargetUserId = teacherRow.user_id || null;
    } else {
      const { data: studentRow, error: lookupError } = await admin
        .from('students')
        .select('id, school_id, user_id, name_en, parent_mobile, photo_url')
        .eq('id', targetId)
        .eq('school_id', context.school.id)
        .maybeSingle();

      if (lookupError || !studentRow) {
        return NextResponse.json({ error: 'Student record not found in your school.' }, { status: 404 });
      }
      displayName = studentRow.name_en || displayName;
      displayPhone = studentRow.parent_mobile || null;
      displayAvatarUrl = studentRow.photo_url || null;
      currentTargetUserId = studentRow.user_id || null;
    }

    // Block same-role email collisions (two teachers or two students sharing 1 email),
    // while allowing separate portals (School Admin, Teacher App, Student App) to share an email.
    const { sameRoleConflict, crossPortalMatches } = await inspectPortalEmail(admin, {
      schoolId: context.school.id,
      email: normalizedEmail,
      targetType,
      targetId,
    });

    if (sameRoleConflict) {
      const roleName = sameRoleConflict.conflictRole === 'teacher' ? 'Teacher' : 'Student';
      return NextResponse.json(
        {
          error: `Email "${normalizedEmail}" is already assigned to another ${roleName}: ${sameRoleConflict.displayName}${sameRoleConflict.code ? ` (${sameRoleConflict.code})` : ''}. Each ${roleName} must have a distinct email.`,
        },
        { status: 409 }
      );
    }

    const [existingAuthByEmail, existingAuthByIdRes] = await Promise.all([
      findAuthUserByEmail(admin, normalizedEmail),
      currentTargetUserId ? admin.auth.admin.getUserById(currentTargetUserId) : Promise.resolve(null),
    ]);

    const existingAuthById = existingAuthByIdRes?.data?.user ?? null;

    // Check if currentTargetUserId is shared with another portal (School Owner or opposite role)
    let isCurrentUserSharedAcrossPortals = false;
    if (currentTargetUserId) {
      const [{ data: otherOwner }, { data: otherOpposite }] = await Promise.all([
        admin.from('schools').select('id').eq('owner_user_id', currentTargetUserId).limit(1).maybeSingle(),
        admin
          .from(targetType === 'teacher' ? 'students' : 'teachers')
          .select('id')
          .eq('user_id', currentTargetUserId)
          .limit(1)
          .maybeSingle(),
      ]);
      isCurrentUserSharedAcrossPortals = Boolean(otherOwner || otherOpposite);
    }

    const emailChanged =
      Boolean(existingAuthById) &&
      (existingAuthById?.email || '').toLowerCase() !== normalizedEmail;

    if (
      existingAuthByEmail &&
      currentTargetUserId &&
      existingAuthByEmail.id !== currentTargetUserId &&
      !isCurrentUserSharedAcrossPortals
    ) {
      // Check if existingAuthByEmail belongs to another record of the SAME role
      const { data: sameRoleAuthOwner } = await admin
        .from(table)
        .select('id')
        .eq('user_id', existingAuthByEmail.id)
        .neq('id', targetId)
        .maybeSingle();
      if (sameRoleAuthOwner) {
        return NextResponse.json(
          {
            error: `Email "${normalizedEmail}" already belongs to another ${roleLabel} login account. Choose a unique email.`,
          },
          { status: 409 }
        );
      }
    }

    // If changing email of a record whose previous auth user was shared with another portal,
    // switch to the target email's auth user (or create a fresh one) without touching the shared portal's email.
    const existingAuth =
      emailChanged && isCurrentUserSharedAcrossPortals
        ? existingAuthByEmail
        : existingAuthByEmail || existingAuthById;

    if (existingAuth) {
      const { data: sameRoleLinked } = await admin
        .from(table)
        .select(targetType === 'teacher' ? 'id, full_name, employee_code' : 'id, name_en, admission_number')
        .eq('user_id', existingAuth.id)
        .neq('id', targetId)
        .maybeSingle();

      if (sameRoleLinked) {
        const linkedRow = sameRoleLinked as Record<string, string | null>;
        const linkedName = linkedRow.full_name || linkedRow.name_en || roleLabel;
        const linkedCode = linkedRow.employee_code || linkedRow.admission_number || '';
        return NextResponse.json(
          {
            error: `Email "${normalizedEmail}" is already linked to ${roleLabel} ${linkedName}${linkedCode ? ` (${linkedCode})` : ''}. Each ${roleLabel} must use a distinct email.`,
          },
          { status: 409 }
        );
      }
    }

    let authUserId =
      emailChanged && isCurrentUserSharedAcrossPortals
        ? existingAuthByEmail?.id || null
        : existingAuth?.id || currentTargetUserId || null;
    let emailVerified = Boolean(existingAuth?.email_confirmed_at);
    let actionLink: string | null = null;
    let emailSent = false;
    let emailError: string | null = null;

    const existingMeta = (existingAuth?.user_metadata ?? {}) as Record<string, unknown>;
    const existingRoles = Array.isArray(existingMeta.portal_roles)
      ? existingMeta.portal_roles.map((r) => String(r))
      : existingMeta.role
        ? [String(existingMeta.role)]
        : [];
    const portalRoles = Array.from(new Set([...existingRoles, roleLabel]));

    const mergedMetadata = {
      ...existingMeta,
      role: existingMeta.role === 'school_owner' ? 'school_owner' : roleLabel,
      portal_roles: portalRoles,
      school_id: existingMeta.school_id || context.school.id,
      [`${roleLabel}_school_id`]: context.school.id,
      [`${roleLabel}_record_id`]: targetId,
      full_name: existingMeta.full_name || displayName,
      ...(displayAvatarUrl ? { avatar_url: displayAvatarUrl, photo_url: displayAvatarUrl } : {}),
    };

    const sendRecoveryEmail = async () => {
      const { url, anonKey } = getSupabasePublicConfig();
      const publicClient = createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: resetErr } = await publicClient.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo,
      });
      if (!resetErr) {
        emailSent = true;
        return true;
      }
      emailError = resetErr.message;
      return false;
    };

    const generateRecoveryFallbackLink = async () => {
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: normalizedEmail,
        options: { redirectTo },
      });
      if (linkErr) {
        return { error: linkErr.message, link: null };
      }
      return { error: null, link: linkData?.properties?.action_link ?? null };
    };

    if (mode === 'link_existing') {
      if (!existingAuthByEmail) {
        return NextResponse.json(
          {
            error: `No existing login account found for "${normalizedEmail}". Use "Set Password Directly" or "Invite / Setup Link" to create the first login.`,
          },
          { status: 400 }
        );
      }
      authUserId = existingAuthByEmail.id;
      emailVerified = true;
      await admin.auth.admin.updateUserById(authUserId, {
        email_confirm: true,
        user_metadata: mergedMetadata,
      });
    } else if (mode === 'direct_password') {
      if (!authUserId) {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: normalizedEmail,
          password,
          email_confirm: true,
          user_metadata: mergedMetadata,
        });
        if (createErr || !created.user) {
          return NextResponse.json(
            { error: createErr?.message || 'Unable to create auth account.' },
            { status: 400 }
          );
        }
        authUserId = created.user.id;
        emailVerified = true;
      } else {
        const { data: updated, error: updateAuthErr } = await admin.auth.admin.updateUserById(
          authUserId,
          {
            email: normalizedEmail,
            password,
            email_confirm: true,
            user_metadata: mergedMetadata,
          }
        );
        if (updateAuthErr || !updated.user) {
          return NextResponse.json(
            { error: updateAuthErr?.message || 'Unable to update login email & password.' },
            { status: 400 }
          );
        }
        emailVerified = true;
      }
    } else if (mode === 'password_reset') {
      if (!authUserId) {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: normalizedEmail,
          email_confirm: true,
          user_metadata: mergedMetadata,
        });
        if (createErr || !created.user) {
          return NextResponse.json(
            { error: createErr?.message || 'Unable to create auth account.' },
            { status: 400 }
          );
        }
        authUserId = created.user.id;
        emailVerified = Boolean(created.user.email_confirmed_at);
      } else {
        await admin.auth.admin.updateUserById(authUserId, {
          email: normalizedEmail,
          email_confirm: true,
          user_metadata: mergedMetadata,
        });
      }

      const generated = await generateRecoveryFallbackLink();
      if (generated.error) {
        return NextResponse.json({ error: generated.error }, { status: 400 });
      }
      actionLink = generated.link;
    } else if (!authUserId || (existingAuth && !existingAuth.email_confirmed_at)) {
      const { data: inviteRes, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
        normalizedEmail,
        {
          redirectTo,
          data: mergedMetadata,
        }
      );

      if (!inviteErr && inviteRes.user) {
        authUserId = inviteRes.user.id;
        emailVerified = Boolean(inviteRes.user.email_confirmed_at);
        emailSent = true;
      } else {
        emailError = inviteErr?.message || 'Unable to send invite email.';
        if (!authUserId) {
          const { data: created, error: createErr } = await admin.auth.admin.createUser({
            email: normalizedEmail,
            email_confirm: true,
            user_metadata: mergedMetadata,
          });
          if (createErr || !created.user) {
            return NextResponse.json(
              { error: inviteErr?.message || createErr?.message || 'Unable to provision user.' },
              { status: 400 }
            );
          }
          authUserId = created.user.id;
          emailVerified = Boolean(created.user.email_confirmed_at);
        } else {
          await admin.auth.admin.updateUserById(authUserId, {
            email: normalizedEmail,
            email_confirm: true,
            user_metadata: mergedMetadata,
          });
        }

        const recovered = await sendRecoveryEmail();
        if (!recovered) {
          const generated = await generateRecoveryFallbackLink();
          actionLink = generated.link;
        }
      }
    } else {
      // Existing confirmed user: sync changed email / metadata, then send recovery email or link
      await admin.auth.admin.updateUserById(authUserId, {
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: mergedMetadata,
      });

      const sent = await sendRecoveryEmail();
      if (!sent) {
        const generated = await generateRecoveryFallbackLink();
        if (generated.error && !actionLink) {
          return NextResponse.json({ error: emailError || generated.error }, { status: 400 });
        }
        actionLink = generated.link;
      }
    }

    if (!authUserId) {
      return NextResponse.json({ error: 'Unable to resolve auth user ID.' }, { status: 400 });
    }

    const { data: existingPublicUser } = await admin
      .from('users')
      .select('id, email, avatar_url')
      .eq('id', authUserId)
      .maybeSingle();

    if (!existingPublicUser) {
      const { error: userInsertErr } = await admin.from('users').insert({
        id: authUserId,
        email: normalizedEmail,
        full_name: displayName,
        phone: displayPhone,
        avatar_url: displayAvatarUrl,
        is_super_admin: false,
        preferred_language: 'en',
        account_status: 'active',
      });
      if (userInsertErr) {
        return NextResponse.json(
          { error: `Failed to create user profile: ${userInsertErr.message}` },
          { status: 400 }
        );
      }
    } else {
      await admin
        .from('users')
        .update({
          email: normalizedEmail,
          ...(displayAvatarUrl && !existingPublicUser.avatar_url
            ? { avatar_url: displayAvatarUrl }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', authUserId);
    }

    const updatePayload =
      targetType === 'teacher'
        ? {
            email: normalizedEmail,
            user_id: authUserId,
            app_access_enabled: enableImmediately,
            app_blocked: false,
            email_verified: emailVerified,
          }
        : {
            student_email: normalizedEmail,
            user_id: authUserId,
            app_access_enabled: enableImmediately,
            app_blocked: false,
            email_verified: emailVerified,
          };

    const { error: updateErr } = await admin
      .from(table)
      .update(updatePayload)
      .eq('id', targetId)
      .eq('school_id', context.school.id);

    if (updateErr) {
      return NextResponse.json(
        { error: `Account created, but failed to link ${targetType} record: ${updateErr.message}` },
        { status: 400 }
      );
    }

    const logStatus =
      mode === 'link_existing'
        ? 'Active (Linked Existing Login)'
        : mode === 'direct_password'
          ? 'Active (Password Set)'
          : emailSent
            ? 'Sent'
            : mode === 'password_reset'
              ? 'Link Generated'
              : 'Link Generated (SMTP Unavailable)';

    await admin.from('app_invitation_logs').insert({
      school_id: context.school.id,
      target_type: targetType,
      target_id: targetId,
      email: normalizedEmail,
      action:
        mode === 'link_existing'
          ? 'linked_existing'
          : mode === 'direct_password'
            ? 'password_set'
            : mode === 'password_reset'
              ? 'password_reset_sent'
              : mode === 'resend'
                ? 'resent'
                : 'invited',
      status: logStatus,
      performed_by: context.userId,
    });

    await admin.from('audit_logs').insert({
      school_id: context.school.id,
      user_id: context.userId,
      action: `APP_ACCOUNT_${mode.toUpperCase()}`,
      table_name: table,
      record_id: targetId,
      new_values: { email: normalizedEmail, authUserId, enableImmediately, emailSent },
    });

    return NextResponse.json({
      success: true,
      authUserId,
      email: normalizedEmail,
      accountStatus: enableImmediately ? 'active' : 'pending_invite',
      emailSent,
      emailError,
      linkedExisting: mode === 'link_existing',
      directPasswordSet: mode === 'direct_password',
      linkOnly: mode === 'password_reset',
      passwordSetupLink: actionLink,
      crossPortalMatches,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Provisioning failed.' },
      { status: 500 }
    );
  }
}
