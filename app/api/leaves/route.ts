import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { ensurePublicUserProfile } from '@/lib/auth/ensure-user-profile';
import {
  createStudentLeaveRequest,
  createTeacherLeaveRequest,
  listSchoolLeaveRequests,
  reviewLeaveRequest,
} from '@/lib/leaves/leave-service';

const CreateLeaveSchema = z.object({
  requesterType: z.enum(['Student', 'Teacher']),
  requesterId: z.string().uuid(),
  leaveType: z.string().trim().min(2).max(50).default('Casual'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(2).max(1000),
  initialStatus: z.enum(['Pending', 'Approved']).default('Pending'),
});

const ReviewLeaveSchema = z.object({
  id: z.string().uuid(),
  source: z.enum([
    'staff_leave',
    'student_leave',
    'complaint_leave',
    'support_ticket_leave',
    'notification_leave',
  ]),
  decision: z.enum(['Approved', 'Rejected']),
  reviewerNote: z.string().trim().max(500).optional().nullable(),
});

export async function GET() {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (
    !hasModulePermission(context.member, 'attendance') &&
    !hasModulePermission(context.member, 'staff') &&
    !hasModulePermission(context.member, 'students')
  ) {
    return NextResponse.json({ error: 'Insufficient permissions for Leave Requests.' }, { status: 403 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

  const [leaves, { data: students }, { data: teachers }] = await Promise.all([
    listSchoolLeaveRequests(db, context.school.id),
    db
      .from('students')
      .select('id, admission_number, name_en')
      .eq('school_id', context.school.id)
      .in('status', ['active', 'Active'])
      .order('name_en'),
    db
      .from('teachers')
      .select('id, employee_code, full_name, designation')
      .eq('school_id', context.school.id)
      .in('status', ['active', 'Active'])
      .order('full_name'),
  ]);

  let pending = 0;
  let approved = 0;
  let rejected = 0;
  let studentPending = 0;
  let teacherPending = 0;

  for (const l of leaves) {
    if (l.status === 'Pending') {
      pending += 1;
      if (l.requesterType === 'Student') studentPending += 1;
      else teacherPending += 1;
    } else if (l.status === 'Approved') {
      approved += 1;
    } else {
      rejected += 1;
    }
  }

  return NextResponse.json({
    leaves,
    students: students ?? [],
    teachers: teachers ?? [],
    summary: {
      total: leaves.length,
      pending,
      approved,
      rejected,
      studentPending,
      teacherPending,
    },
  });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (
    !hasModulePermission(context.member, 'attendance') &&
    !hasModulePermission(context.member, 'staff') &&
    !hasModulePermission(context.member, 'students')
  ) {
    return NextResponse.json({ error: 'Insufficient permissions for Leave Requests.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = CreateLeaveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Please fill in valid leave dates, requester, and reason.' },
        { status: 400 }
      );
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    await ensurePublicUserProfile(db, context.userId, context.userEmail, context.member.full_name);

    const input = parsed.data;
    const result =
      input.requesterType === 'Student'
        ? await createStudentLeaveRequest({
            db,
            schoolId: context.school.id,
            studentId: input.requesterId,
            leaveType: input.leaveType,
            startDate: input.startDate,
            endDate: input.endDate,
            reason: input.reason,
            initialStatus: input.initialStatus,
            reviewerUserId: context.userId,
          })
        : await createTeacherLeaveRequest({
            db,
            schoolId: context.school.id,
            teacherId: input.requesterId,
            leaveType: input.leaveType,
            startDate: input.startDate,
            endDate: input.endDate,
            reason: input.reason,
            initialStatus: input.initialStatus,
            reviewerUserId: context.userId,
          });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, leave: result.leave }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to submit leave request.' },
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
    !hasModulePermission(context.member, 'attendance') &&
    !hasModulePermission(context.member, 'staff')
  ) {
    return NextResponse.json({ error: 'Insufficient permissions to approve or reject leave.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = ReviewLeaveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid leave review payload.' }, { status: 400 });
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    await ensurePublicUserProfile(db, context.userId, context.userEmail, context.member.full_name);

    const result = await reviewLeaveRequest({
      db,
      schoolId: context.school.id,
      source: parsed.data.source,
      id: parsed.data.id,
      decision: parsed.data.decision,
      reviewerUserId: context.userId,
      reviewerNote: parsed.data.reviewerNote,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await db.from('audit_logs').insert({
      school_id: context.school.id,
      user_id: context.userId,
      action: `LEAVE_${parsed.data.decision.toUpperCase()}`,
      table_name: parsed.data.source,
      record_id: parsed.data.id,
      new_values: { decision: parsed.data.decision, note: parsed.data.reviewerNote || null },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to review leave request.' },
      { status: 500 }
    );
  }
}
