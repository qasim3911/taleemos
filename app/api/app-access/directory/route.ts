import { NextResponse } from 'next/server';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

export interface PortalDirectoryAccount {
  id: string;
  role: 'school_admin' | 'teacher' | 'student' | 'guardian';
  roleLabel: string;
  code: string;
  name: string;
  subtitle: string;
  email: string | null;
  userId: string | null;
  status: string;
  lastLoginAt: string | null;
  hasConflict: boolean;
  conflictWith: string | null;
  sharedPortals: string[];
}

function deriveStatus(row: {
  user_id: string | null;
  app_access_enabled: boolean;
  app_blocked: boolean;
  email_verified?: boolean;
}) {
  if (!row.user_id) return 'not_provisioned';
  if (row.app_blocked) return 'blocked';
  if (row.app_access_enabled) return 'active';
  if (row.email_verified === false) return 'pending_invite';
  return 'deactivated';
}

export async function GET() {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'app_access')) {
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

  const [
    { data: teachers },
    { data: students },
    { data: classes },
    { data: members },
    { data: memberships },
    { data: allSchools },
    { data: logs },
    { data: guardians },
    { data: studentGuardians },
  ] = await Promise.all([
    db
      .from('teachers')
      .select('id, employee_code, full_name, designation, email, user_id, app_access_enabled, app_blocked, email_verified, last_login_at, status')
      .eq('school_id', context.school.id)
      .order('full_name'),
    db
      .from('students')
      .select('id, admission_number, name_en, class_id, student_email, user_id, app_access_enabled, app_blocked, email_verified, last_login_at, status')
      .eq('school_id', context.school.id)
      .order('name_en'),
    db.from('classes').select('id, name').eq('school_id', context.school.id),
    db
      .from('school_members')
      .select('id, user_id, role_name, full_name, email, is_active')
      .eq('school_id', context.school.id),
    db
      .from('school_memberships')
      .select('id, user_id, member_type, status')
      .eq('school_id', context.school.id),
    db
      .from('schools')
      .select('id, name_en, email')
      .eq('id', context.school.id),
    db
      .from('app_invitation_logs')
      .select('*')
      .eq('school_id', context.school.id)
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('guardians')
      .select('id, full_name, father_husband_name, relationship, phone, email, cnic, user_id, app_access_enabled, app_blocked, app_account_status, is_verified, status, last_login_at, pin_hash')
      .eq('school_id', context.school.id)
      .order('full_name'),
    db
      .from('student_guardians')
      .select('student_id, guardian_id')
      .eq('school_id', context.school.id),
  ]);

  const memberUserIds = Array.from(
    new Set([
      ...(members ?? []).map((m) => String(m.user_id)),
      ...(memberships ?? []).map((m) => String(m.user_id)),
      ...(context.school.owner_user_id ? [String(context.school.owner_user_id)] : []),
    ])
  ).filter(Boolean);

  const { data: userRows } =
    memberUserIds.length > 0
      ? await db
          .from('users')
          .select('id, email, full_name, last_login_at')
          .in('id', memberUserIds)
      : { data: [] };

  const userMap = new Map((userRows ?? []).map((u) => [String(u.id), u]));
  const classMap = new Map((classes ?? []).map((c) => [String(c.id), String(c.name)]));

  const teacherEmailUsers = new Map<string, Array<{ id: string; label: string }>>();
  const studentEmailUsers = new Map<string, Array<{ id: string; label: string }>>();
  const schoolEmailMap = new Map<string, string[]>();

  for (const sc of allSchools ?? []) {
    const em = String(sc.email || '').trim().toLowerCase();
    if (em) {
      schoolEmailMap.set(em, [...(schoolEmailMap.get(em) ?? []), `School Portal: ${sc.name_en}`]);
    }
  }
  for (const t of teachers ?? []) {
    const em = String(t.email || '').trim().toLowerCase();
    if (em && !em.endsWith('@school.local')) {
      teacherEmailUsers.set(em, [
        ...(teacherEmailUsers.get(em) ?? []),
        { id: String(t.id), label: `${t.full_name} (${t.employee_code})` },
      ]);
    }
  }
  for (const s of students ?? []) {
    const em = String(s.student_email || '').trim().toLowerCase();
    if (em && !em.endsWith('@school.local')) {
      studentEmailUsers.set(em, [
        ...(studentEmailUsers.get(em) ?? []),
        { id: String(s.id), label: `${s.name_en} (${s.admission_number})` },
      ]);
    }
  }

  const accounts: PortalDirectoryAccount[] = [];
  const seenAdminUsers = new Set<string>();

  if (context.school.owner_user_id) {
    const ownerProfile = userMap.get(String(context.school.owner_user_id));
    seenAdminUsers.add(String(context.school.owner_user_id));
    const ownerEmail = (ownerProfile?.email || context.school.email || '').trim().toLowerCase();
    const sharedPortals = [
      ...(ownerEmail ? (teacherEmailUsers.get(ownerEmail) ?? []).map((t) => `Teacher App: ${t.label}`) : []),
      ...(ownerEmail ? (studentEmailUsers.get(ownerEmail) ?? []).map((s) => `Student App: ${s.label}`) : []),
    ];
    accounts.push({
      id: `owner-${context.school.owner_user_id}`,
      role: 'school_admin',
      roleLabel: 'School Admin',
      code: 'OWNER',
      name: ownerProfile?.full_name || context.school.owner_name || 'School Owner',
      subtitle: 'Full School Portal Access',
      email: ownerProfile?.email || context.school.email || null,
      userId: String(context.school.owner_user_id),
      status: 'active',
      lastLoginAt: (ownerProfile?.last_login_at as string | null) ?? null,
      hasConflict: false,
      conflictWith: null,
      sharedPortals,
    });
  }

  for (const m of members ?? []) {
    const uid = String(m.user_id);
    if (seenAdminUsers.has(uid)) continue;
    seenAdminUsers.add(uid);
    const prof = userMap.get(uid);
    const em = String(m.email || prof?.email || '').trim().toLowerCase();
    accounts.push({
      id: `member-${m.id}`,
      role: 'school_admin',
      roleLabel: 'School Admin',
      code: String(m.role_name || 'STAFF').toUpperCase(),
      name: String(m.full_name || prof?.full_name || 'Staff Member'),
      subtitle: String(m.role_name || 'Admin Staff'),
      email: String(m.email || prof?.email || ''),
      userId: uid,
      status: m.is_active ? 'active' : 'deactivated',
      lastLoginAt: (prof?.last_login_at as string | null) ?? null,
      hasConflict: false,
      conflictWith: null,
      sharedPortals: [
        ...(em ? (teacherEmailUsers.get(em) ?? []).map((t) => `Teacher App: ${t.label}`) : []),
        ...(em ? (studentEmailUsers.get(em) ?? []).map((s) => `Student App: ${s.label}`) : []),
      ],
    });
  }

  for (const ms of memberships ?? []) {
    const uid = String(ms.user_id);
    if (seenAdminUsers.has(uid)) continue;
    seenAdminUsers.add(uid);
    const prof = userMap.get(uid);
    const em = String(prof?.email || '').trim().toLowerCase();
    accounts.push({
      id: `membership-${ms.id}`,
      role: 'school_admin',
      roleLabel: 'School Admin',
      code: String(ms.member_type || 'ADMIN').toUpperCase(),
      name: prof?.full_name || 'School Staff',
      subtitle: String(ms.member_type || 'Admin Staff'),
      email: prof?.email || null,
      userId: uid,
      status: String(ms.status || '').toLowerCase() === 'active' ? 'active' : 'deactivated',
      lastLoginAt: (prof?.last_login_at as string | null) ?? null,
      hasConflict: false,
      conflictWith: null,
      sharedPortals: [
        ...(em ? (teacherEmailUsers.get(em) ?? []).map((t) => `Teacher App: ${t.label}`) : []),
        ...(em ? (studentEmailUsers.get(em) ?? []).map((s) => `Student App: ${s.label}`) : []),
      ],
    });
  }

  for (const t of teachers ?? []) {
    const em = t.email ? String(t.email).trim().toLowerCase() : null;
    const isPlaceholder = Boolean(em && em.endsWith('@school.local'));
    const sameRoleOthers =
      em && !isPlaceholder
        ? (teacherEmailUsers.get(em) ?? []).filter((other) => other.id !== String(t.id))
        : [];
    const sharedPortals =
      em && !isPlaceholder
        ? [
            ...(studentEmailUsers.get(em) ?? []).map((s) => `Student App: ${s.label}`),
            ...(schoolEmailMap.get(em) ?? []),
          ]
        : [];
    const empStatus = String(t.status || 'active').toLowerCase();
    const isLeftSchool = ['inactive', 'resigned', 'terminated', 'archived', 'withdrawn', 'left_school'].includes(empStatus);
    accounts.push({
      id: `teacher-${t.id}`,
      role: 'teacher',
      roleLabel: 'Teacher App',
      code: String(t.employee_code),
      name: String(t.full_name),
      subtitle: String(t.designation || 'Teacher'),
      email: t.email ? String(t.email) : null,
      userId: (t.user_id as string | null) ?? null,
      status: isLeftSchool
        ? 'deactivated'
        : deriveStatus({
            user_id: (t.user_id as string | null) ?? null,
            app_access_enabled: Boolean(t.app_access_enabled),
            app_blocked: Boolean(t.app_blocked),
            email_verified: Boolean(t.email_verified),
          }),
      lastLoginAt: (t.last_login_at as string | null) ?? null,
      hasConflict: sameRoleOthers.length > 0,
      conflictWith: sameRoleOthers.length > 0 ? `Teacher: ${sameRoleOthers.map((o) => o.label).join(', ')}` : null,
      sharedPortals,
    });
  }

  for (const s of students ?? []) {
    const em = s.student_email ? String(s.student_email).trim().toLowerCase() : null;
    const isPlaceholder = Boolean(em && em.endsWith('@school.local'));
    const sameRoleOthers =
      em && !isPlaceholder
        ? (studentEmailUsers.get(em) ?? []).filter((other) => other.id !== String(s.id))
        : [];
    const sharedPortals =
      em && !isPlaceholder
        ? [
            ...(teacherEmailUsers.get(em) ?? []).map((t) => `Teacher App: ${t.label}`),
            ...(schoolEmailMap.get(em) ?? []),
          ]
        : [];
    accounts.push({
      id: `student-${s.id}`,
      role: 'student',
      roleLabel: 'Student App',
      code: String(s.admission_number),
      name: String(s.name_en),
      subtitle: (s.class_id && classMap.get(String(s.class_id))) || 'Student',
      email: s.student_email ? String(s.student_email) : null,
      userId: (s.user_id as string | null) ?? null,
      status: deriveStatus({
        user_id: (s.user_id as string | null) ?? null,
        app_access_enabled: Boolean(s.app_access_enabled),
        app_blocked: Boolean(s.app_blocked),
        email_verified: Boolean(s.email_verified),
      }),
      lastLoginAt: (s.last_login_at as string | null) ?? null,
      hasConflict: sameRoleOthers.length > 0,
      conflictWith: sameRoleOthers.length > 0 ? `Student: ${sameRoleOthers.map((o) => o.label).join(', ')}` : null,
      sharedPortals,
    });
  }

  const studentLookup = new Map((students ?? []).map((s) => [String(s.id), s]));
  const guardianChildrenMap = new Map<string, string[]>();
  for (const sg of studentGuardians ?? []) {
    const stu = studentLookup.get(String(sg.student_id));
    if (stu) {
      const clsName = stu.class_id ? classMap.get(String(stu.class_id)) || 'Class' : '';
      const label = `${stu.name_en} (${clsName || stu.admission_number})`;
      guardianChildrenMap.set(String(sg.guardian_id), [
        ...(guardianChildrenMap.get(String(sg.guardian_id)) ?? []),
        label,
      ]);
    }
  }

  for (const g of guardians ?? []) {
    const children = guardianChildrenMap.get(String(g.id)) ?? [];
    const childrenDesc =
      children.length > 0
        ? `${children.length} Child${children.length > 1 ? 'ren' : ''} (${children.slice(0, 2).join(', ')}${children.length > 2 ? ` +${children.length - 2}` : ''})`
        : 'No linked children';
    const statusVal = g.app_blocked
      ? 'Access Suspended'
      : g.app_account_status === 'active' || Boolean(g.pin_hash) || (g.app_access_enabled && g.last_login_at) || g.status === 'Activated'
      ? 'Activated'
      : g.app_account_status === 'pending_invite' || g.app_access_enabled || g.status === 'QR Generated'
      ? 'QR Generated'
      : g.app_account_status === 'deactivated' || g.status === 'Access Revoked'
      ? 'Access Revoked'
      : 'Registered';

    accounts.push({
      id: `guardian-${g.id}`,
      role: 'guardian',
      roleLabel: 'Guardian App',
      code: String(g.phone || g.cnic || 'GUARDIAN'),
      name: String(g.full_name),
      subtitle: `${g.relationship || 'Guardian'}${g.father_husband_name ? ` • S/O: ${g.father_husband_name}` : ''} • ${childrenDesc}`,
      email: g.email ? String(g.email) : (g.phone ? `Phone: ${g.phone}` : null),
      userId: (g.user_id as string | null) ?? null,
      status: statusVal,
      lastLoginAt: (g.last_login_at as string | null) ?? null,
      hasConflict: false,
      conflictWith: null,
      sharedPortals: children.map((c) => `Linked Child: ${c}`),
    });
  }

  const conflicts = accounts.filter((a) => a.hasConflict);

  return NextResponse.json({
    accounts,
    conflictsCount: conflicts.length,
    logs: logs ?? [],
  });
}
