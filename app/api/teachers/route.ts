import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { canAddTeacher } from '@/lib/subscription/entitlements';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { syncMonthlySalarySlipsForSchool } from '@/lib/payroll/auto-salary';
import {
  generateUniqueTeacherEmployeeCode,
  generateUniqueTeacherQrToken,
} from '@/lib/staff/identifiers';
import { findPortalEmailConflict } from '@/lib/auth/portal-emails';
import { ensureTeacherAuthLinkedDetailed } from '@/lib/auth/teacher-link';
import { createActivationQR } from '@/lib/qr/token-service';
import {
  extractTeacherProfileMeta,
  mergeTeacherProfileDocuments,
} from '@/lib/staff/profile-meta';

function hashTeacherPin(pin: string): string {
  return crypto.createHash('sha256').update(`taleemos_pin_salt_${pin.trim()}`).digest('hex');
}

const TeacherInputSchema = z.object({
  employee_code: z.string().trim().optional().default(''),
  auto_generate_code: z.boolean().optional().default(true),
  name: z.string().min(2),
  father_name: z.string().trim().max(120).optional().or(z.literal('')),
  date_of_birth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('')),
  gender: z.enum(['Male', 'Female', 'Other']).optional().default('Male'),
  cnic: z.string().min(5),
  phone: z.string().min(7),
  email: z.string().email().optional().or(z.literal('')),
  qualification: z.string().optional(),
  experience_years: z.coerce.number().min(0).default(0),
  address: z.string().optional(),
  joining_date: z.string().optional(),
  designation: z.string().min(2),
  department: z.string().min(2),
  base_salary: z.coerce.number().min(0).default(0),
  photo_url: z.string().optional(),
  auto_app_access: z.boolean().optional().default(true),
  app_password: z.string().trim().optional().or(z.literal('')),
  app_pin: z.string().trim().optional().or(z.literal('')),
});

export async function GET(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'staff')) {
    return NextResponse.json({ error: 'Insufficient module permissions.' }, { status: 403 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const url = new URL(request.url);
  const nextEmployeeCode = url.searchParams.get('nextEmployeeCode');

  if (nextEmployeeCode === '1' || nextEmployeeCode === 'true') {
    const employeeCode = await generateUniqueTeacherEmployeeCode(db, context.school.id);
    return NextResponse.json({ employeeCode });
  }

  const { data: teachers, error } = await db
    .from('teachers')
    .select('*')
    .eq('school_id', context.school.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const enrichedTeachers = (teachers ?? []).map((t) => ({
    ...t,
    ...extractTeacherProfileMeta(t),
  }));

  return NextResponse.json({ teachers: enrichedTeachers });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'staff')) {
    return NextResponse.json({ error: 'Insufficient module permissions.' }, { status: 403 });
  }

  const limitCheck = canAddTeacher(context.entitlements);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.reason }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = TeacherInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid staff fields.', issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const cleanPassword = input.app_password?.trim() || '';
    const cleanPin = input.app_pin?.trim() || '';

    if (cleanPassword && cleanPassword.length < 8) {
      return NextResponse.json(
        { error: 'Initial App Password must be at least 8 characters long.' },
        { status: 400 }
      );
    }

    if (cleanPin && !/^\d{4,6}$/.test(cleanPin)) {
      return NextResponse.json(
        { error: 'Initial App PIN must be 4 to 6 numeric digits.' },
        { status: 400 }
      );
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    const normalizedInputEmail = input.email ? input.email.trim().toLowerCase() : '';

    if (normalizedInputEmail && !normalizedInputEmail.endsWith('@school.local')) {
      const conflict = await findPortalEmailConflict(db, {
        schoolId: context.school.id,
        email: normalizedInputEmail,
        targetType: 'teacher',
        targetId: '',
      });
      if (conflict) {
        return NextResponse.json(
          {
            error: `Email "${normalizedInputEmail}" is already assigned to ${conflict.displayName} (${conflict.code}). Each teacher needs a unique email.`,
          },
          { status: 409 }
        );
      }
    }

    let finalEmployeeCode = input.employee_code.trim();
    if (!finalEmployeeCode) {
      finalEmployeeCode = await generateUniqueTeacherEmployeeCode(db, context.school.id);
    } else {
      const { data: codeDup } = await db
        .from('teachers')
        .select('id')
        .eq('school_id', context.school.id)
        .ilike('employee_code', finalEmployeeCode)
        .maybeSingle();

      if (codeDup) {
        if (input.auto_generate_code) {
          finalEmployeeCode = await generateUniqueTeacherEmployeeCode(db, context.school.id);
        } else {
          return NextResponse.json(
            {
              error: `Employee code "${finalEmployeeCode}" already exists. Click Auto to generate a unique code.`,
            },
            { status: 400 }
          );
        }
      }
    }

    const pinHashValue = cleanPin ? hashTeacherPin(cleanPin) : null;

    const profileDocuments = mergeTeacherProfileDocuments([], {
      date_of_birth: input.date_of_birth?.trim() || null,
      gender: input.gender,
    });

    const buildInsertRow = (employeeCode: string) => {
      const codeSlug = employeeCode.toLowerCase().replace(/[^a-z0-9]/g, '') || `${Date.now()}`;
      return {
        school_id: context.school.id,
        employee_code: employeeCode,
        full_name: input.name,
        father_name: input.father_name?.trim() || null,
        cnic: input.cnic,
        mobile_number: input.phone,
        email: normalizedInputEmail || `staff.${codeSlug}@school.local`,
        qualification: input.qualification || null,
        experience_years: input.experience_years,
        address: input.address || null,
        joining_date: input.joining_date || new Date().toISOString().slice(0, 10),
        designation: input.designation,
        department: input.department,
        salary_pkr: input.base_salary,
        photo_url: input.photo_url || null,
        documents: profileDocuments,
        status: 'active',
        app_access_enabled: input.auto_app_access,
        app_blocked: false,
        email_verified: false,
        pin_hash: pinHashValue,
        qr_token: generateUniqueTeacherQrToken(),
      };
    };

    let teacher: Record<string, unknown> | null = null;
    let insertError: { code?: string; message: string } | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const candidateCode =
        attempt === 0
          ? finalEmployeeCode
          : await generateUniqueTeacherEmployeeCode(db, context.school.id, {
              forceRandomSuffix: attempt > 1,
            });

      const res = await db
        .from('teachers')
        .insert(buildInsertRow(candidateCode))
        .select('*')
        .single();

      teacher = res.data as Record<string, unknown> | null;
      insertError = res.error;

      if (!insertError && teacher) {
        break;
      }

      const isDuplicate =
        insertError?.code === '23505' ||
        insertError?.message.toLowerCase().includes('duplicate');

      if (!isDuplicate || (!input.auto_generate_code && attempt === 0 && input.employee_code.trim())) {
        break;
      }
    }

    if (insertError || !teacher) {
      return NextResponse.json(
        { error: insertError?.message || 'Unable to save staff record.' },
        { status: 400 }
      );
    }

    await db.from('audit_logs').insert({
      school_id: context.school.id,
      user_id: context.userId,
      action: 'STAFF_CREATED',
      table_name: 'teachers',
      record_id: String(teacher.id),
      new_values: { employee_code: teacher.employee_code, full_name: teacher.full_name },
    });

    try {
      await syncMonthlySalarySlipsForSchool({
        db,
        schoolId: context.school.id,
        teacherIds: [String(teacher.id)],
      });
    } catch {
      // Non-blocking
    }

    let linkedUserId: string | null = null;
    let linkedAuthEmail: string | null = null;
    let appAccessError: string | null = null;
    let activationQr: {
      qrDataUrl: string;
      qrPayload: string;
      tokenPreview: string;
      expiresAt: string;
      purpose: string;
      schoolName: string;
    } | null = null;

    if (input.auto_app_access) {
      try {
        const linked = await ensureTeacherAuthLinkedDetailed(db, {
          schoolId: context.school.id,
          teacherId: String(teacher.id),
          password: cleanPassword || undefined,
          enableAppAccess: true,
        });
        linkedUserId = linked.userId;
        linkedAuthEmail = linked.authEmail;

        if (linkedUserId) {
          teacher = {
            ...teacher,
            user_id: linkedUserId,
            email_verified: true,
            app_access_enabled: true,
            app_blocked: false,
          };

          try {
            await db.from('app_invitation_logs').insert({
              school_id: context.school.id,
              target_type: 'teacher',
              target_id: String(teacher.id),
              email: linkedAuthEmail || String(teacher.email || ''),
              action: cleanPassword ? 'password_set' : 'activated',
              status: cleanPassword
                ? 'Auto-Provisioned (Password Set)'
                : pinHashValue
                  ? 'Auto-Provisioned (PIN Set)'
                  : 'Auto-Provisioned',
              performed_by: context.userId,
            });
          } catch {
            // Non-blocking audit log
          }
        } else {
          appAccessError = 'Teacher record saved, but login account linking could not complete automatically.';
        }
      } catch (linkErr) {
        appAccessError = linkErr instanceof Error ? linkErr.message : 'Unable to link Teacher App login.';
      }

      if (linkedUserId) {
        try {
          const qrResult = await createActivationQR(db, {
            schoolId: context.school.id,
            targetType: 'teacher',
            targetId: String(teacher.id),
            role: 'teacher',
            purpose: 'teacher_first_activation',
            createdBy: context.userId,
            expiresInMinutes: 15,
            skipAuthLink: true,
          });
          activationQr = {
            qrDataUrl: qrResult.qrDataUrl,
            qrPayload: qrResult.qrPayloadJson,
            tokenPreview: qrResult.tokenPreview,
            expiresAt: qrResult.expiresAt,
            purpose: qrResult.purpose,
            schoolName: context.school.name_en,
          };
        } catch (qrErr) {
          appAccessError = qrErr instanceof Error ? qrErr.message : 'Unable to generate Activation QR automatically.';
        }
      }
    }

    return NextResponse.json(
      {
        teacher: {
          ...teacher,
          ...extractTeacherProfileMeta(teacher),
        },
        activationQr,
        appAccess: {
          enabled: input.auto_app_access,
          linked: Boolean(linkedUserId),
          qrGenerated: Boolean(activationQr),
          passwordSet: Boolean(cleanPassword),
          pinSet: Boolean(pinHashValue),
          authEmail: linkedAuthEmail,
          error: appAccessError,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected server error.' },
      { status: 500 }
    );
  }
}

const TeacherPatchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2),
  father_name: z.string().trim().max(120).optional().nullable(),
  date_of_birth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable()
    .or(z.literal('')),
  gender: z.enum(['Male', 'Female', 'Other']).optional(),
  cnic: z.string().min(5),
  phone: z.string().min(7),
  email: z.string().email().optional().or(z.literal('')),
  qualification: z.string().optional().nullable(),
  designation: z.string().min(2),
  department: z.string().min(2),
  base_salary: z.coerce.number().min(0).default(0),
  status: z.string().optional(),
});

export async function PATCH(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'staff')) {
    return NextResponse.json({ error: 'Insufficient module permissions.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = TeacherPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid staff update fields.', issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    const { data: existing, error: lookupErr } = await db
      .from('teachers')
      .select('id, school_id, user_id, employee_code, email, status, father_name, documents')
      .eq('id', input.id)
      .eq('school_id', context.school.id)
      .maybeSingle();

    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Teacher record not found.' }, { status: 404 });
    }

    const codeSlug =
      String(existing.employee_code || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '') || existing.id.slice(0, 8);
    const resolvedEmail = (
      input.email?.trim() ||
      existing.email ||
      `staff.${codeSlug}@school.local`
    ).toLowerCase();

    if (resolvedEmail && !resolvedEmail.endsWith('@school.local')) {
      const conflict = await findPortalEmailConflict(db, {
        schoolId: context.school.id,
        email: resolvedEmail,
        targetType: 'teacher',
        targetId: existing.id,
      });
      if (conflict) {
        return NextResponse.json(
          {
            error: `Email "${resolvedEmail}" is already assigned to ${conflict.displayName} (${conflict.code}). Please assign a separate email.`,
          },
          { status: 409 }
        );
      }
    }

    const emailWasChanged =
      resolvedEmail !== (existing.email || '').trim().toLowerCase() &&
      Boolean(resolvedEmail) &&
      !resolvedEmail.endsWith('@school.local');

    let userSharedWithOtherPortal = false;
    if (existing.user_id && emailWasChanged) {
      const [{ data: ownerSchool }, { data: linkedStudent }] = await Promise.all([
        db.from('schools').select('id').eq('owner_user_id', existing.user_id).limit(1).maybeSingle(),
        db.from('students').select('id').eq('user_id', existing.user_id).limit(1).maybeSingle(),
      ]);
      userSharedWithOtherPortal = Boolean(ownerSchool || linkedStudent);
    }

    const rawStatus = input.status?.trim().toLowerCase();
    const normalizedDbStatus: 'active' | 'inactive' | 'resigned' | undefined = rawStatus
      ? rawStatus === 'active'
        ? 'active'
        : ['resigned', 'left_school', 'left'].includes(rawStatus)
          ? 'resigned'
          : 'inactive'
      : undefined;
    const isInactiveStatus = normalizedDbStatus === 'inactive' || normalizedDbStatus === 'resigned';

    const updatedDocuments =
      input.date_of_birth !== undefined || input.gender !== undefined
        ? mergeTeacherProfileDocuments(existing.documents, {
            date_of_birth:
              input.date_of_birth === undefined ? undefined : input.date_of_birth?.trim() || null,
            gender: input.gender,
          })
        : undefined;

    const { data: teacher, error: updErr } = await db
      .from('teachers')
      .update({
        full_name: input.name,
        ...(input.father_name !== undefined
          ? { father_name: input.father_name?.trim() || null }
          : {}),
        ...(updatedDocuments ? { documents: updatedDocuments } : {}),
        cnic: input.cnic,
        mobile_number: input.phone,
        email: resolvedEmail,
        qualification: input.qualification || null,
        designation: input.designation,
        department: input.department,
        salary_pkr: input.base_salary,
        ...(normalizedDbStatus ? { status: normalizedDbStatus } : {}),
        ...(isInactiveStatus ? { app_access_enabled: false } : {}),
        ...(emailWasChanged && userSharedWithOtherPortal
          ? { user_id: null, app_access_enabled: false, email_verified: false }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('school_id', context.school.id)
      .select('*')
      .single();

    if (updErr || !teacher) {
      return NextResponse.json(
        { error: updErr?.message || 'Unable to update staff record.' },
        { status: 400 }
      );
    }

    if (existing.user_id && emailWasChanged && !userSharedWithOtherPortal) {
      await db
        .from('users')
        .update({
          email: resolvedEmail,
          full_name: input.name,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.user_id);

      const admin = createSupabaseAdminClient();
      if (admin) {
        await admin.auth.admin
          .updateUserById(existing.user_id, {
            email: resolvedEmail,
            email_confirm: true,
          })
          .catch(() => null);
      }
    }

    return NextResponse.json({
      teacher: {
        ...teacher,
        ...extractTeacherProfileMeta(teacher),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected server error.' },
      { status: 500 }
    );
  }
}
