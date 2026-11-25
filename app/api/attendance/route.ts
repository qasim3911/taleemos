import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { ensurePublicUserProfile } from '@/lib/auth/ensure-user-profile';
import { syncMonthlySalarySlipsForSchool } from '@/lib/payroll/auto-salary';
import {
  ALL_WEEK_DAYS,
  getDateHolidayInfo,
  getSchoolHolidayContext,
  normalizeWorkingDays,
} from '@/lib/attendance/holidays';
import { hasStudentsColumn } from '@/lib/students/identifiers';

const AttendanceActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('student'),
    studentId: z.string().uuid().optional(),
    token: z.string().trim().min(1).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['Present', 'Absent', 'Late', 'Leave']).default('Present'),
    source: z.enum(['manual', 'qr_gate', 'teacher_app']).default('manual'),
    qrMode: z.enum(['IN', 'OUT']).optional(),
    allowOnHoliday: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('teacher'),
    teacherId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['Present', 'Absent', 'Late', 'Leave']),
    allowOnHoliday: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('declare_holiday'),
    title: z.string().trim().min(2).max(120),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    description: z.string().trim().max(500).optional(),
    notifyAll: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('remove_holiday'),
    eventId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('update_working_days'),
    workingDays: z.array(z.enum(ALL_WEEK_DAYS)).min(1),
  }),
]);

export async function GET(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

  // --- NEW: Class-wise filter from query params ---
  const url = new URL(request.url);
  const filterClassId = url.searchParams.get('class_id');
  const filterSectionId = url.searchParams.get('section_id');

  const supportsStudentId = await hasStudentsColumn(db, 'student_id');
  const studentSelectCols = (
    supportsStudentId
      ? 'id, admission_number, name_en, class_id, section_id, student_id, qr_token, user_id, app_access_enabled, app_blocked'
      : 'id, admission_number, name_en, class_id, section_id, qr_token, user_id, app_access_enabled, app_blocked'
  ) as '*';

  // Build student query with class / section filter
  let studentQuery = db
    .from('students')
    .select(studentSelectCols)
    .eq('school_id', context.school.id)
    .in('status', ['active', 'Active']);

  if (filterClassId) {
    studentQuery = studentQuery.eq('class_id', filterClassId);
  }
  if (filterSectionId) {
    studentQuery = studentQuery.eq('section_id', filterSectionId);
  }

  const [
    { data: students, error: sErr },
    { data: teachers, error: tErr },
    { data: studentAttendance, error: saErr },
    { data: teacherAttendance },
    holidayContext,
    { data: classes },
    { data: sections },
  ] = await Promise.all([
    studentQuery.order('admission_number'),
    db
      .from('teachers')
      .select('id, employee_code, full_name')
      .eq('school_id', context.school.id)
      .in('status', ['active', 'Active'])
      .order('employee_code'),
    db
      .from('student_attendance')
      .select('*')
      .eq('school_id', context.school.id)
      .order('attendance_date', { ascending: false })
      .limit(300),
    db
      .from('teacher_attendance')
      .select('*')
      .eq('school_id', context.school.id)
      .order('attendance_date', { ascending: false })
      .limit(200),
    getSchoolHolidayContext(db, context.school.id),
    // NEW: For Class dropdown
    db.from('classes').select('id, name, grade_level').eq('school_id', context.school.id).order('name'),
    db.from('sections').select('id, name, class_id').eq('school_id', context.school.id).order('name'),
  ]);

  if (sErr || tErr || saErr) {
    return NextResponse.json(
      { error: sErr?.message || tErr?.message || saErr?.message || 'Unable to load attendance data.' },
      { status: 400 }
    );
  }

  return NextResponse.json({
    students: students ?? [],
    teachers: teachers ?? [],
    studentAttendance: studentAttendance ?? [],
    teacherAttendance: teacherAttendance ?? [],
    workingDays: holidayContext.workingDays,
    holidays: holidayContext.holidays,
    classes: classes ?? [],
    sections: sections ?? [],
    selectedClassId: filterClassId,
    selectedSectionId: filterSectionId,
  });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'attendance')) {
    return NextResponse.json({ error: 'Insufficient permissions for Attendance.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = AttendanceActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid attendance payload.' }, { status: 400 });
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    if (parsed.data.type === 'declare_holiday') {
      const startDate = parsed.data.startDate;
      const endDate =
        parsed.data.endDate && parsed.data.endDate >= startDate ? parsed.data.endDate : startDate;

      const { data: createdHoliday, error: hErr } = await db
        .from('school_calendar_events')
        .insert({
          school_id: context.school.id,
          title: parsed.data.title,
          event_type: 'Holiday',
          start_date: startDate,
          end_date: endDate,
          description: parsed.data.description || null,
        })
        .select('*')
        .single();

      if (hErr || !createdHoliday) {
        return NextResponse.json(
          { error: hErr?.message || 'Unable to save school holiday.' },
          { status: 400 }
        );
      }

      if (parsed.data.notifyAll) {
        await db.from('notifications').insert({
          school_id: context.school.id,
          recipient_user_id: null,
          target_audience: 'All',
          category: 'announcements',
          title: `School Holiday: ${parsed.data.title}`,
          body: `${context.school.name_en} will remain closed from ${startDate}${endDate !== startDate ? ` to ${endDate}` : ''} (${parsed.data.title}).${parsed.data.description ? ` ${parsed.data.description}` : ''}`,
          metadata: {
            event_id: createdHoliday.id,
            event_type: 'Holiday',
            start_date: startDate,
            end_date: endDate,
          },
          is_read: false,
        });
      }

      return NextResponse.json({ success: true, holiday: createdHoliday }, { status: 201 });
    }

    if (parsed.data.type === 'remove_holiday') {
      const { error: delErr } = await db
        .from('school_calendar_events')
        .delete()
        .eq('id', parsed.data.eventId)
        .eq('school_id', context.school.id)
        .eq('event_type', 'Holiday');

      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    if (parsed.data.type === 'update_working_days') {
      const cleaned = normalizeWorkingDays(parsed.data.workingDays);
      const { error: upErr } = await db
        .from('school_profiles')
        .upsert(
          {
            school_id: context.school.id,
            name: context.school.name_en,
            school_name: context.school.name_en,
            working_days: cleaned,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'school_id' }
        );

      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, workingDays: cleaned });
    }

    const holidayContext = await getSchoolHolidayContext(db, context.school.id);
    const holidayInfo = getDateHolidayInfo(
      parsed.data.date,
      holidayContext.workingDays,
      holidayContext.holidays
    );

    if (holidayInfo.isHoliday && !parsed.data.allowOnHoliday) {
      return NextResponse.json(
        {
          error: `${parsed.data.date} is a Holiday (${holidayInfo.title}). Attendance is closed for holidays (enable "Extra Class Override" if needed).`,
          isHoliday: true,
          holidayTitle: holidayInfo.title,
        },
        { status: 409 }
      );
    }

    if (parsed.data.type === 'teacher') {
      const { error } = await db.from('teacher_attendance').upsert(
        {
          school_id: context.school.id,
          teacher_id: parsed.data.teacherId,
          attendance_date: parsed.data.date,
          status: parsed.data.status,
          marked_by: context.userId,
        },
        { onConflict: 'school_id,teacher_id,attendance_date' }
      );

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      try {
        await syncMonthlySalarySlipsForSchool({
          db,
          schoolId: context.school.id,
          payrollMonth: parsed.data.date.slice(0, 7),
          teacherIds: [parsed.data.teacherId],
          forceRecalculateUnpaid: true,
        });
      } catch {
        // Non-blocking sync so attendance save still succeeds
      }

      return NextResponse.json({ success: true, salarySynced: true });
    }

    const supportsStudentId = await hasStudentsColumn(db, 'student_id');
    const postStudentCols = (
      supportsStudentId
        ? 'id, admission_number, name_en, class_id, section_id, student_id, qr_token, user_id, app_access_enabled, app_blocked, student_email'
        : 'id, admission_number, name_en, class_id, section_id, qr_token, user_id, app_access_enabled, app_blocked, student_email'
    ) as '*';

    let studentQuery = db
      .from('students')
      .select(postStudentCols)
      .eq('school_id', context.school.id);

    if (parsed.data.studentId) {
      studentQuery = studentQuery.eq('id', parsed.data.studentId);
    } else if (parsed.data.token) {
      studentQuery = studentQuery.or(
        supportsStudentId
          ? `student_id.eq.${parsed.data.token},qr_token.eq.${parsed.data.token},admission_number.eq.${parsed.data.token}`
          : `qr_token.eq.${parsed.data.token},admission_number.eq.${parsed.data.token}`
      );
    } else {
      return NextResponse.json({ error: 'Student ID is required.' }, { status: 400 });
    }

    const { data: student, error: stuErr } = await studentQuery.limit(1).maybeSingle();
    if (stuErr || !student) {
      return NextResponse.json(
        { error: stuErr?.message || 'Student record not found in your school.' },
        { status: 404 }
      );
    }

    const { data: existingAtt } = await db
      .from('student_attendance')
      .select('id, check_in_at, check_out_at, status')
      .eq('school_id', context.school.id)
      .eq('student_id', student.id)
      .eq('attendance_date', parsed.data.date)
      .maybeSingle();

    if (parsed.data.source === 'qr_gate' && existingAtt) {
      if (parsed.data.qrMode === 'IN' && existingAtt.check_in_at) {
        return NextResponse.json(
          {
            error: `Duplicate Scan Prevented: ${student.name_en} (${student.admission_number}) has already checked IN today at ${new Date(existingAtt.check_in_at).toLocaleTimeString()}.`,
            isDuplicate: true,
          },
          { status: 409 }
        );
      }
      if (parsed.data.qrMode === 'OUT' && existingAtt.check_out_at) {
        return NextResponse.json(
          {
            error: `Duplicate Scan Prevented: ${student.name_en} (${student.admission_number}) has already checked OUT today at ${new Date(existingAtt.check_out_at).toLocaleTimeString()}.`,
            isDuplicate: true,
          },
          { status: 409 }
        );
      }
    }

    const nowIso = new Date().toISOString();
    let checkInAt = existingAtt?.check_in_at ?? null;
    let checkOutAt = existingAtt?.check_out_at ?? null;

    if (parsed.data.source === 'qr_gate') {
      if (parsed.data.qrMode === 'OUT') {
        checkOutAt = nowIso;
        if (!checkInAt) checkInAt = nowIso;
      } else {
        checkInAt = nowIso;
      }
    } else if ((parsed.data.status === 'Present' || parsed.data.status === 'Late') && !checkInAt) {
      checkInAt = nowIso;
    }

    const { data: savedRow, error: attErr } = await db
      .from('student_attendance')
      .upsert(
        {
          school_id: context.school.id,
          student_id: student.id,
          class_id: student.class_id ?? null,
          section_id: student.section_id ?? null,
          attendance_date: parsed.data.date,
          status: parsed.data.status,
          source: parsed.data.source,
          check_in_at: checkInAt,
          check_out_at: checkOutAt,
          marked_by: context.userId,
        },
        { onConflict: 'school_id,student_id,attendance_date' }
      )
      .select('*')
      .single();

    if (attErr) {
      return NextResponse.json({ error: attErr.message }, { status: 400 });
    }

    const recipientUserId: string | null = student.user_id ?? null;
    if (recipientUserId) {
      await ensurePublicUserProfile(db, recipientUserId, student.student_email, student.name_en);
    }

    const actionLabel =
      parsed.data.source === 'qr_gate'
        ? `Gate ${parsed.data.qrMode || 'IN'} (${parsed.data.status})`
        : parsed.data.status;

    await db.from('notifications').insert({
      school_id: context.school.id,
      recipient_user_id: recipientUserId,
      target_audience: 'Students',
      category: 'attendance',
      title: `Attendance: ${student.name_en} — ${actionLabel}`,
      body: `${student.name_en} (${student.admission_number}) was marked ${actionLabel} on ${parsed.data.date}.`,
      metadata: {
        student_id: student.id,
        class_id: student.class_id ?? null,
        section_id: student.section_id ?? null,
        attendance_date: parsed.data.date,
        status: parsed.data.status,
        source: parsed.data.source,
      },
      is_read: false,
    });

    return NextResponse.json({
      success: true,
      attendance: savedRow,
      studentName: student.name_en,
      appLinked: Boolean(student.user_id && student.app_access_enabled && !student.app_blocked),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to save attendance.' },
      { status: 500 }
    );
  }
}