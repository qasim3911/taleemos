import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { ensurePublicUserProfile } from '@/lib/auth/ensure-user-profile';

const SupportActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_ticket'),
    category: z.string().trim().min(1).max(80).default('technical'),
    subject: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(4000),
    priority: z.string().trim().min(1).max(40).default('medium'),
  }),
  z.object({
    action: z.literal('reply'),
    ticketId: z.string().uuid(),
    message: z.string().trim().min(1).max(2000),
    status: z.enum(['Open', 'In Progress', 'Resolved', 'Closed']).optional(),
  }),
  z.object({
    action: z.literal('update_status'),
    ticketId: z.string().uuid(),
    status: z.enum(['Open', 'In Progress', 'Resolved', 'Closed']),
  }),
]);

function canAccessSupport(member: Parameters<typeof hasModulePermission>[0]) {
  return hasModulePermission(member, 'support') || hasModulePermission(member, 'communication');
}

export async function GET(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!canAccessSupport(context.member)) {
    return NextResponse.json({ error: 'Insufficient permissions for Help & Support.' }, { status: 403 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const schoolId = context.school.id;

  const url = new URL(request.url);
  const ticketId = url.searchParams.get('ticketId');

  if (ticketId) {
    const { data: ticket } = await db
      .from('support_tickets')
      .select('id')
      .eq('id', ticketId)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    }

    const { data: messages, error: msgErr } = await db
      .from('support_ticket_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .eq('school_id', schoolId)
      .order('created_at', { ascending: true });

    if (msgErr) {
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }
    return NextResponse.json({ messages: messages ?? [] });
  }

  const [{ data: tickets, error: tErr }, { data: students }, { data: classes }, { data: sections }] =
    await Promise.all([
      db
        .from('support_tickets')
        .select('*')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false })
        .limit(300),
      db
        .from('students')
        .select('id, name_en, admission_number, class_id, section_id')
        .eq('school_id', schoolId),
      db.from('classes').select('id, name').eq('school_id', schoolId),
      db.from('sections').select('id, name').eq('school_id', schoolId),
    ]);

  if (tErr) {
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }

  const classMap = new Map((classes ?? []).map((c) => [c.id as string, c.name as string]));
  const sectionMap = new Map((sections ?? []).map((s) => [s.id as string, s.name as string]));
  const studentMap = new Map((students ?? []).map((s) => [s.id as string, s]));

  const enrichedTickets = (tickets ?? []).map((t) => {
    const stu = t.student_id ? studentMap.get(t.student_id as string) : undefined;
    const className = stu?.class_id ? classMap.get(stu.class_id as string) ?? null : null;
    const sectionName = stu?.section_id ? sectionMap.get(stu.section_id as string) ?? null : null;
    return {
      ...t,
      source_type: t.student_id ? 'student_app' : 'school_support',
      student_name: stu?.name_en ?? null,
      student_admission_number: stu?.admission_number ?? null,
      student_class_label: className
        ? `${className}${sectionName ? ` (${sectionName})` : ''}`
        : null,
    };
  });

  return NextResponse.json({ tickets: enrichedTickets });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!canAccessSupport(context.member)) {
    return NextResponse.json({ error: 'Insufficient permissions for Help & Support.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = SupportActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid support request payload.' }, { status: 400 });
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    const schoolId = context.school.id;
    const input = parsed.data;

    await ensurePublicUserProfile(db, context.userId, context.userEmail, context.member.full_name);

    if (input.action === 'create_ticket') {
      const ticketNo = `TKT-${Date.now().toString().slice(-6)}`;
      const { data: ticket, error } = await db
        .from('support_tickets')
        .insert({
          school_id: schoolId,
          ticket_number: ticketNo,
          category: input.category,
          subject: input.subject,
          description: input.description,
          priority: input.priority,
          status: 'Open',
          attachments: [],
          created_by: context.userId,
        })
        .select('*')
        .single();

      if (error || !ticket) {
        return NextResponse.json(
          { error: error?.message || 'Unable to create support ticket.' },
          { status: 400 }
        );
      }

      await db.from('support_ticket_messages').insert({
        ticket_id: ticket.id,
        school_id: schoolId,
        sender_role: 'school_owner',
        sender_name: context.school.name_en,
        sender_user_id: context.userId,
        message: input.description,
        attachments: [],
      });

      return NextResponse.json({ success: true, ticket }, { status: 201 });
    }

    const { data: existingTicket, error: tErr } = await db
      .from('support_tickets')
      .select('*')
      .eq('id', input.ticketId)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (tErr || !existingTicket) {
      return NextResponse.json({ error: 'Support ticket not found.' }, { status: 404 });
    }

    const nowIso = new Date().toISOString();

    if (input.action === 'reply') {
      const { data: msgRow, error: mErr } = await db
        .from('support_ticket_messages')
        .insert({
          ticket_id: input.ticketId,
          school_id: schoolId,
          sender_role: 'school_owner',
          sender_name: context.member.full_name || context.school.name_en,
          sender_user_id: context.userId,
          message: input.message,
          attachments: [],
          created_at: nowIso,
        })
        .select('*')
        .single();

      if (mErr || !msgRow) {
        return NextResponse.json({ error: mErr?.message || 'Unable to send reply.' }, { status: 400 });
      }

      const nextStatus =
        input.status ??
        (String(existingTicket.status || '').toLowerCase() === 'open'
          ? 'In Progress'
          : existingTicket.status);

      await db
        .from('support_tickets')
        .update({ status: nextStatus, updated_at: nowIso })
        .eq('id', input.ticketId)
        .eq('school_id', schoolId);

      if (existingTicket.student_id) {
        const { data: stu } = await db
          .from('students')
          .select('user_id')
          .eq('id', existingTicket.student_id)
          .eq('school_id', schoolId)
          .maybeSingle();

        if (stu?.user_id) {
          await db.from('notifications').insert({
            school_id: schoolId,
            recipient_user_id: stu.user_id,
            target_audience: 'Students',
            category: 'complaints',
            title: `Reply on Support Message: ${existingTicket.subject || existingTicket.ticket_number}`,
            body: `${context.member.full_name || 'School Admin'} replied: ${input.message.slice(0, 140)}`,
            metadata: {
              ticket_id: input.ticketId,
              ticket_number: existingTicket.ticket_number,
              status: nextStatus,
            },
            is_read: false,
          });
        }
      }

      return NextResponse.json({ success: true, message: msgRow, status: nextStatus });
    }

    const { error: uErr } = await db
      .from('support_tickets')
      .update({ status: input.status, updated_at: nowIso })
      .eq('id', input.ticketId)
      .eq('school_id', schoolId);

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 400 });
    }

    if (existingTicket.student_id) {
      const { data: stu } = await db
        .from('students')
        .select('user_id')
        .eq('id', existingTicket.student_id)
        .eq('school_id', schoolId)
        .maybeSingle();

      if (stu?.user_id) {
        await db.from('notifications').insert({
          school_id: schoolId,
          recipient_user_id: stu.user_id,
          target_audience: 'Students',
          category: 'complaints',
          title: `Support Message Updated: ${existingTicket.subject || existingTicket.ticket_number}`,
          body: `Your support message status has been updated to "${input.status}".`,
          metadata: { ticket_id: input.ticketId, status: input.status },
          is_read: false,
        });
      }
    }

    return NextResponse.json({ success: true, status: input.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to process support request.' },
      { status: 500 }
    );
  }
}
