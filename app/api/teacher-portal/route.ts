import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTeacherPortalContext } from '@/lib/auth/teacher-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import {
  countDaysInclusive,
  createTeacherLeaveRequest,
  normalizeLeaveStatus,
} from '@/lib/leaves/leave-service';
import { getSchoolHolidayContext } from '@/lib/attendance/holidays';
import { computeExamGrade } from '@/lib/exams/grading';
import {
  COMPLAINT_PRIORITIES,
  createComplaintRecord,
  listUserComplaints,
  replyToComplaintRecord,
} from '@/lib/complaints/complaint-service';

const TeacherPostSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('apply_leave'),
    leaveType: z.string().trim().min(2).max(50).default('Casual'),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().min(3).max(800),
  }),
  z.object({
    action: z.literal('mark_student_attendance'),
    attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    records: z
      .array(
        z.object({
          studentId: z.string().uuid(),
          classId: z.string().uuid().optional().nullable(),
          sectionId: z.string().uuid().optional().nullable(),
          status: z.enum(['Present', 'Absent', 'Late', 'Leave']),
        })
      )
      .min(1),
  }),
  z.object({
    action: z.literal('create_homework'),
    classId: z.string().uuid(),
    sectionId: z.string().uuid().optional().nullable(),
    subjectId: z.string().uuid(),
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(2000).optional(),
    homeworkDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    action: z.literal('save_exam_marks'),
    examId: z.string().uuid(),
    subjectId: z.string().uuid(),
    totalMarks: z.coerce.number().min(1).max(1000).default(100),
    passingMarks: z.coerce.number().min(0).max(1000).default(33),
    entries: z
      .array(
        z.object({
          studentId: z.string().uuid(),
          obtainedMarks: z.coerce.number().min(0).max(1000),
          attendanceStatus: z.enum(['Present', 'Absent']).default('Present'),
          remarks: z.string().optional().nullable(),
        })
      )
      .min(1),
  }),
  z.object({
    action: z.literal('submit_complaint'),
    category: z.string().trim().min(2).max(80),
    priority: z.enum(COMPLAINT_PRIORITIES).default('normal'),
    subject: z.string().trim().min(3).max(200),
    description: z.string().trim().min(5).max(2000),
  }),
  z.object({
    action: z.literal('reply_complaint'),
    complaintId: z.string().uuid(),
    message: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal('request_school_leaving'),
    reason: z.string().trim().min(3).max(1000),
  }),
]);

export async function GET() {
  const authResult = await getTeacherPortalContext();
  if (authResult.status === 'unconfigured') {
    return NextResponse.json({ error: 'Supabase not configured.' }, { status: 503 });
  }
  if (authResult.status === 'unauthenticated') {
    return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });
  }
  if (authResult.status === 'not_teacher') {
    return NextResponse.json({ error: 'No teacher profile linked to this account.' }, { status: 404 });
  }
  if (authResult.status === 'access_disabled') {
    return NextResponse.json({ error: authResult.reason }, { status: 403 });
  }

  const { context } = authResult;
  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const assignedClassIds = Array.from(
    new Set(context.assignments.map((a) => a.class_id).filter(Boolean))
  );

  let studentsQuery = db
    .from('students')
    .select('id, admission_number, roll_number, name_en, class_id, section_id, status')
    .eq('school_id', context.school.id)
    .not('status', 'in', '("Archived","archived","withdrawn","transferred")')
    .order('name_en');

  if (assignedClassIds.length > 0) {
    studentsQuery = studentsQuery.in('class_id', assignedClassIds);
  }

  const [
    { data: students },
    { data: classes },
    { data: sections },
    { data: subjects },
    { data: studentAttendance },
    { data: teacherAttendance },
    { data: salarySlips },
    { data: rawLeaves },
    { data: homework },
    { data: exams },
    { data: marks },
    { data: notifications },
    holidayContext,
    complaints,
  ] = await Promise.all([
    studentsQuery,
    db.from('classes').select('id, name').eq('school_id', context.school.id).order('level_order'),
    db.from('sections').select('id, name, class_id').eq('school_id', context.school.id).order('name'),
    db.from('subjects').select('id, name').eq('school_id', context.school.id).order('name'),
    db
      .from('student_attendance')
      .select('id, student_id, class_id, section_id, attendance_date, status, source')
      .eq('school_id', context.school.id)
      .order('attendance_date', { ascending: false })
      .limit(200),
    db
      .from('teacher_attendance')
      .select('*')
      .eq('school_id', context.school.id)
      .eq('teacher_id', context.teacher.id)
      .order('attendance_date', { ascending: false })
      .limit(45),
    db
      .from('salary_slips')
      .select('*')
      .eq('school_id', context.school.id)
      .eq('teacher_id', context.teacher.id)
      .order('payroll_month', { ascending: false }),
    db
      .from('staff_leave_records')
      .select('*')
      .eq('school_id', context.school.id)
      .eq('teacher_id', context.teacher.id)
      .order('created_at', { ascending: false })
      .limit(30),
    db
      .from('homework_assignments')
      .select('*')
      .eq('school_id', context.school.id)
      .order('due_date', { ascending: false })
      .limit(50),
    db
      .from('exams')
      .select('id, title, exam_type, start_date, is_published')
      .eq('school_id', context.school.id)
      .order('start_date', { ascending: false }),
    db
      .from('exam_marks')
      .select('*')
      .eq('school_id', context.school.id),
    db
      .from('notifications')
      .select('*')
      .eq('school_id', context.school.id)
      .or(
        `recipient_user_id.eq.${context.userId},and(recipient_user_id.is.null,target_audience.in.(Teachers,teachers,Staff,staff,All,all))`
      )
      .order('created_at', { ascending: false })
      .limit(50),
    getSchoolHolidayContext(db, context.school.id),
    listUserComplaints(db, context.school.id, context.userId),
  ]);

  const leaveRequests = (rawLeaves ?? []).map((row) => {
    const startDate = String(row.start_date || '').slice(0, 10);
    const endDate = String(row.end_date || startDate).slice(0, 10);
    const leaveTypeRaw = String(row.leave_type || 'Casual').trim();
    return {
      id: String(row.id),
      leaveType: leaveTypeRaw ? leaveTypeRaw.charAt(0).toUpperCase() + leaveTypeRaw.slice(1) : 'Casual',
      startDate,
      endDate,
      totalDays: countDaysInclusive(startDate, endDate),
      reason: String(row.reason || '—'),
      status: normalizeLeaveStatus(row.status),
      reviewerNote: (row.reviewer_note as string | null) ?? null,
      createdAt: String(row.created_at),
    };
  });

  return NextResponse.json({
    teacher: context.teacher,
    school: context.school,
    hasSchoolAdminAccess: context.hasSchoolAdminAccess,
    assignments: context.assignments,
    students: students ?? [],
    classes: classes ?? [],
    sections: sections ?? [],
    subjects: subjects ?? [],
    studentAttendance: studentAttendance ?? [],
    teacherAttendance: teacherAttendance ?? [],
    salarySlips: salarySlips ?? [],
    leaveRequests,
    homework: homework ?? [],
    exams: exams ?? [],
    marks: marks ?? [],
    notifications: notifications ?? [],
    complaints,
    workingDays: holidayContext.workingDays,
    holidays: holidayContext.holidays,
  });
}

export async function POST(request: Request) {
  const authResult = await getTeacherPortalContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized teacher session.' }, { status: 403 });
  }

  const { context } = authResult;
  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

  try {
    const body = await request.json();
    const parsed = TeacherPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid request payload.' },
        { status: 400 }
      );
    }

    const input = parsed.data;

    if (input.action === 'apply_leave') {
      const result = await createTeacherLeaveRequest({
        db,
        schoolId: context.school.id,
        teacherId: context.teacher.id,
        leaveType: input.leaveType,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason,
        initialStatus: 'Pending',
        reviewerUserId: null,
      });
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ success: true, leave: result.leave }, { status: 201 });
    }

    if (input.action === 'mark_student_attendance') {
      const rows = input.records.map((r) => ({
        school_id: context.school.id,
        student_id: r.studentId,
        class_id: r.classId || null,
        section_id: r.sectionId || null,
        attendance_date: input.attendanceDate,
        status: r.status,
        source: 'teacher_app',
        marked_by: context.userId,
      }));

      const { error } = await db
        .from('student_attendance')
        .upsert(rows, { onConflict: 'school_id,student_id,attendance_date' });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, count: rows.length });
    }

    if (input.action === 'create_homework') {
      const todayIsoDate = new Date().toISOString().slice(0, 10);
      const hwDate = input.homeworkDate || todayIsoDate;
      const { error } = await db.from('homework_assignments').insert({
        school_id: context.school.id,
        class_id: input.classId,
        section_id: input.sectionId || null,
        subject_id: input.subjectId,
        teacher_id: context.teacher.id,
        title: input.title,
        description: input.description || null,
        due_date: input.dueDate,
        created_at:
          hwDate === todayIsoDate ? new Date().toISOString() : `${hwDate}T08:00:00.000Z`,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true }, { status: 201 });
    }

    if (input.action === 'submit_complaint') {
      const result = await createComplaintRecord({
        db,
        schoolId: context.school.id,
        submittedByUserId: context.userId,
        submitterEmail: context.teacher.email,
        submitterType: 'teacher',
        submitterName: context.teacher.full_name,
        category: input.category,
        priority: input.priority,
        subject: input.subject,
        description: input.description,
      });
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ success: true, complaint: result.complaint }, { status: 201 });
    }

    if (input.action === 'reply_complaint') {
      const result = await replyToComplaintRecord({
        db,
        schoolId: context.school.id,
        complaintId: input.complaintId,
        senderUserId: context.userId,
        senderEmail: context.teacher.email,
        senderName: context.teacher.full_name,
        message: input.message,
        notifySubmitter: false,
      });
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ success: true, reply: result.reply }, { status: 201 });
    }

    if (input.action === 'request_school_leaving') {
      const { error } = await db
        .from('teachers')
        .update({
          status: 'left_school',
          app_access_enabled: false,
          app_blocked: true,
        })
        .eq('id', context.teacher.id)
        .eq('school_id', context.school.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      await createComplaintRecord({
        db,
        schoolId: context.school.id,
        submittedByUserId: context.userId,
        submitterEmail: context.teacher.email,
        submitterType: 'teacher',
        submitterName: context.teacher.full_name,
        category: 'Teacher Resignation / Leaving School',
        priority: 'high',
        subject: `Teacher School Leaving Request: ${context.teacher.full_name} (${context.teacher.employee_code})`,
        description: input.reason,
      });

      return NextResponse.json({ success: true, message: 'School leaving request submitted successfully.' });
    }

    const nowIso = new Date().toISOString();
    const markRows = input.entries.map((entry) => {
      const effectiveObtained =
        entry.attendanceStatus === 'Absent'
          ? 0
          : Math.min(entry.obtainedMarks, input.totalMarks);
      return {
        school_id: context.school.id,
        exam_id: input.examId,
        student_id: entry.studentId,
        subject_id: input.subjectId,
        total_marks: input.totalMarks,
        passing_marks: Math.min(input.passingMarks, input.totalMarks),
        obtained_marks: effectiveObtained,
        attendance_status: entry.attendanceStatus,
        grade:
          entry.attendanceStatus === 'Absent'
            ? 'Absent'
            : computeExamGrade(effectiveObtained, input.totalMarks),
        remarks: entry.remarks || null,
        entered_by: context.userId,
        updated_at: nowIso,
      };
    });

    const { error } = await db
      .from('exam_marks')
      .upsert(markRows, { onConflict: 'school_id,exam_id,student_id,subject_id' });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: true, count: markRows.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to save teacher portal action.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const authResult = await getTeacherPortalContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 403 });
  }

  const { context } = authResult;
  const body = await request.json().catch(() => ({}));
  const notificationId = typeof body.notificationId === 'string' ? body.notificationId : null;
  if (!notificationId) {
    return NextResponse.json({ error: 'notificationId is required.' }, { status: 400 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  await db
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('school_id', context.school.id)
    .eq('recipient_user_id', context.userId);

  return NextResponse.json({ success: true });
}
