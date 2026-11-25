import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { createActivationQR, type ActivationPurpose, type ActivationRole } from '@/lib/qr/token-service';

const GenerateQRSchema = z.object({
  targetType: z.enum(['teacher', 'student', 'guardian']),
  targetId: z.string().uuid(),
  purpose: z.enum([
    'teacher_first_activation',
    'student_first_activation',
    'guardian_first_activation',
    'teacher_pin_reset',
    'student_pin_reset',
    'guardian_pin_reset',
  ]),
});

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'app_access')) {
    return NextResponse.json({ error: 'Insufficient permissions for App Access.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = GenerateQRSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid QR generation request.', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { targetType, targetId, purpose } = parsed.data;

    // Validate purpose matches targetType
    if (
      (targetType === 'teacher' && !purpose.startsWith('teacher_')) ||
      (targetType === 'student' && !purpose.startsWith('student_')) ||
      (targetType === 'guardian' && !purpose.startsWith('guardian_'))
    ) {
      return NextResponse.json(
        { error: `Activation purpose "${purpose}" does not match target type "${targetType}".` },
        { status: 400 }
      );
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    // Lookup target user record
    let targetName = '';
    let targetIdentifier = '';
    let targetPhone = '';
    let targetClassSection = '';

    if (targetType === 'teacher') {
      const { data: teacher, error: tErr } = await db
        .from('teachers')
        .select('id, employee_code, full_name, mobile_number, designation')
        .eq('id', targetId)
        .eq('school_id', context.school.id)
        .maybeSingle();

      if (tErr || !teacher) {
        return NextResponse.json({ error: 'Teacher record not found in this school.' }, { status: 404 });
      }
      targetName = teacher.full_name;
      targetIdentifier = teacher.employee_code;
      targetPhone = teacher.mobile_number || '';
      targetClassSection = teacher.designation || 'Teacher';
    } else if (targetType === 'student') {
      const { data: student, error: sErr } = await db
        .from('students')
        .select('id, admission_number, name_en, parent_mobile, class_id, section_id')
        .eq('id', targetId)
        .eq('school_id', context.school.id)
        .maybeSingle();

      if (sErr || !student) {
        return NextResponse.json({ error: 'Student record not found in this school.' }, { status: 404 });
      }
      targetName = student.name_en;
      targetIdentifier = student.admission_number;
      targetPhone = student.parent_mobile || '';

      if (student.class_id) {
        const { data: cls } = await db.from('classes').select('name').eq('id', student.class_id).maybeSingle();
        targetClassSection = cls?.name || 'Student';
      }
    } else {
      const { data: guardian, error: gErr } = await db
        .from('guardians')
        .select('id, full_name, phone, relationship')
        .eq('id', targetId)
        .eq('school_id', context.school.id)
        .maybeSingle();

      if (gErr || !guardian) {
        return NextResponse.json({ error: 'Guardian record not found in this school.' }, { status: 404 });
      }
      targetName = guardian.full_name;
      targetIdentifier = guardian.relationship || 'Guardian';
      targetPhone = guardian.phone || '';
      targetClassSection = 'Guardian';
    }

    const qrResult = await createActivationQR(db, {
      schoolId: context.school.id,
      targetType: targetType as ActivationRole,
      targetId,
      role: targetType as ActivationRole,
      purpose: purpose as ActivationPurpose,
      createdBy: context.userId,
      expiresInMinutes: 15,
    });

    return NextResponse.json({
      success: true,
      qrDataUrl: qrResult.qrDataUrl,
      qrPayload: qrResult.qrPayloadJson,
      tokenPreview: qrResult.tokenPreview,
      expiresAt: qrResult.expiresAt,
      purpose: qrResult.purpose,
      role: qrResult.role,
      target: {
        id: targetId,
        name: targetName,
        identifier: targetIdentifier,
        phone: targetPhone,
        classSection: targetClassSection,
        schoolName: context.school.name_en,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'QR generation failed.' },
      { status: 500 }
    );
  }
}
