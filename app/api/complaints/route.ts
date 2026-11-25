import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import {
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  createComplaintRecord,
  listSchoolComplaints,
  replyToComplaintRecord,
  updateComplaintOrTicketStatus,
} from '@/lib/complaints/complaint-service';

const ComplaintActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('reply'),
    complaintId: z.string().uuid(),
    message: z.string().trim().min(1).max(2000),
    status: z.enum(COMPLAINT_STATUSES).optional(),
  }),
  z.object({
    action: z.literal('update_status'),
    complaintId: z.string().uuid(),
    status: z.enum(COMPLAINT_STATUSES),
  }),
  z.object({
    action: z.literal('create'),
    submitterType: z.enum(['teacher', 'student', 'admin']).default('admin'),
    submitterName: z.string().trim().min(2).max(120),
    category: z.string().trim().min(2).max(80),
    priority: z.enum(COMPLAINT_PRIORITIES).default('normal'),
    subject: z.string().trim().min(2).max(200),
    description: z.string().trim().min(3).max(2000),
  }),
]);

export async function GET() {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (
    !hasModulePermission(context.member, 'communication') &&
    !hasModulePermission(context.member, 'support')
  ) {
    return NextResponse.json({ error: 'Insufficient permissions for Complaints.' }, { status: 403 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const data = await listSchoolComplaints(db, context.school.id);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (
    !hasModulePermission(context.member, 'communication') &&
    !hasModulePermission(context.member, 'support')
  ) {
    return NextResponse.json({ error: 'Insufficient permissions for Complaints.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = ComplaintActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid complaint request payload.' }, { status: 400 });
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    const input = parsed.data;

    if (input.action === 'create') {
      const result = await createComplaintRecord({
        db,
        schoolId: context.school.id,
        submittedByUserId: context.userId,
        submitterEmail: context.member.email,
        submitterType: input.submitterType,
        submitterName: input.submitterName,
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

    if (input.action === 'reply') {
      const result = await replyToComplaintRecord({
        db,
        schoolId: context.school.id,
        complaintId: input.complaintId,
        senderUserId: context.userId,
        senderEmail: context.member.email,
        senderName: context.member.full_name || 'School Admin',
        message: input.message,
        nextStatus: input.status,
        notifySubmitter: true,
      });

      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ success: true, reply: result.reply, status: result.status });
    }

    const statusResult = await updateComplaintOrTicketStatus({
      db,
      schoolId: context.school.id,
      complaintId: input.complaintId,
      status: input.status,
    });

    if (statusResult.error) {
      return NextResponse.json({ error: statusResult.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, status: statusResult.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to process complaint action.' },
      { status: 500 }
    );
  }
}
