import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { canAddStudent } from '@/lib/subscription/entitlements';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { generateMonthlyChallansForSchool } from '@/lib/fees/auto-challan';
import { ensurePublicUserProfile } from '@/lib/auth/ensure-user-profile';
import { findPortalEmailConflict } from '@/lib/auth/portal-emails';
import { generateUniqueStudentIdentifiers, hasStudentsColumn } from '@/lib/students/identifiers';

const StudentInputSchema = z.object({
  admission_no: z.string().trim().optional().default(''),
  roll_no: z.string().trim().optional(),
  student_id_code: z.string().trim().optional(),
  auto_generate_ids: z.boolean().optional().default(true),
  name_en: z.string().min(2),
  name_ur: z.string().optional(),
  father_name: z.string().optional(),
  mother_name: z.string().optional(),
  father_cnic: z.string().optional(),
  b_form: z.string().optional(),
  dob: z.string().optional(),
  gender: z.enum(['Male', 'Female', 'Other']).default('Male'),
  address: z.string().optional(),
  admission_date: z.string().optional(),
  session_id: z.string().uuid().optional().nullable(),
  class_id: z.string().uuid().optional().nullable(),
  section_id: z.string().uuid().optional().nullable(),
  email: z.string().email().optional().or(z.literal('')),
  parent_mobile: z.string().optional(),
  parent_email: z.string().email().optional().or(z.literal('')),
  emergency_contact: z.string().optional(),
  monthly_fee_pkr: z.coerce.number().min(0).default(0),
  admission_fee_pkr: z.coerce.number().min(0).default(0),
  discount_pkr: z.coerce.number().min(0).default(0),
  photo_url: z.string().optional(),
  photo_data_url: z.string().optional().nullable(),
  guardian: z
    .object({
      full_name: z.string().min(2),
      relationship: z.enum(['Father', 'Mother', 'Guardian', 'Other']).default('Father'),
      phone: z.string().optional().or(z.literal('')),
      email: z.string().email().optional().or(z.literal('')),
      cnic: z.string().optional(),
      address: z.string().optional(),
      emergency_contact: z.string().optional(),
    })
    .optional(),
});

const StudentPatchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_profile'),
    student_id: z.string().uuid(),
    admission_number: z.string().trim().min(1),
    roll_number: z.string().trim().optional().nullable(),
    name_en: z.string().trim().min(2),
    name_ur: z.string().trim().optional().nullable(),
    father_name: z.string().trim().optional().nullable(),
    mother_name: z.string().trim().optional().nullable(),
    father_cnic: z.string().trim().optional().nullable(),
    b_form_number: z.string().trim().optional().nullable(),
    date_of_birth: z.string().trim().optional().nullable(),
    gender: z.enum(['Male', 'Female', 'Other']).default('Male'),
    parent_mobile: z.string().trim().optional().nullable(),
    parent_email: z.string().trim().optional().nullable(),
    student_email: z.string().trim().optional().nullable(),
    emergency_contact: z.string().trim().optional().nullable(),
    province: z.string().trim().optional().nullable(),
    district: z.string().trim().optional().nullable(),
    tehsil: z.string().trim().optional().nullable(),
    village: z.string().trim().optional().nullable(),
    complete_address: z.string().trim().optional().nullable(),
    previous_school: z.string().trim().optional().nullable(),
    admission_date: z.string().trim().optional().nullable(),
    academic_session_id: z.string().uuid().optional().nullable(),
    class_id: z.string().uuid().optional().nullable(),
    section_id: z.string().uuid().optional().nullable(),
    admission_fee_pkr: z.coerce.number().min(0).default(0),
    monthly_fee_pkr: z.coerce.number().min(0).default(0),
    discount_pkr: z.coerce.number().min(0).default(0),
    scholarship_note: z.string().trim().optional().nullable(),
    status: z.enum(['active', 'inactive', 'graduated', 'transferred', 'withdrawn']).default('active'),
    photo_data_url: z.string().optional().nullable(),
    remove_photo: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('promote'),
    student_id: z.string().uuid(),
    class_id: z.string().uuid().optional().nullable(),
    section_id: z.string().uuid().optional().nullable(),
    notes: z.string().trim().optional().nullable(),
  }),
  z.object({
    action: z.enum(['transfer', 'withdraw']),
    student_id: z.string().uuid(),
    notes: z.string().trim().optional().nullable(),
  }),
]);

type DbClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

async function uploadStudentPhotoDataUrl(
  db: DbClient,
  schoolId: string,
  filePrefix: string,
  dataUrl: string
): Promise<{ url: string | null; error: string | null }> {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) {
    return {
      url: null,
      error: 'Invalid photo image format. Please select or capture a JPG/PNG photo again.',
    };
  }

  const mimeType = match[1];
  const base64Data = match[2];
  const extRaw = mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
  const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
  const buffer = Buffer.from(base64Data, 'base64');

  if (buffer.length === 0) {
    return { url: null, error: 'Selected photo file is empty.' };
  }
  if (buffer.length > 6 * 1024 * 1024) {
    return { url: null, error: 'Photo size exceeds 6 MB. Please upload a smaller image.' };
  }

  const safePrefix = filePrefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'student';
  const filePath = `${schoolId}/${safePrefix}-${Date.now()}.${ext}`;

  const { error: upErr } = await db.storage
    .from('student-photos')
    .upload(filePath, buffer, { contentType: mimeType, upsert: true });

  if (upErr) {
    return { url: null, error: `Photo upload failed: ${upErr.message}` };
  }

  const { data: signed, error: signErr } = await db.storage
    .from('student-photos')
    .createSignedUrl(filePath, 60 * 60 * 24 * 365 * 5);

  if (signErr || !signed?.signedUrl) {
    return {
      url: null,
      error: `Photo saved to storage, but URL generation failed: ${signErr?.message || 'Unknown error'}`,
    };
  }

  return { url: signed.signedUrl, error: null };
}

async function syncStudentPhotoToAppAccount(
  db: DbClient,
  userId: string | null | undefined,
  photoUrl: string | null
) {
  if (!userId) return;

  await db
    .from('users')
    .update({
      avatar_url: photoUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  try {
    const admin = createSupabaseAdminClient();
    if (admin) {
      const { data: authData } = await admin.auth.admin.getUserById(userId);
      const currentMeta =
        (authData?.user?.user_metadata as Record<string, unknown> | undefined) ?? {};
      await admin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...currentMeta,
          avatar_url: photoUrl,
          photo_url: photoUrl,
        },
      });
    }
  } catch {
    // Non-fatal if auth metadata update cannot run
  }
}

export async function GET(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (
    !hasModulePermission(context.member, 'students') &&
    !hasModulePermission(context.member, 'admissions') &&
    !hasModulePermission(context.member, 'parents')
  ) {
    return NextResponse.json({ error: 'Insufficient module permissions.' }, { status: 403 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const url = new URL(request.url);
  const nextIdentifiers = url.searchParams.get('nextIdentifiers');
  if (nextIdentifiers === '1' || nextIdentifiers === 'true') {
    const generated = await generateUniqueStudentIdentifiers(
      db,
      context.school.id,
      context.school.name_en
    );
    return NextResponse.json(generated);
  }

  const historyStudentId = url.searchParams.get('historyStudentId');

  if (historyStudentId) {
    const { data: history, error: hErr } = await db
      .from('student_history')
      .select('id, event_type, from_class, to_class, notes, created_at')
      .eq('school_id', context.school.id)
      .eq('student_id', historyStudentId)
      .order('created_at', { ascending: false });

    if (hErr) {
      return NextResponse.json({ error: hErr.message }, { status: 400 });
    }
    return NextResponse.json({ history: history ?? [] });
  }

  const [
    { data: students, error: sErr },
    { data: classes },
    { data: sections },
    { data: sessions },
  ] = await Promise.all([
    db
      .from('students')
      .select('*')
      .eq('school_id', context.school.id)
      .order('created_at', { ascending: false }),
    db
      .from('classes')
      .select('id, name, level_order')
      .eq('school_id', context.school.id)
      .order('level_order'),
    db
      .from('sections')
      .select('id, name, class_id')
      .eq('school_id', context.school.id)
      .order('name'),
    db
      .from('academic_sessions')
      .select('id, name')
      .eq('school_id', context.school.id)
      .order('name', { ascending: false }),
  ]);

  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 400 });
  }

  return NextResponse.json({
    students: students ?? [],
    classes: classes ?? [],
    sections: sections ?? [],
    sessions: sessions ?? [],
  });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (
    !hasModulePermission(context.member, 'admissions') &&
    !hasModulePermission(context.member, 'students')
  ) {
    return NextResponse.json({ error: 'Insufficient module permissions.' }, { status: 403 });
  }

  const limitCheck = canAddStudent(context.entitlements);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.reason }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = StudentInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid student fields.', issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    const supportsStudentId = await hasStudentsColumn(db, 'student_id');
    const generatedIds = await generateUniqueStudentIdentifiers(
      db,
      context.school.id,
      context.school.name_en
    );

    let finalAdmissionNo = input.admission_no.trim();
    if (!finalAdmissionNo) {
      finalAdmissionNo = generatedIds.admissionNumber;
    } else {
      const { data: admDup } = await db
        .from('students')
        .select('id')
        .eq('school_id', context.school.id)
        .ilike('admission_number', finalAdmissionNo)
        .maybeSingle();
      if (admDup) {
        if (input.auto_generate_ids) {
          finalAdmissionNo = generatedIds.admissionNumber;
        } else {
          return NextResponse.json(
            {
              error: `Admission number "${finalAdmissionNo}" already exists. Use Auto-Generate for a unique ID.`,
            },
            { status: 400 }
          );
        }
      }
    }

    const finalRollNo = input.roll_no?.trim() || generatedIds.rollNumber;

    let finalStudentId = input.student_id_code?.trim() || generatedIds.studentId;
    if (supportsStudentId && input.student_id_code?.trim()) {
      const { data: sidDup } = await db
        .from('students')
        .select('id')
        .eq('school_id', context.school.id)
        .eq('student_id', finalStudentId)
        .maybeSingle();
      if (sidDup) {
        finalStudentId = generatedIds.studentId;
      }
    }

    const admSlug = finalAdmissionNo.toLowerCase().replace(/[^a-z0-9]/g, '') || `${Date.now()}`;

    let resolvedPhotoUrl: string | null = input.photo_url || null;
    if (input.photo_data_url) {
      const uploaded = await uploadStudentPhotoDataUrl(db, context.school.id, admSlug, input.photo_data_url);
      if (uploaded.error) {
        return NextResponse.json({ error: uploaded.error }, { status: 400 });
      }
      resolvedPhotoUrl = uploaded.url;
    }

    const fallbackPhone =
      input.parent_mobile ||
      input.guardian?.phone ||
      input.emergency_contact ||
      context.school.mobile_number ||
      context.school.phone ||
      '03000000000';
    const fallbackCity = context.school.district || context.school.city || 'Lahore';

    const buildInsertRow = (admNo: string, rollNo: string, studentIdCode: string) => {
      const cleanSlug = admNo.toLowerCase().replace(/[^a-z0-9]/g, '') || `${Date.now()}`;
      const row: Record<string, unknown> = {
        school_id: context.school.id,
        admission_number: admNo,
        roll_number: rollNo || null,
        name_en: input.name_en,
        name_ur: input.name_ur || null,
        father_name: input.father_name || input.guardian?.full_name || 'Parent / Guardian',
        mother_name: input.mother_name || null,
        father_cnic: input.father_cnic || input.guardian?.cnic || '00000-0000000-0',
        b_form_number: input.b_form || null,
        date_of_birth: input.dob || '2012-01-01',
        gender: input.gender,
        parent_mobile: fallbackPhone,
        parent_email: input.parent_email || input.guardian?.email || `parent.${cleanSlug}@school.local`,
        student_email: input.email || `student.${cleanSlug}@school.local`,
        province: context.school.province || 'Punjab',
        district: fallbackCity,
        tehsil: context.school.tehsil || fallbackCity,
        complete_address: input.address || context.school.address || 'Pakistan',
        admission_date: input.admission_date || new Date().toISOString().slice(0, 10),
        academic_session_id: input.session_id || null,
        class_id: input.class_id || null,
        section_id: input.section_id || null,
        admission_fee_pkr: input.admission_fee_pkr,
        monthly_fee_pkr: input.monthly_fee_pkr,
        discount_pkr: input.discount_pkr,
        emergency_contact: input.emergency_contact || fallbackPhone,
        photo_url: resolvedPhotoUrl,
        documents: [],
        status: 'active',
        app_access_enabled: false,
        app_blocked: false,
        email_verified: false,
      };
      if (supportsStudentId) {
        row.student_id = studentIdCode;
      }
      return row;
    };

    let { data: student, error } = await db
      .from('students')
      .insert(buildInsertRow(finalAdmissionNo, finalRollNo, finalStudentId))
      .select('*')
      .single();

    if (error && (error.code === '23505' || error.message.toLowerCase().includes('duplicate'))) {
      const retryIds = await generateUniqueStudentIdentifiers(
        db,
        context.school.id,
        context.school.name_en
      );
      const retryRes = await db
        .from('students')
        .insert(buildInsertRow(retryIds.admissionNumber, retryIds.rollNumber, retryIds.studentId))
        .select('*')
        .single();
      student = retryRes.data;
      error = retryRes.error;
    }

    if (error || !student) {
      return NextResponse.json({ error: error?.message || 'Unable to admit student.' }, { status: 400 });
    }

    if (input.guardian) {
      const gPhone = (input.guardian.phone || fallbackPhone || '').trim();
      const gCnic = (input.guardian.cnic || '').trim();
      let matchedGuardianId: string | null = null;

      if (gPhone || gCnic) {
        let findQuery = db.from('guardians').select('id, full_name').eq('school_id', context.school.id);
        if (gPhone && gCnic) {
          findQuery = findQuery.or(`phone.eq.${gPhone},cnic.eq.${gCnic}`);
        } else if (gPhone) {
          findQuery = findQuery.eq('phone', gPhone);
        } else if (gCnic) {
          findQuery = findQuery.eq('cnic', gCnic);
        }
        const { data: matched } = await findQuery.limit(1).maybeSingle();
        if (matched?.id) {
          matchedGuardianId = matched.id;
        }
      }

      if (!matchedGuardianId) {
        const { data: guardian } = await db
          .from('guardians')
          .insert({
            school_id: context.school.id,
            full_name: input.guardian.full_name,
            relationship: input.guardian.relationship,
            phone: gPhone,
            email: input.guardian.email || null,
            cnic: gCnic || null,
            address: input.guardian.address || null,
            emergency_contact: input.guardian.emergency_contact || null,
            status: 'active',
            access_state: 'ACTIVE',
            is_verified: true,
            app_access_enabled: false,
            app_blocked: false,
            app_account_status: 'not_provisioned',
          })
          .select('id')
          .single();
        matchedGuardianId = guardian?.id ?? null;
      }

      if (matchedGuardianId) {
        // Prevent duplicate link if already present
        const { data: existingLink } = await db
          .from('student_guardians')
          .select('id')
          .eq('school_id', context.school.id)
          .eq('student_id', student.id)
          .eq('guardian_id', matchedGuardianId)
          .maybeSingle();

        if (!existingLink) {
          await db.from('student_guardians').insert({
            school_id: context.school.id,
            student_id: student.id,
            guardian_id: matchedGuardianId,
            relationship_type: input.guardian.relationship || 'Father',
            is_primary: true,
            is_verified: true,
            status: 'active',
            verified_by: context.userId,
          });
        }
      }
    }

    await ensurePublicUserProfile(db, context.userId, context.userEmail, context.member.full_name);

    await db.from('student_history').insert({
      school_id: context.school.id,
      student_id: student.id,
      event_type: 'Admission',
      notes: `Admitted with admission no ${student.admission_number}`,
      recorded_by: context.userId,
    });

    await db.from('audit_logs').insert({
      school_id: context.school.id,
      user_id: context.userId,
      action: 'STUDENT_ADMITTED',
      table_name: 'students',
      record_id: student.id,
      new_values: { admission_number: student.admission_number, name_en: student.name_en },
    });

    try {
      await generateMonthlyChallansForSchool({
        db,
        schoolId: context.school.id,
        performedBy: context.userId,
        force: false,
        studentIds: [student.id],
      });
    } catch {
      // Non-blocking: admission still succeeds if fee settings/structures are absent
    }

    return NextResponse.json(
      { student, studentIdColumnMissing: !supportsStudentId },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected server error.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (
    !hasModulePermission(context.member, 'students') &&
    !hasModulePermission(context.member, 'admissions')
  ) {
    return NextResponse.json({ error: 'Insufficient module permissions.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = StudentPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid student update payload.', issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    const { data: existing, error: lookupErr } = await db
      .from('students')
      .select('*')
      .eq('id', parsed.data.student_id)
      .eq('school_id', context.school.id)
      .maybeSingle();

    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Student record not found in your school.' }, { status: 404 });
    }

    if (parsed.data.action === 'update_profile') {
      const input = parsed.data;
      let nextPhotoUrl: string | null = existing.photo_url ?? null;
      let photoChanged = false;

      if (input.remove_photo) {
        nextPhotoUrl = null;
        photoChanged = true;
      } else if (input.photo_data_url) {
        const uploaded = await uploadStudentPhotoDataUrl(
          db,
          context.school.id,
          existing.id,
          input.photo_data_url
        );
        if (uploaded.error) {
          return NextResponse.json({ error: uploaded.error }, { status: 400 });
        }
        nextPhotoUrl = uploaded.url;
        photoChanged = true;
      }

      const admSlug =
        input.admission_number.toLowerCase().replace(/[^a-z0-9]/g, '') || existing.id.slice(0, 8);
      const isInactive = input.status === 'transferred' || input.status === 'withdrawn';
      const resolvedStudentEmail = (
        input.student_email ||
        existing.student_email ||
        `student.${admSlug}@school.local`
      )
        .trim()
        .toLowerCase();

      if (resolvedStudentEmail && !resolvedStudentEmail.endsWith('@school.local')) {
        const conflict = await findPortalEmailConflict(db, {
          schoolId: context.school.id,
          email: resolvedStudentEmail,
          targetType: 'student',
          targetId: existing.id,
        });
        if (conflict) {
          return NextResponse.json(
            {
              error: `Student email "${resolvedStudentEmail}" is already used by ${conflict.displayName} (${conflict.code}). Please assign a separate email.`,
            },
            { status: 409 }
          );
        }
      }

      const updatePayload: Record<string, unknown> = {
        admission_number: input.admission_number,
        roll_number: input.roll_number || null,
        name_en: input.name_en,
        name_ur: input.name_ur || null,
        father_name: input.father_name || existing.father_name || 'Parent / Guardian',
        mother_name: input.mother_name || null,
        father_cnic: input.father_cnic || existing.father_cnic || '00000-0000000-0',
        b_form_number: input.b_form_number || null,
        date_of_birth: input.date_of_birth || existing.date_of_birth || '2012-01-01',
        gender: input.gender,
        parent_mobile: input.parent_mobile || existing.parent_mobile || '03000000000',
        parent_email:
          input.parent_email || existing.parent_email || `parent.${admSlug}@school.local`,
        student_email: resolvedStudentEmail,
        emergency_contact:
          input.emergency_contact ||
          input.parent_mobile ||
          existing.emergency_contact ||
          '03000000000',
        province: input.province || existing.province || 'Punjab',
        district: input.district || existing.district || 'Lahore',
        tehsil: input.tehsil || input.district || existing.tehsil || 'Lahore',
        village: input.village || null,
        complete_address:
          input.complete_address || existing.complete_address || context.school.address || 'Pakistan',
        previous_school: input.previous_school || null,
        admission_date: input.admission_date || existing.admission_date,
        academic_session_id: input.academic_session_id || null,
        class_id: input.class_id || null,
        section_id: input.section_id || null,
        admission_fee_pkr: input.admission_fee_pkr,
        monthly_fee_pkr: input.monthly_fee_pkr,
        discount_pkr: input.discount_pkr,
        scholarship_note: input.scholarship_note || null,
        status: input.status,
        photo_url: nextPhotoUrl,
        updated_at: new Date().toISOString(),
      };

      const studentEmailChanged =
        Boolean(resolvedStudentEmail) &&
        !resolvedStudentEmail.endsWith('@school.local') &&
        resolvedStudentEmail !== (existing.student_email || '').trim().toLowerCase();

      let studentUserSharedWithOtherPortal = false;
      if (existing.user_id && studentEmailChanged) {
        const [{ data: ownerSchool }, { data: linkedTeacher }] = await Promise.all([
          db.from('schools').select('id').eq('owner_user_id', existing.user_id).limit(1).maybeSingle(),
          db.from('teachers').select('id').eq('user_id', existing.user_id).limit(1).maybeSingle(),
        ]);
        studentUserSharedWithOtherPortal = Boolean(ownerSchool || linkedTeacher);
      }

      if (isInactive) {
        updatePayload.app_access_enabled = false;
        updatePayload.app_blocked = false;
      } else if (studentEmailChanged && studentUserSharedWithOtherPortal) {
        updatePayload.user_id = null;
        updatePayload.app_access_enabled = false;
        updatePayload.email_verified = false;
      }

      const { data: updatedStudent, error: updateErr } = await db
        .from('students')
        .update(updatePayload)
        .eq('id', existing.id)
        .eq('school_id', context.school.id)
        .select('*')
        .single();

      if (updateErr || !updatedStudent) {
        return NextResponse.json(
          { error: updateErr?.message || 'Unable to update student profile.' },
          { status: 400 }
        );
      }

      await ensurePublicUserProfile(db, context.userId, context.userEmail, context.member.full_name);

      if (existing.user_id && (photoChanged || nextPhotoUrl) && !studentUserSharedWithOtherPortal) {
        await syncStudentPhotoToAppAccount(db, existing.user_id, nextPhotoUrl);
      }

      if (existing.user_id && studentEmailChanged && !studentUserSharedWithOtherPortal) {
        await db
          .from('users')
          .update({ email: resolvedStudentEmail, updated_at: new Date().toISOString() })
          .eq('id', existing.user_id);
        const admin = createSupabaseAdminClient();
        if (admin) {
          await admin.auth.admin
            .updateUserById(existing.user_id, {
              email: resolvedStudentEmail,
              email_confirm: true,
            })
            .catch(() => null);
        }
      }

      await db.from('audit_logs').insert({
        school_id: context.school.id,
        user_id: context.userId,
        action: 'STUDENT_PROFILE_UPDATED',
        table_name: 'students',
        record_id: existing.id,
        new_values: {
          admission_number: updatedStudent.admission_number,
          name_en: updatedStudent.name_en,
          class_id: updatedStudent.class_id,
          monthly_fee_pkr: updatedStudent.monthly_fee_pkr,
          status: updatedStudent.status,
        },
      });

      return NextResponse.json({ success: true, student: updatedStudent });
    }

    await ensurePublicUserProfile(db, context.userId, context.userEmail, context.member.full_name);

    if (parsed.data.action === 'promote') {
      const nextClassId = parsed.data.class_id || existing.class_id;
      const nextSectionId =
        parsed.data.section_id !== undefined ? parsed.data.section_id : existing.section_id;

      const [{ data: classes }, { data: updatedStudent, error: updErr }] = await Promise.all([
        db.from('classes').select('id, name').eq('school_id', context.school.id),
        db
          .from('students')
          .update({
            class_id: nextClassId,
            section_id: nextSectionId,
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .eq('school_id', context.school.id)
          .select('*')
          .single(),
      ]);

      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 400 });
      }

      const classMap = new Map((classes ?? []).map((c) => [c.id, c.name]));
      await db.from('student_history').insert({
        school_id: context.school.id,
        student_id: existing.id,
        event_type: 'Promotion',
        from_class: (existing.class_id && classMap.get(existing.class_id)) || '',
        to_class: (nextClassId && classMap.get(nextClassId)) || '',
        notes: parsed.data.notes || 'Promoted to next class',
        recorded_by: context.userId,
      });

      return NextResponse.json({ success: true, student: updatedStudent });
    }

    const nextStatus = parsed.data.action === 'transfer' ? 'transferred' : 'withdrawn';
    const { data: updatedStudent, error: statusErr } = await db
      .from('students')
      .update({
        status: nextStatus,
        app_access_enabled: false,
        app_blocked: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('school_id', context.school.id)
      .select('*')
      .single();

    if (statusErr) {
      return NextResponse.json({ error: statusErr.message }, { status: 400 });
    }

    await db.from('student_history').insert({
      school_id: context.school.id,
      student_id: existing.id,
      event_type: parsed.data.action === 'transfer' ? 'Transfer' : 'Withdrawal',
      notes: parsed.data.notes || `Student marked as ${nextStatus}`,
      recorded_by: context.userId,
    });

    return NextResponse.json({ success: true, student: updatedStudent });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to update student record.' },
      { status: 500 }
    );
  }
}
