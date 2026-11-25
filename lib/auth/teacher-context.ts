import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export interface TeacherAssignmentSummary {
  id: string;
  class_id: string;
  className: string;
  section_id: string | null;
  sectionName: string;
  subject_id: string | null;
  subjectName: string;
  is_class_incharge: boolean;
}

export interface TeacherPortalContext {
  userId: string;
  userEmail: string;
  hasSchoolAdminAccess: boolean;
  teacher: {
    id: string;
    school_id: string;
    employee_code: string;
    full_name: string;
    designation: string;
    department: string;
    qualification: string | null;
    email: string | null;
    mobile_number: string;
    photo_url: string | null;
    qr_token: string | null;
    salary_pkr: number;
    joining_date: string;
    app_access_enabled: boolean;
    app_blocked: boolean;
    status: string;
  };
  school: {
    id: string;
    name_en: string;
    address: string;
    city: string;
    phone: string;
    logo_url: string | null;
  };
  assignments: TeacherAssignmentSummary[];
}

export type TeacherAuthResult =
  | { status: 'unconfigured' }
  | { status: 'unauthenticated' }
  | { status: 'not_teacher' }
  | { status: 'access_disabled'; teacherName: string; schoolName: string; reason: string }
  | { status: 'ok'; context: TeacherPortalContext };

export async function getTeacherPortalContext(): Promise<TeacherAuthResult> {
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

  let { data: teacherRow } = await reader
    .from('teachers')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!teacherRow && user.email) {
    const { data: emailMatch } = await reader
      .from('teachers')
      .select('*')
      .ilike('email', user.email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (emailMatch) {
      await reader
        .from('teachers')
        .update({ user_id: user.id, app_access_enabled: true })
        .eq('id', emailMatch.id);
      teacherRow = { ...emailMatch, user_id: user.id, app_access_enabled: true };
    }
  }

  // FIX: Auto-Link for QR teachers without Email - synthetic email teacher-<id>@taleemos.local
  if (!teacherRow && user.email && user.email.startsWith('teacher-') && user.email.endsWith('@taleemos.local')) {
    const teacherIdFromEmail = user.email.replace('teacher-', '').replace('@taleemos.local', '');
    if (teacherIdFromEmail) {
      const { data: syntheticMatch } = await reader
        .from('teachers')
        .select('*')
        .eq('id', teacherIdFromEmail)
        .maybeSingle();
      if (syntheticMatch) {
        await reader
          .from('teachers')
          .update({ user_id: user.id, app_access_enabled: true })
          .eq('id', syntheticMatch.id);
        teacherRow = { ...syntheticMatch, user_id: user.id, app_access_enabled: true };
      }
    }
  }

  if (!teacherRow) {
    return { status: 'not_teacher' };
  }

  const [
    { data: schoolRow },
    { data: assignmentRows },
    { data: classRows },
    { data: sectionRows },
    { data: subjectRows },
    { data: membership },
    { data: legacyMember },
  ] = await Promise.all([
    reader
      .from('schools')
      .select('id, owner_user_id, name_en, address, district, tehsil, mobile_number, logo_url, status')
      .eq('id', teacherRow.school_id)
      .maybeSingle(),
    reader
      .from('teacher_assignments')
      .select('id, class_id, section_id, subject_id, is_class_incharge')
      .eq('school_id', teacherRow.school_id)
      .eq('teacher_id', teacherRow.id),
    reader.from('classes').select('id, name').eq('school_id', teacherRow.school_id),
    reader.from('sections').select('id, name').eq('school_id', teacherRow.school_id),
    reader.from('subjects').select('id, name').eq('school_id', teacherRow.school_id),
    reader
      .from('school_memberships')
      .select('id')
      .eq('user_id', user.id)
      .eq('school_id', teacherRow.school_id)
      .limit(1)
      .maybeSingle(),
    reader
      .from('school_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('school_id', teacherRow.school_id)
      .limit(1)
      .maybeSingle(),
  ]);

  const schoolName = schoolRow?.name_en || 'School Portal';

  if (teacherRow.app_blocked) {
    return {
      status: 'access_disabled',
      teacherName: teacherRow.full_name,
      schoolName,
      reason: 'Your Teacher Portal & App access has been temporarily blocked by the school administration.',
    };
  }

  const normalizedStatus = String(teacherRow.status || 'active').toLowerCase();
  if (['inactive', 'resigned', 'terminated', 'archived', 'withdrawn', 'left_school'].includes(normalizedStatus)) {
    return {
      status: 'access_disabled',
      teacherName: teacherRow.full_name,
      schoolName,
      reason: 'Your staff account is inactive / left school. Please contact your school administration.',
    };
  }

  const classMap = new Map((classRows ?? []).map((c) => [c.id as string, String(c.name)]));
  const sectionMap = new Map((sectionRows ?? []).map((s) => [s.id as string, String(s.name)]));
  const subjectMap = new Map((subjectRows ?? []).map((s) => [s.id as string, String(s.name)]));

  const assignments: TeacherAssignmentSummary[] = (assignmentRows ?? []).map((a) => ({
    id: String(a.id),
    class_id: String(a.class_id),
    className: classMap.get(String(a.class_id)) || 'Class',
    section_id: (a.section_id as string | null) ?? null,
    sectionName: a.section_id ? sectionMap.get(String(a.section_id)) || '' : 'All Sections',
    subject_id: (a.subject_id as string | null) ?? null,
    subjectName: a.subject_id ? subjectMap.get(String(a.subject_id)) || '' : 'General / In-charge',
    is_class_incharge: Boolean(a.is_class_incharge),
  }));

  const hasSchoolAdminAccess = Boolean(
    membership || legacyMember || schoolRow?.owner_user_id === user.id
  );

  return {
    status: 'ok',
    context: {
      userId: user.id,
      userEmail: user.email || teacherRow.email || '',
      hasSchoolAdminAccess,
      teacher: {
        id: teacherRow.id,
        school_id: teacherRow.school_id,
        employee_code: teacherRow.employee_code,
        full_name: teacherRow.full_name,
        designation: teacherRow.designation || 'Teacher',
        department: teacherRow.department || 'Academics',
        qualification: teacherRow.qualification ?? null,
        email: teacherRow.email ?? null,
        mobile_number: teacherRow.mobile_number || '',
        photo_url: teacherRow.photo_url ?? null,
        qr_token: teacherRow.qr_token ?? null,
        salary_pkr: Number(teacherRow.salary_pkr || 0),
        joining_date: teacherRow.joining_date || '',
        app_access_enabled: Boolean(teacherRow.app_access_enabled),
        app_blocked: Boolean(teacherRow.app_blocked),
        status: teacherRow.status || 'active',
      },
      school: {
        id: schoolRow?.id || teacherRow.school_id,
        name_en: schoolName,
        address: schoolRow?.address || '',
        city: schoolRow?.district || schoolRow?.tehsil || '',
        phone: schoolRow?.mobile_number || '',
        logo_url: schoolRow?.logo_url ?? null,
      },
      assignments,
    },
  };
}