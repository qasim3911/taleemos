import { cookies, headers } from 'next/headers';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { resolveEntitlements } from '@/lib/subscription/entitlements';
import type {
  SchoolContextData,
  SchoolMemberRecord,
  SchoolRecord,
  SchoolSubscriptionRecord,
  SubscriptionPlanRecord,
} from '@/lib/types/database';

export type SchoolAuthResult =
  | { status: 'unconfigured' }
  | { status: 'unauthenticated' }
  | { status: 'no_school' }
  | { status: 'not_approved'; school: SchoolRecord }
  | { status: 'inactive_member'; school: SchoolRecord }
  | { status: 'ok'; context: SchoolContextData };

function mapPermissionCodes(codes: string[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const code of codes) {
    const mod = code.split('.')[0];
    if (mod) map[mod] = true;
    if (code === 'teachers.manage') map.staff = true;
    if (code === 'students.manage' || code === 'students.view') {
      map.admissions = true;
      map.students = true;
    }
    if (code === 'app_access.manage') map.app_access = true;
  }
  return map;
}

async function getRequestedSchoolId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const fromCookie = cookieStore.get('selected_school_id')?.value;
    if (fromCookie) return fromCookie;
  } catch {
    // cookies() available nahi hai to ignore karo
  }
  try {
    const headerStore = await headers();
    const fromHeader =
      headerStore.get('x-school-id') || headerStore.get('x-selected-school-id');
    if (fromHeader) return fromHeader;
  } catch {
    // headers() available nahi hai to ignore karo
  }
  return null;
}

export async function getSchoolContext(): Promise<SchoolAuthResult> {
  if (!isSupabaseConfigured()) {
    return { status: 'unconfigured' };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { status: 'unconfigured' };

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { status: 'unauthenticated' };
  }

  const reader = createSupabaseAdminClient() ?? supabase;

  // --- FIX START: Pehle Selected School ko priority do ---
  const requestedSchoolId = await getRequestedSchoolId();
  let requestedSchoolRow: Record<string, unknown> | null = null;
  let requestedSchoolAllowed = false;

  if (requestedSchoolId) {
    const { data: schoolRow } = await reader
      .from('schools')
      .select('*')
      .eq('id', requestedSchoolId)
      .maybeSingle();

    if (schoolRow) {
      const isOwnerOfRequested = (schoolRow as Record<string, unknown>).owner_user_id === user.id;
      let isMemberOfRequested = false;

      if (!isOwnerOfRequested) {
        const [{ data: memCheck }, { data: legacyCheck }] = await Promise.all([
          reader
            .from('school_memberships')
            .select('id')
            .eq('user_id', user.id)
            .eq('school_id', requestedSchoolId)
            .eq('status', 'active')
            .maybeSingle(),
          reader
            .from('school_members')
            .select('id')
            .eq('user_id', user.id)
            .eq('school_id', requestedSchoolId)
            .eq('is_active', true)
            .maybeSingle(),
        ]);
        isMemberOfRequested = Boolean(memCheck || legacyCheck);
      }

      if (isOwnerOfRequested || isMemberOfRequested) {
        requestedSchoolRow = schoolRow as Record<string, unknown>;
        requestedSchoolAllowed = true;
      }
    }
  }
  // --- FIX END ---

  // 1. First check if user is the direct owner of a school
  const { data: ownedSchool } = await reader
    .from('schools')
    .select('*')
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 2. Fetch active membership, legacy member, and user profile
  const [{ data: membership }, { data: legacyMember }, { data: userProfile }] = await Promise.all([
    reader
      .from('school_memberships')
      .select('id, school_id, user_id, role_id, member_type, status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    reader
      .from('school_members')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    reader
      .from('users')
      .select('id, full_name, email')
      .eq('id', user.id)
      .maybeSingle(),
  ]);

  let rawSchool: Record<string, unknown> | null = null;

  // FIX: Agar user ne koi School select kiya hai aur wo uska hai, to WAHI school use karo.
  // Warna purana tareeka use karo.
  if (requestedSchoolAllowed && requestedSchoolRow) {
    rawSchool = requestedSchoolRow;
  } else if (ownedSchool) {
    // Agar requested school nahi mila aur user owner hai, to purana behaviour
    // Lekin agar requested school tha aur wo allowed nahi tha, to usko ignore karke owned use karna safe nahi hota.
    // Is liye: agar requestedSchoolId tha lekin allowed nahi tha, to yahan owned ko use karna hi fallback hai.
    rawSchool = ownedSchool as Record<string, unknown>;
  } else {
    const targetSchoolId = membership?.school_id ?? legacyMember?.school_id ?? null;
    if (targetSchoolId) {
      const { data: schoolRow } = await reader
        .from('schools')
        .select('*')
        .eq('id', targetSchoolId)
        .maybeSingle();
      rawSchool = (schoolRow as Record<string, unknown> | null) ?? null;
    }
  }

  // FIX: Agar requested school use ho raha hai, to membership / legacyMember ko bhi usi school ka lo
  // Taake School A ke member ka record School B me na ghus jaye
  let effectiveMembership = membership;
  let effectiveLegacyMember = legacyMember;

  if (requestedSchoolAllowed && requestedSchoolRow) {
    const reqId = String(requestedSchoolRow.id);
    if (membership && membership.school_id !== reqId) {
      const { data: correctMembership } = await reader
        .from('school_memberships')
        .select('id, school_id, user_id, role_id, member_type, status')
        .eq('user_id', user.id)
        .eq('school_id', reqId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      effectiveMembership = correctMembership as typeof membership;
    }
    if (legacyMember && legacyMember.school_id !== reqId) {
      const { data: correctLegacy } = await reader
        .from('school_members')
        .select('*')
        .eq('user_id', user.id)
        .eq('school_id', reqId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      effectiveLegacyMember = correctLegacy as typeof legacyMember;
    }
  }

  if (!rawSchool) {
    return { status: 'no_school' };
  }

  const schoolId = String(rawSchool.id);

  // Multi-Tenant Isolation Enforcement: User must be owner or active member of this exact school
  const isOwner = rawSchool.owner_user_id === user.id;
  const isMember = (effectiveMembership && effectiveMembership.school_id === schoolId) || (effectiveLegacyMember && effectiveLegacyMember.school_id === schoolId);
  if (!isOwner && !isMember) {
    return { status: 'no_school' };
  }

  const { data: applicationRow } = await reader
    .from('school_applications')
    .select('id, status, reviewer_notes')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const school: SchoolRecord = {
    ...(rawSchool as unknown as SchoolRecord),
    city: String(rawSchool.district || rawSchool.tehsil || ''),
    phone: String(rawSchool.mobile_number || ''),
    board_type: String(rawSchool.bise_peira_number || rawSchool.school_type || 'Private'),
    tracking_number: String(
      rawSchool.school_code || applicationRow?.id || rawSchool.registration_number || rawSchool.id
    ),
    status_reason: (applicationRow?.reviewer_notes as string | null) ?? null,
  };

  const rawSchoolStatus = String(school.status || '').toLowerCase();
  const rawAppStatus = String(school.application_status || '').toLowerCase();
  const rawReviewStatus = String(applicationRow?.status || '').toLowerCase();
  const blockedStatuses = ['suspended', 'rejected', 'on hold', 'on_hold'];

  const isBlocked =
    blockedStatuses.includes(rawSchoolStatus) || blockedStatuses.includes(rawAppStatus);
  const isApproved =
    !isBlocked &&
    (['approved', 'active'].includes(rawSchoolStatus) ||
      ['approved', 'active'].includes(rawAppStatus) ||
      ['approved', 'active'].includes(rawReviewStatus));

  if (!isApproved) {
    return { status: 'not_approved', school };
  }

  if (effectiveMembership && effectiveMembership.school_id === school.id && String(effectiveMembership.status).toLowerCase() !== 'active') {
    return { status: 'inactive_member', school };
  }
  if (effectiveLegacyMember && effectiveLegacyMember.school_id === school.id && effectiveLegacyMember.is_active === false) {
    return { status: 'inactive_member', school };
  }

  let resolvedMember: SchoolMemberRecord;

  // Strict tenant scoping on resolvedMember: only use records belonging to this school
  const schoolLegacyMember = effectiveLegacyMember && effectiveLegacyMember.school_id === school.id ? effectiveLegacyMember : null;
  const schoolMembership = effectiveMembership && effectiveMembership.school_id === school.id ? effectiveMembership : null;

  if (schoolLegacyMember) {
    const legacyObj = schoolLegacyMember as SchoolMemberRecord;
    const isSchoolOwner = school.owner_user_id === user.id || legacyObj.role_name === 'School Owner' || legacyObj.role_name === 'Owner';
    resolvedMember = {
      ...legacyObj,
      school_id: school.id,
      role_name: isSchoolOwner ? 'School Owner' : legacyObj.role_name,
      permissions: isSchoolOwner ? { '*': true } : legacyObj.permissions,
    };
  } else if (schoolMembership) {
    const [{ data: roleRow }, { data: rolePerms }] = await Promise.all([
      reader.from('roles').select('id, name, slug').eq('id', schoolMembership.role_id).maybeSingle(),
      reader.from('role_permissions').select('permission_code').eq('role_id', schoolMembership.role_id),
    ]);

    const isMemberOwner =
      String(schoolMembership.member_type || '').toLowerCase() === 'owner' ||
      String(roleRow?.slug || '').toLowerCase() === 'owner' ||
      school.owner_user_id === user.id;

    const permCodes = (rolePerms ?? []).map((p: { permission_code: string }) => p.permission_code);

    resolvedMember = {
      id: schoolMembership.id,
      school_id: school.id,
      user_id: user.id,
      role_name: isMemberOwner ? 'School Owner' : roleRow?.name || 'Staff',
      full_name:
        userProfile?.full_name ||
        (user.user_metadata?.full_name as string | undefined) ||
        school.owner_name ||
        school.email,
      email: userProfile?.email || user.email || school.email,
      permissions: isMemberOwner ? { '*': true } : mapPermissionCodes(permCodes),
      is_active: true,
    };
  } else {
    resolvedMember = {
      id: user.id,
      school_id: school.id,
      user_id: user.id,
      role_name: 'School Owner',
      full_name:
        userProfile?.full_name ||
        (user.user_metadata?.full_name as string | undefined) ||
        school.owner_name ||
        school.email,
      email: userProfile?.email || user.email || school.email,
      permissions: { '*': true },
      is_active: true,
    };
  }

  const [{ data: liveSub }, { data: legacySub }, { count: studentCount }, { count: teacherCount }] =
    await Promise.all([
      reader
        .from('subscriptions')
        .select('*')
        .eq('school_id', school.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      reader
        .from('school_subscriptions')
        .select('*')
        .eq('school_id', school.id)
        .maybeSingle(),
      reader
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', school.id)
        .not('status', 'in', '("Archived","archived","withdrawn","transferred")'),
      reader
        .from('teachers')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', school.id)
        .not('status', 'in', '("Archived","archived","resigned","inactive","Inactive")'),
    ]);

  const baseSub = (liveSub || legacySub) as SchoolSubscriptionRecord | null;
  let planRow: SubscriptionPlanRecord | null = null;
  if (baseSub?.plan_id) {
    const { data: fetchedPlan } = await reader
      .from('subscription_plans')
      .select('*')
      .eq('id', baseSub.plan_id)
      .maybeSingle();
    planRow = (fetchedPlan as SubscriptionPlanRecord | null) ?? null;
  }

  const subscription = baseSub
    ? ({ ...baseSub, plan: planRow } as SchoolSubscriptionRecord & {
        plan?: SubscriptionPlanRecord | null;
      })
    : null;

  const entitlements = resolveEntitlements(subscription, {
    students: studentCount ?? 0,
    teachers: teacherCount ?? 0,
    storageMb: 0,
  });

  return {
    status: 'ok',
    context: {
      configured: true,
      userId: user.id,
      userEmail: user.email || '',
      school,
      member: resolvedMember,
      subscription,
      entitlements,
    },
  };
}

export function hasModulePermission(member: SchoolMemberRecord, permissionKey: string): boolean {
  if (member.role_name === 'School Owner' || member.role_name === 'Owner' || member.permissions?.['*']) {
    return true;
  }
  return Boolean(member.permissions?.[permissionKey]);
}