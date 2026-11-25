import { NextRequest, NextResponse } from 'next/server';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'app_access')) {
    return NextResponse.json({ error: 'Insufficient permissions for App Access.' }, { status: 403 });
  }

  const targetType = request.nextUrl.searchParams.get('targetType') || 'student';
  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

  if (targetType === 'teacher') {
    const [
      { data: teacherRows, error: teacherError },
      { data: studentRows },
      { data: deviceRows },
      { data: activeQrRows },
    ] = await Promise.all([
      db
        .from('teachers')
        .select(
          'id, employee_code, full_name, email, mobile_number, user_id, app_access_enabled, app_blocked, email_verified, pin_hash, status, last_login_at, created_at'
        )
        .eq('school_id', context.school.id)
        .order('created_at', { ascending: false }),
      db
        .from('students')
        .select('admission_number, name_en, student_email')
        .eq('school_id', context.school.id),
      db
        .from('app_devices')
        .select('target_id')
        .eq('school_id', context.school.id)
        .eq('target_type', 'teacher'),
      db
        .from('app_qr_tokens')
        .select('target_id')
        .eq('school_id', context.school.id)
        .eq('target_type', 'teacher')
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString()),
    ]);

    if (teacherError) {
      return NextResponse.json({ error: teacherError.message }, { status: 400 });
    }

    const otherEmailMap = new Map<string, string>();
    for (const s of (studentRows ?? []) as Array<{
      admission_number: string;
      name_en: string;
      student_email: string | null;
    }>) {
      const em = (s.student_email || '').trim().toLowerCase();
      if (em && !em.endsWith('@school.local')) {
        otherEmailMap.set(em, `Student ${s.name_en} (${s.admission_number})`);
      }
    }

    const deviceMap = new Map<string, number>();
    for (const d of (deviceRows ?? []) as Array<{ target_id: string }>) {
      deviceMap.set(d.target_id, (deviceMap.get(d.target_id) || 0) + 1);
    }

    const activeQrSet = new Set(
      ((activeQrRows ?? []) as Array<{ target_id: string }>).map((r) => String(r.target_id))
    );

    const rows = (teacherRows ?? []).map((t) => {
      const cleanEmail = (t.email || '').trim().toLowerCase();
      const employmentStatus = String(t.status || 'active').toLowerCase();
      const isInactiveStaff = ['inactive', 'resigned', 'terminated', 'archived', 'withdrawn', 'left_school'].includes(employmentStatus);

      let derivedStatus = 'Registered';
      if (t.app_blocked) {
        derivedStatus = 'Access Suspended';
      } else if (isInactiveStaff) {
        derivedStatus = 'Access Revoked';
      } else if (!t.app_access_enabled) {
        derivedStatus = 'Access Disabled';
      } else if (!t.user_id) {
        derivedStatus = 'Awaiting Activation';
      } else if (t.last_login_at || t.pin_hash) {
        derivedStatus = 'Activated';
      } else if (activeQrSet.has(String(t.id))) {
        derivedStatus = 'QR Generated';
      } else {
        derivedStatus = 'Activated';
      }

      return {
        id: t.id,
        code: t.employee_code,
        name: t.full_name,
        email: t.email,
        phone: t.mobile_number || '',
        user_id: t.user_id,
        app_access_enabled: Boolean(t.app_access_enabled),
        app_blocked: Boolean(t.app_blocked),
        status: derivedStatus,
        last_login_at: t.last_login_at,
        created_at: t.created_at,
        conflictWith: cleanEmail ? otherEmailMap.get(cleanEmail) ?? null : null,
        deviceCount: deviceMap.get(t.id) || 0,
      };
    });

    return NextResponse.json({ rows, classes: [] });
  }

  const [
    { data: studentRows, error: studentError },
    { data: teacherRows },
    { data: classRows },
    { data: sectionRows },
    { data: deviceRows },
  ] = await Promise.all([
    db
      .from('students')
      .select(
        'id, admission_number, name_en, student_email, parent_mobile, class_id, section_id, user_id, app_access_enabled, app_blocked, status, last_login_at, created_at'
      )
      .eq('school_id', context.school.id)
      .order('name_en'),
    db
      .from('teachers')
      .select('employee_code, full_name, email')
      .eq('school_id', context.school.id),
    db
      .from('classes')
      .select('id, name')
      .eq('school_id', context.school.id)
      .order('level_order'),
    db.from('sections').select('id, name').eq('school_id', context.school.id),
    db
      .from('app_devices')
      .select('target_id')
      .eq('school_id', context.school.id)
      .eq('target_type', 'student'),
  ]);

  if (studentError) {
    return NextResponse.json({ error: studentError.message }, { status: 400 });
  }

  const typedClasses = (classRows ?? []) as Array<{ id: string; name: string }>;
  const typedSections = (sectionRows ?? []) as Array<{ id: string; name: string }>;
  const classMap = new Map<string, string>(typedClasses.map((c) => [c.id, c.name]));
  const sectionMap = new Map<string, string>(typedSections.map((s) => [s.id, s.name]));

  const otherEmailMap = new Map<string, string>();
  for (const t of (teacherRows ?? []) as Array<{
    employee_code: string;
    full_name: string;
    email: string | null;
  }>) {
    const em = (t.email || '').trim().toLowerCase();
    if (em && !em.endsWith('@school.local')) {
      otherEmailMap.set(em, `Teacher ${t.full_name} (${t.employee_code})`);
    }
  }

  const deviceMap = new Map<string, number>();
  for (const d of (deviceRows ?? []) as Array<{ target_id: string }>) {
    deviceMap.set(d.target_id, (deviceMap.get(d.target_id) || 0) + 1);
  }

  const rows = (studentRows ?? []).map((s) => {
    const cleanEmail = (s.student_email || '').trim().toLowerCase();
    return {
      id: s.id,
      code: s.admission_number,
      name: s.name_en,
      email: s.student_email,
      phone: s.parent_mobile || '',
      user_id: s.user_id,
      class_id: s.class_id,
      className: s.class_id ? classMap.get(s.class_id) || 'Class' : 'Unassigned',
      sectionName: s.section_id ? sectionMap.get(s.section_id) || '' : '',
      app_access_enabled: Boolean(s.app_access_enabled),
      app_blocked: Boolean(s.app_blocked),
      status: s.status || (s.app_access_enabled ? 'Activated' : 'Registered'),
      last_login_at: s.last_login_at,
      created_at: s.created_at,
      conflictWith: cleanEmail ? otherEmailMap.get(cleanEmail) ?? null : null,
      deviceCount: deviceMap.get(s.id) || 0,
    };
  });

  return NextResponse.json({ rows, classes: typedClasses });
}
