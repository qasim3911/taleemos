import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export interface StudentPortalContext {
  userId: string;
  userEmail: string;
  student: {
    id: string;
    school_id: string;
    admission_number: string;
    roll_number: string | null;
    student_id: string | null;
    name_en: string;
    father_name: string | null;
    class_id: string | null;
    section_id: string | null;
    className: string;
    sectionName: string;
    monthly_fee_pkr: number;
    discount_pkr: number;
    student_email: string | null;
    parent_mobile: string | null;
    photo_url: string | null;
    qr_token: string | null;
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
}

export type StudentAuthResult =
  | { status: 'unconfigured' }
  | { status: 'unauthenticated' }
  | { status: 'not_student' }
  | { status: 'access_disabled'; studentName: string; schoolName: string; reason: string }
  | { status: 'ok'; context: StudentPortalContext };

export async function getStudentPortalContext(): Promise<StudentAuthResult> {
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

  let { data: studentRow } = await reader
    .from('students')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!studentRow && user.email) {
    const { data: emailMatch } = await reader
      .from('students')
      .select('*')
      .ilike('student_email', user.email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (emailMatch && !emailMatch.user_id && emailMatch.app_access_enabled) {
      await reader.from('students').update({ user_id: user.id }).eq('id', emailMatch.id);
      studentRow = { ...emailMatch, user_id: user.id };
    } else if (emailMatch && emailMatch.user_id === user.id) {
      studentRow = emailMatch;
    }
  }

  if (!studentRow) {
    return { status: 'not_student' };
  }

  const [{ data: schoolRow }, { data: classRow }, { data: sectionRow }] = await Promise.all([
    reader
      .from('schools')
      .select('id, name_en, address, district, tehsil, mobile_number, logo_url, status')
      .eq('id', studentRow.school_id)
      .maybeSingle(),
    studentRow.class_id
      ? reader.from('classes').select('name').eq('id', studentRow.class_id).maybeSingle()
      : Promise.resolve({ data: null }),
    studentRow.section_id
      ? reader.from('sections').select('name').eq('id', studentRow.section_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const schoolName = schoolRow?.name_en || 'School Portal';

  if (studentRow.app_blocked) {
    return {
      status: 'access_disabled',
      studentName: studentRow.name_en,
      schoolName,
      reason: 'Your Student Portal & App access has been temporarily blocked by the school administration.',
    };
  }

  if (!studentRow.app_access_enabled) {
    return {
      status: 'access_disabled',
      studentName: studentRow.name_en,
      schoolName,
      reason: 'Student Portal & App access is not enabled yet for your account. Please contact your school admin.',
    };
  }

  const rowRecord = studentRow as Record<string, unknown>;

  return {
    status: 'ok',
    context: {
      userId: user.id,
      userEmail: user.email || studentRow.student_email || '',
      student: {
        id: studentRow.id,
        school_id: studentRow.school_id,
        admission_number: studentRow.admission_number,
        roll_number: studentRow.roll_number ?? null,
        student_id: typeof rowRecord.student_id === 'string' ? rowRecord.student_id : null,
        name_en: studentRow.name_en,
        father_name: studentRow.father_name ?? null,
        class_id: studentRow.class_id ?? null,
        section_id: studentRow.section_id ?? null,
        className: classRow?.name || 'Unassigned',
        sectionName: sectionRow?.name || '',
        monthly_fee_pkr: Number(studentRow.monthly_fee_pkr || 0),
        discount_pkr: Number(studentRow.discount_pkr || 0),
        student_email: studentRow.student_email ?? null,
        parent_mobile: studentRow.parent_mobile ?? null,
        photo_url: studentRow.photo_url ?? null,
        qr_token: studentRow.qr_token ?? null,
        app_access_enabled: Boolean(studentRow.app_access_enabled),
        app_blocked: Boolean(studentRow.app_blocked),
        status: studentRow.status || 'active',
      },
      school: {
        id: schoolRow?.id || studentRow.school_id,
        name_en: schoolName,
        address: schoolRow?.address || '',
        city: schoolRow?.district || schoolRow?.tehsil || '',
        phone: schoolRow?.mobile_number || '',
        logo_url: schoolRow?.logo_url ?? null,
      },
    },
  };
}
