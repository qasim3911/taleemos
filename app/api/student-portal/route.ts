import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getStudentPortalContext } from '@/lib/auth/student-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { generateMonthlyChallansForSchool } from '@/lib/fees/auto-challan';
import {
  countDaysInclusive,
  createStudentLeaveRequest,
  normalizeLeaveStatus,
} from '@/lib/leaves/leave-service';
import { getSchoolHolidayContext } from '@/lib/attendance/holidays';
import {
  COMPLAINT_PRIORITIES,
  createComplaintRecord,
  listUserComplaints,
  replyToComplaintRecord,
} from '@/lib/complaints/complaint-service';
import {
  isLeaveRelatedTicketOrComplaint,
  parseSupportTicketLeaveDetails,
} from '@/lib/leaves/leave-ticket-utils';

const StudentLeaveSchema = z.object({
  action: z.literal('submit_leave').optional(),
  leaveType: z.string().trim().min(2).max(50).default('Casual'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(800),
});

const StudentComplaintSchema = z.discriminatedUnion('action', [
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
]);

export async function GET() {
  const authResult = await getStudentPortalContext();
  if (authResult.status === 'unconfigured') {
    return NextResponse.json({ error: 'Supabase not configured.' }, { status: 503 });
  }
  if (authResult.status === 'unauthenticated') {
    return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });
  }
  if (authResult.status === 'not_student') {
    return NextResponse.json({ error: 'No student profile linked to this account.' }, { status: 404 });
  }
  if (authResult.status === 'access_disabled') {
    return NextResponse.json({ error: authResult.reason }, { status: 403 });
  }

  const { context } = authResult;
  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

  try {
    await generateMonthlyChallansForSchool({
      db,
      schoolId: context.school.id,
      performedBy: context.userId,
      force: false,
      studentIds: [context.student.id],
    });
  } catch {
    // Non-blocking auto-sync check
  }

  const [
    { data: vouchers },
    { data: payments },
    { data: attendance },
    { data: exams },
    { data: marks },
    { data: subjects },
    { data: notifications },
    { data: rawLeaveNotifs },
    { data: rawTicketLeaves },
    holidayContext,
    complaints,
  ] = await Promise.all([
    db
      .from('fee_vouchers')
      .select('*')
      .eq('school_id', context.school.id)
      .eq('student_id', context.student.id)
      .order('billing_month', { ascending: false })
      .order('created_at', { ascending: false }),
    db
      .from('fee_payments')
      .select('*')
      .eq('school_id', context.school.id)
      .eq('student_id', context.student.id)
      .order('paid_at', { ascending: false }),
    db
      .from('student_attendance')
      .select('*')
      .eq('school_id', context.school.id)
      .eq('student_id', context.student.id)
      .order('attendance_date', { ascending: false })
      .limit(40),
    db
      .from('exams')
      .select('id, title, exam_type, start_date, end_date, is_published, published_at')
      .eq('school_id', context.school.id)
      .eq('is_published', true)
      .order('start_date', { ascending: false }),
    db
      .from('exam_marks')
      .select('*')
      .eq('school_id', context.school.id)
      .eq('student_id', context.student.id),
    db
      .from('subjects')
      .select('id, name')
      .eq('school_id', context.school.id),
    db
      .from('notifications')
      .select('*')
      .eq('school_id', context.school.id)
      .or(`recipient_user_id.eq.${context.userId},and(recipient_user_id.is.null,target_audience.in.(Students,students,All,all))`)
      .order('created_at', { ascending: false })
      .limit(50),
    db
      .from('leave_requests')
      .select('*')
      .eq('school_id', context.school.id)
      .eq('student_id', context.student.id)
      .order('created_at', { ascending: false })
      .limit(30),
    db
      .from('support_tickets')
      .select('id, category, subject, description, status, created_at')
      .eq('school_id', context.school.id)
      .eq('student_id', context.student.id)
      .order('created_at', { ascending: false })
      .limit(30),
    getSchoolHolidayContext(db, context.school.id),
    listUserComplaints(db, context.school.id, context.userId),
  ]);

  const publishedExamIds = new Set((exams ?? []).map((e) => e.id));
  const publishedMarks = (marks ?? []).filter((m) => publishedExamIds.has(m.exam_id));

  const leaveRequests = [
    ...(rawLeaveNotifs ?? []).map((row) => {
      const startDate = String(row.start_date || '').slice(0, 10);
      const endDate = String(row.end_date || startDate).slice(0, 10);
      const leaveTypeRaw = String(row.leave_type || 'Casual').trim();
      const leaveType = leaveTypeRaw
        ? leaveTypeRaw.charAt(0).toUpperCase() + leaveTypeRaw.slice(1)
        : 'Casual';
      return {
        id: row.id as string,
        leaveType,
        startDate,
        endDate,
        totalDays: countDaysInclusive(startDate, endDate),
        reason: String(row.reason || '—'),
        status: normalizeLeaveStatus(row.status),
        reviewerNote: (row.review_note as string | null) ?? null,
        reviewedAt: null,
        createdAt: String(row.created_at),
      };
    }),
    ...(rawTicketLeaves ?? [])
      .filter((t) => isLeaveRelatedTicketOrComplaint(t))
      .map((t) => {
        const parsed = parseSupportTicketLeaveDetails(t);
        return {
          id: t.id as string,
          leaveType: parsed.leaveType,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          totalDays: countDaysInclusive(parsed.startDate, parsed.endDate),
          reason: parsed.reason,
          status: normalizeLeaveStatus(t.status),
          reviewerNote: null,
          reviewedAt: null,
          createdAt: String(t.created_at),
        };
      }),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({
    student: context.student,
    school: context.school,
    vouchers: vouchers ?? [],
    payments: payments ?? [],
    attendance: attendance ?? [],
    exams: exams ?? [],
    marks: publishedMarks,
    subjects: subjects ?? [],
    notifications: notifications ?? [],
    leaveRequests,
    complaints,
    workingDays: holidayContext.workingDays,
    holidays: holidayContext.holidays,
  });
}

export async function POST(request: Request) {
  const authResult = await getStudentPortalContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized student session.' }, { status: 403 });
  }

  const { context } = authResult;
  try {
    const body = await request.json();
    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    if (body?.action === 'submit_complaint' || body?.action === 'reply_complaint') {
      const parsedComp = StudentComplaintSchema.safeParse(body);
      if (!parsedComp.success) {
        return NextResponse.json(
          { error: parsedComp.error.issues[0]?.message || 'Invalid complaint payload.' },
          { status: 400 }
        );
      }

      if (parsedComp.data.action === 'submit_complaint') {
        const result = await createComplaintRecord({
          db,
          schoolId: context.school.id,
          submittedByUserId: context.userId,
          submitterEmail: context.student.student_email,
          submitterType: 'student',
          submitterName: context.student.name_en,
          category: parsedComp.data.category,
          priority: parsedComp.data.priority,
          subject: parsedComp.data.subject,
          description: parsedComp.data.description,
        });
        if (result.error) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        return NextResponse.json({ success: true, complaint: result.complaint }, { status: 201 });
      }

      const result = await replyToComplaintRecord({
        db,
        schoolId: context.school.id,
        complaintId: parsedComp.data.complaintId,
        senderUserId: context.userId,
        senderEmail: context.student.student_email,
        senderName: context.student.name_en,
        message: parsedComp.data.message,
        notifySubmitter: false,
      });
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ success: true, reply: result.reply }, { status: 201 });
    }

    const parsed = StudentLeaveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Please select leave dates and provide a valid reason.' },
        { status: 400 }
      );
    }

    const result = await createStudentLeaveRequest({
      db,
      schoolId: context.school.id,
      studentId: context.student.id,
      leaveType: parsed.data.leaveType,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      reason: parsed.data.reason,
      initialStatus: 'Pending',
      reviewerUserId: null,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, leave: result.leave }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to submit request.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const authResult = await getStudentPortalContext();
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
