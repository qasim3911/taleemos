import type { SupabaseClient } from '@supabase/supabase-js';

export type PortalEmailConflict = {
  conflictRole: 'teacher' | 'student' | 'school_admin';
  recordId: string;
  displayName: string;
  code: string;
  email: string;
  schoolName?: string;
  isProvisioned: boolean;
};

export interface PortalEmailInspection {
  /** Hard conflict: another record of the SAME portal role uses this email. */
  sameRoleConflict: PortalEmailConflict | null;
  /** Informational: separate portals (School Admin / Teacher / Student) that also use this email. */
  crossPortalMatches: PortalEmailConflict[];
}

export async function inspectPortalEmail(
  db: SupabaseClient,
  {
    schoolId,
    email,
    targetType,
    targetId,
  }: {
    schoolId: string;
    email: string;
    targetType: 'teacher' | 'student';
    targetId: string;
  }
): Promise<PortalEmailInspection> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.endsWith('@school.local')) {
    return { sameRoleConflict: null, crossPortalMatches: [] };
  }

  const [{ data: teachers }, { data: students }, { data: schools }, { data: members }] =
    await Promise.all([
      db
        .from('teachers')
        .select('id, school_id, employee_code, full_name, email, user_id')
        .ilike('email', normalized),
      db
        .from('students')
        .select('id, school_id, admission_number, name_en, student_email, user_id')
        .ilike('student_email', normalized),
      db
        .from('schools')
        .select('id, name_en, email, owner_user_id')
        .eq('id', schoolId)
        .ilike('email', normalized),
      db
        .from('school_members')
        .select('id, school_id, user_id, full_name, email, role_name')
        .eq('school_id', schoolId)
        .ilike('email', normalized),
    ]);

  const { data: schoolNamesData } = await db
    .from('schools')
    .select('id, name_en')
    .eq('id', schoolId);
  const currentSchoolName = schoolNamesData?.[0]?.name_en ? String(schoolNamesData[0].name_en) : 'School';

  let sameRoleConflict: PortalEmailConflict | null = null;
  const crossPortalMatches: PortalEmailConflict[] = [];

  for (const t of teachers ?? []) {
    if (targetType === 'teacher' && t.id === targetId) continue;
    const isSameSchool = String(t.school_id) === schoolId;
    const item: PortalEmailConflict = {
      conflictRole: 'teacher',
      recordId: String(t.id),
      displayName: isSameSchool ? String(t.full_name || 'Teacher') : 'Existing Teacher Account',
      code: isSameSchool ? String(t.employee_code || '') : '',
      email: String(t.email || normalized),
      schoolName: isSameSchool ? currentSchoolName : 'Another School',
      isProvisioned: Boolean(t.user_id),
    };
    if (targetType === 'teacher') {
      // Same school or provisioned teacher in another school cannot share the same teacher email
      if (!sameRoleConflict && (isSameSchool || t.user_id)) {
        sameRoleConflict = item;
      }
    } else if (isSameSchool) {
      crossPortalMatches.push(item);
    }
  }

  for (const s of students ?? []) {
    if (targetType === 'student' && s.id === targetId) continue;
    const isSameSchool = String(s.school_id) === schoolId;
    const item: PortalEmailConflict = {
      conflictRole: 'student',
      recordId: String(s.id),
      displayName: isSameSchool ? String(s.name_en || 'Student') : 'Existing Student Account',
      code: isSameSchool ? String(s.admission_number || '') : '',
      email: String(s.student_email || normalized),
      schoolName: isSameSchool ? currentSchoolName : 'Another School',
      isProvisioned: Boolean(s.user_id),
    };
    if (targetType === 'student') {
      if (!sameRoleConflict && (isSameSchool || s.user_id)) {
        sameRoleConflict = item;
      }
    } else if (isSameSchool) {
      crossPortalMatches.push(item);
    }
  }

  for (const sc of schools ?? []) {
    crossPortalMatches.push({
      conflictRole: 'school_admin',
      recordId: String(sc.id),
      displayName: String(sc.name_en || 'School Portal'),
      code: 'School Owner',
      email: String(sc.email || normalized),
      schoolName: String(sc.name_en || 'School Portal'),
      isProvisioned: true,
    });
  }

  for (const m of members ?? []) {
    crossPortalMatches.push({
      conflictRole: 'school_admin',
      recordId: String(m.id),
      displayName: String(m.full_name || 'School Admin'),
      code: String(m.role_name || 'Admin'),
      email: String(m.email || normalized),
      schoolName: currentSchoolName || 'School Portal',
      isProvisioned: true,
    });
  }

  return { sameRoleConflict, crossPortalMatches };
}

/**
 * Legacy helper returning only hard same-role conflicts so separate portals
 * (School Admin, Teacher App, Student App) can share an email when desired.
 */
export async function findPortalEmailConflict(
  db: SupabaseClient,
  params: {
    schoolId: string;
    email: string;
    targetType: 'teacher' | 'student';
    targetId: string;
  }
): Promise<PortalEmailConflict | null> {
  const { sameRoleConflict } = await inspectPortalEmail(db, params);
  return sameRoleConflict;
}

export async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string
) {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data: userList } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const batch = userList?.users ?? [];
    const found = batch.find((u) => u.email?.toLowerCase() === normalized);
    if (found || batch.length < 1000) return found ?? null;
  }
  return null;
}
