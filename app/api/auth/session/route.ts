import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabasePublicConfig, isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export interface AvailablePortalOption {
  role: 'school_admin' | 'teacher' | 'student';
  path: '/dashboard' | '/teacher-portal' | '/student-portal';
  title: string;
  subtitle: string;
  displayName: string;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });
  }

  try {
    const { access_token, refresh_token, preferredPortal } = (await request.json()) as {
      access_token?: string;
      refresh_token?: string;
      preferredPortal?: 'auto' | 'school_admin' | 'teacher' | 'student';
    };

    if (!access_token || !refresh_token) {
      return NextResponse.json({ error: 'Session tokens are required.' }, { status: 400 });
    }

    const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol;
    const isHttps = proto.includes('https');

    const response = NextResponse.json({ ok: true });
    const { url, anonKey } = getSupabasePublicConfig();

    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(
              name,
              value,
              isHttps
                ? { ...options, sameSite: 'none', secure: true, partitioned: true }
                : options
            )
          );
        },
      },
    });

    const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    let redirectTo = '/dashboard';
    let role: 'school_admin' | 'teacher' | 'student' | 'unknown' = 'school_admin';
    let displayName = data.user?.email || 'Portal User';
    let requiresPortalSelection = false;
    const availablePortals: AvailablePortalOption[] = [];

    let resolvedAdminSchoolId: string | null = null;
    if (data.user) {
      const admin = createSupabaseAdminClient();
      const nowIso = new Date().toISOString();
      const normalizedEmail = (data.user.email || '').trim().toLowerCase();

      if (admin) {
        const { data: existingProfile } = await admin
          .from('users')
          .select('id, full_name')
          .eq('id', data.user.id)
          .maybeSingle();

        if (!existingProfile) {
          await admin.from('users').insert({
            id: data.user.id,
            email: normalizedEmail,
            full_name:
              (data.user.user_metadata?.full_name as string | undefined) ||
              normalizedEmail.split('@')[0] ||
              'Portal User',
            is_super_admin: false,
            preferred_language: 'en',
            account_status: 'active',
            last_login_at: nowIso,
          });
        } else {
          await admin
            .from('users')
            .update({ last_login_at: nowIso, updated_at: nowIso })
            .eq('id', data.user.id);
        }

        const [
          { data: m1 },
          { data: m2 },
          { data: owned },
          { data: teacherById },
          { data: studentById },
        ] = await Promise.all([
          admin
            .from('school_memberships')
            .select('id, school_id')
            .eq('user_id', data.user.id)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle(),
          admin
            .from('school_members')
            .select('id, school_id')
            .eq('user_id', data.user.id)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle(),
          admin
            .from('schools')
            .select('id, name_en')
            .eq('owner_user_id', data.user.id)
            .limit(1)
            .maybeSingle(),
          admin
            .from('teachers')
            .select('id, school_id, full_name, employee_code, user_id, app_access_enabled')
            .eq('user_id', data.user.id)
            .limit(1)
            .maybeSingle(),
          admin
            .from('students')
            .select('id, school_id, name_en, admission_number, user_id, app_access_enabled')
            .eq('user_id', data.user.id)
            .limit(1)
            .maybeSingle(),
        ]);

        let resolvedTeacher = teacherById;
        if (!resolvedTeacher && normalizedEmail) {
          const { data: teacherByEmail } = await admin
            .from('teachers')
            .select('id, school_id, full_name, employee_code, user_id, app_access_enabled')
            .ilike('email', normalizedEmail)
            .limit(1)
            .maybeSingle();
          if (
            teacherByEmail &&
            (!teacherByEmail.user_id || teacherByEmail.user_id === data.user.id)
          ) {
            resolvedTeacher = teacherByEmail;
          }
        }

        let resolvedStudent = studentById;
        if (!resolvedStudent && normalizedEmail) {
          const { data: studentByEmail } = await admin
            .from('students')
            .select('id, school_id, name_en, admission_number, user_id, app_access_enabled')
            .ilike('student_email', normalizedEmail)
            .limit(1)
            .maybeSingle();
          if (
            studentByEmail &&
            (!studentByEmail.user_id || studentByEmail.user_id === data.user.id)
          ) {
            resolvedStudent = studentByEmail;
          }
        }

        const adminSchoolId = owned?.id || m1?.school_id || m2?.school_id || null;
        resolvedAdminSchoolId = adminSchoolId ? String(adminSchoolId) : null;
        const schoolLookupIds = Array.from(
          new Set([
            ...(adminSchoolId ? [String(adminSchoolId)] : []),
            ...(resolvedTeacher?.school_id ? [String(resolvedTeacher.school_id)] : []),
            ...(resolvedStudent?.school_id ? [String(resolvedStudent.school_id)] : []),
          ])
        );
        const { data: schoolRows } =
          schoolLookupIds.length > 0
            ? await admin.from('schools').select('id, name_en').in('id', schoolLookupIds)
            : { data: [] };
        const schoolNameMap = new Map(
          (schoolRows ?? []).map((s) => [String(s.id), String(s.name_en || 'School Portal')])
        );

        if (m1 || m2 || owned) {
          const adminName =
            existingProfile?.full_name ||
            (data.user.user_metadata?.full_name as string | undefined) ||
            normalizedEmail;
          const adminSchoolName =
            owned?.name_en ||
            (adminSchoolId ? schoolNameMap.get(String(adminSchoolId)) : undefined) ||
            'School Portal';
          availablePortals.push({
            role: 'school_admin',
            path: '/dashboard',
            title: 'School Admin Portal',
            subtitle: adminSchoolName,
            displayName: adminName,
          });
        }

        if (resolvedTeacher) {
          const teacherSchoolName =
            schoolNameMap.get(String(resolvedTeacher.school_id)) || 'School';
          availablePortals.push({
            role: 'teacher',
            path: '/teacher-portal',
            title: 'Teacher Portal',
            subtitle: `${resolvedTeacher.full_name} (${resolvedTeacher.employee_code}) · ${teacherSchoolName}`,
            displayName: resolvedTeacher.full_name || displayName,
          });
          await admin
            .from('teachers')
            .update({
              last_login_at: nowIso,
              email_verified: true,
              ...(!resolvedTeacher.user_id && resolvedTeacher.app_access_enabled
                ? { user_id: data.user.id }
                : {}),
            })
            .eq('id', resolvedTeacher.id);
        }

        if (resolvedStudent) {
          const studentSchoolName =
            schoolNameMap.get(String(resolvedStudent.school_id)) || 'School';
          availablePortals.push({
            role: 'student',
            path: '/student-portal',
            title: 'Student Portal',
            subtitle: `${resolvedStudent.name_en} (${resolvedStudent.admission_number}) · ${studentSchoolName}`,
            displayName: resolvedStudent.name_en || displayName,
          });
          await admin
            .from('students')
            .update({
              last_login_at: nowIso,
              email_verified: true,
              ...(!resolvedStudent.user_id && resolvedStudent.app_access_enabled
                ? { user_id: data.user.id }
                : {}),
            })
            .eq('id', resolvedStudent.id);
        }

        const requestedPortal =
          preferredPortal && preferredPortal !== 'auto'
            ? availablePortals.find((p) => p.role === preferredPortal)
            : undefined;

        if (requestedPortal) {
          redirectTo = requestedPortal.path;
          role = requestedPortal.role;
          displayName = requestedPortal.displayName;
        } else if (availablePortals.length === 1) {
          redirectTo = availablePortals[0].path;
          role = availablePortals[0].role;
          displayName = availablePortals[0].displayName;
        } else if (availablePortals.length > 1) {
          requiresPortalSelection = true;
          redirectTo = availablePortals[0].path;
          role = availablePortals[0].role;
          displayName = availablePortals[0].displayName;
        } else {
          const metaRole = String(data.user.user_metadata?.role || '').toLowerCase();
          if (metaRole === 'teacher') {
            redirectTo = '/teacher-portal';
            role = 'teacher';
          } else if (metaRole === 'student') {
            redirectTo = '/student-portal';
            role = 'student';
          } else {
            role = 'unknown';
          }
        }
      }
    }

    const finalResponse = NextResponse.json({
      ok: true,
      redirectTo,
      role,
      displayName,
      email: data.user?.email || '',
      requiresPortalSelection,
      availablePortals,
    });
    response.cookies.getAll().forEach((cookie) => {
      finalResponse.cookies.set(cookie);
    });
    if (resolvedAdminSchoolId) {
      finalResponse.cookies.set(
        'selected_school_id',
        resolvedAdminSchoolId,
        isHttps
          ? { path: '/', sameSite: 'none', secure: true, partitioned: true, httpOnly: true }
          : { path: '/', httpOnly: true }
      );
    } else {
      finalResponse.cookies.delete('selected_school_id');
    }
    return finalResponse;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to establish session.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true });
  }

  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol;
  const isHttps = proto.includes('https');
  const response = NextResponse.json({ ok: true });
  const { url, anonKey } = getSupabasePublicConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(
            name,
            value,
            isHttps
              ? { ...options, sameSite: 'none', secure: true, partitioned: true }
              : options
          )
        );
      },
    },
  });

  await supabase.auth.signOut();
  response.cookies.delete('selected_school_id');
  return response;
}
