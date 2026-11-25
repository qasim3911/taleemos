import type { SupabaseClient } from '@supabase/supabase-js';
import { ensurePublicUserProfile } from '@/lib/auth/ensure-user-profile';
import { isLeaveRelatedTicketOrComplaint } from '@/lib/leaves/leave-ticket-utils';

export const COMPLAINT_CATEGORIES = [
  'Academics & Classroom',
  'Discipline & Behaviour',
  'Transport & Bus',
  'Fees & Accounts',
  'Facilities & Cleanliness',
  'Bullying & Safety',
  'Staff & Administration',
  'App & Technical',
  'Other',
] as const;

export const COMPLAINT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

export const COMPLAINT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export interface ComplaintReplyItem {
  id: string;
  complaintId: string;
  senderUserId: string | null;
  senderName: string;
  message: string;
  createdAt: string;
}

export interface ComplaintItem {
  id: string;
  schoolId: string;
  source?: 'complaint' | 'support_ticket';
  ticketNumber?: string | null;
  submittedByUserId: string | null;
  submitterType: 'teacher' | 'student' | 'admin' | 'other';
  submitterName: string;
  submitterCode: string;
  submitterSubtext: string;
  category: string;
  priority: ComplaintPriority;
  subject: string;
  description: string;
  status: ComplaintStatus;
  createdAt: string;
  updatedAt: string;
  replies: ComplaintReplyItem[];
}

export interface ComplaintSummary {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  teacherCount: number;
  studentCount: number;
}

export function normalizeComplaintStatus(raw?: string | null): ComplaintStatus {
  const s = (raw || 'open').toLowerCase().trim();
  if (s === 'in_progress' || s === 'in progress' || s === 'waiting for school') return 'in_progress';
  if (s === 'resolved') return 'resolved';
  if (s === 'closed') return 'closed';
  return 'open';
}

export function formatSupportTicketStatus(status: ComplaintStatus): string {
  if (status === 'in_progress') return 'In Progress';
  if (status === 'resolved') return 'Resolved';
  if (status === 'closed') return 'Closed';
  return 'Open';
}

export function normalizeComplaintPriority(raw?: string | null): ComplaintPriority {
  const p = (raw || 'normal').toLowerCase().trim();
  if (p === 'low' || p === 'high' || p === 'urgent') return p;
  return 'normal';
}

function isLeaveComplaintRow(row: {
  category?: string | null;
  subject?: string | null;
  description?: string | null;
}) {
  return isLeaveRelatedTicketOrComplaint(row);
}

export async function listSchoolComplaints(
  db: SupabaseClient,
  schoolId: string
): Promise<{ complaints: ComplaintItem[]; summary: ComplaintSummary }> {
  const [
    { data: rows },
    { data: replyRows },
    { data: studentSupportTickets },
    { data: supportMessages },
    { data: teachers },
    { data: students },
    { data: classes },
    { data: sections },
  ] = await Promise.all([
    db
      .from('complaints')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(300),
    db
      .from('complaint_replies')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: true }),
    db
      .from('support_tickets')
      .select('*')
      .eq('school_id', schoolId)
      .not('student_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300),
    db
      .from('support_ticket_messages')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: true }),
    db
      .from('teachers')
      .select('id, employee_code, full_name, designation, department, user_id')
      .eq('school_id', schoolId),
    db
      .from('students')
      .select('id, admission_number, name_en, class_id, section_id, user_id')
      .eq('school_id', schoolId),
    db.from('classes').select('id, name').eq('school_id', schoolId),
    db.from('sections').select('id, name').eq('school_id', schoolId),
  ]);

  const classMap = new Map((classes ?? []).map((c) => [c.id as string, c.name as string]));
  const sectionMap = new Map((sections ?? []).map((s) => [s.id as string, s.name as string]));
  const teacherByUser = new Map(
    (teachers ?? [])
      .filter((t) => Boolean(t.user_id))
      .map((t) => [t.user_id as string, t])
  );
  const studentByUser = new Map(
    (students ?? [])
      .filter((s) => Boolean(s.user_id))
      .map((s) => [s.user_id as string, s])
  );
  const studentById = new Map((students ?? []).map((s) => [s.id as string, s]));

  const repliesByComplaint = new Map<string, ComplaintReplyItem[]>();
  for (const r of replyRows ?? []) {
    const cid = r.complaint_id as string;
    const list = repliesByComplaint.get(cid) ?? [];
    list.push({
      id: r.id as string,
      complaintId: cid,
      senderUserId: (r.sender_user_id as string | null) ?? null,
      senderName: String(r.sender_name || 'School Staff'),
      message: String(r.message || ''),
      createdAt: String(r.created_at),
    });
    repliesByComplaint.set(cid, list);
  }

  const supportMsgsByTicket = new Map<string, ComplaintReplyItem[]>();
  for (const m of supportMessages ?? []) {
    const tid = m.ticket_id as string;
    const list = supportMsgsByTicket.get(tid) ?? [];
    list.push({
      id: m.id as string,
      complaintId: tid,
      senderUserId: (m.sender_user_id as string | null) ?? null,
      senderName: String(m.sender_name || (m.sender_role === 'student' ? 'Student' : 'School Admin')),
      message: String(m.message || ''),
      createdAt: String(m.created_at),
    });
    supportMsgsByTicket.set(tid, list);
  }

  const complaints: ComplaintItem[] = [];
  for (const row of rows ?? []) {
    if (isLeaveComplaintRow(row)) continue;

    const rawType = String(row.submitter_type || '').toLowerCase();
    const userId = (row.submitted_by_user_id as string | null) ?? null;
    const linkedTeacher = userId ? teacherByUser.get(userId) : undefined;
    const linkedStudent = userId ? studentByUser.get(userId) : undefined;

    let submitterType: ComplaintItem['submitterType'] = 'other';
    if (rawType.includes('teacher') || linkedTeacher) submitterType = 'teacher';
    else if (rawType.includes('student') || linkedStudent) submitterType = 'student';
    else if (rawType.includes('admin')) submitterType = 'admin';

    let submitterCode = 'STAFF';
    let submitterSubtext = 'School Member';
    if (submitterType === 'teacher') {
      submitterCode = String(linkedTeacher?.employee_code || 'TEACHER');
      submitterSubtext = linkedTeacher
        ? [linkedTeacher.designation, linkedTeacher.department].filter(Boolean).join(' · ') || 'Teacher'
        : 'Teacher';
    } else if (submitterType === 'student') {
      submitterCode = String(linkedStudent?.admission_number || 'STUDENT');
      const clsName = linkedStudent?.class_id ? classMap.get(linkedStudent.class_id as string) : null;
      const secName = linkedStudent?.section_id ? sectionMap.get(linkedStudent.section_id as string) : null;
      submitterSubtext = clsName
        ? `${clsName}${secName ? ` (${secName})` : ''}`
        : 'Student';
    } else if (submitterType === 'admin') {
      submitterCode = 'ADMIN';
      submitterSubtext = 'School Administration';
    }

    complaints.push({
      id: row.id as string,
      schoolId: row.school_id as string,
      source: 'complaint',
      ticketNumber: null,
      submittedByUserId: userId,
      submitterType,
      submitterName: String(row.submitter_name || linkedTeacher?.full_name || linkedStudent?.name_en || 'User'),
      submitterCode,
      submitterSubtext,
      category: String(row.category || 'Other'),
      priority: normalizeComplaintPriority(row.priority),
      subject: String(row.subject || 'Complaint'),
      description: String(row.description || ''),
      status: normalizeComplaintStatus(row.status),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at || row.created_at),
      replies: repliesByComplaint.get(row.id as string) ?? [],
    });
  }

  for (const t of studentSupportTickets ?? []) {
    if (isLeaveComplaintRow(t)) continue;
    const linkedStudent = t.student_id ? studentById.get(t.student_id as string) : undefined;
    const clsName = linkedStudent?.class_id ? classMap.get(linkedStudent.class_id as string) : null;
    const secName = linkedStudent?.section_id ? sectionMap.get(linkedStudent.section_id as string) : null;
    const classLabel = clsName ? `${clsName}${secName ? ` (${secName})` : ''}` : 'Student App';
    const ticketNo = (t.ticket_number as string | null) ?? null;

    complaints.push({
      id: t.id as string,
      schoolId: t.school_id as string,
      source: 'support_ticket',
      ticketNumber: ticketNo,
      submittedByUserId: (linkedStudent?.user_id as string | null) ?? (t.created_by as string | null) ?? null,
      submitterType: 'student',
      submitterName: String(linkedStudent?.name_en || 'Student'),
      submitterCode: String(linkedStudent?.admission_number || ticketNo || 'STUDENT'),
      submitterSubtext: ticketNo ? `${classLabel} · ${ticketNo}` : classLabel,
      category: String(t.category || 'Student Support'),
      priority: normalizeComplaintPriority(t.priority),
      subject: String(t.subject || ticketNo || 'Student Support Message'),
      description: String(t.description || ''),
      status: normalizeComplaintStatus(t.status),
      createdAt: String(t.created_at),
      updatedAt: String(t.updated_at || t.created_at),
      replies: supportMsgsByTicket.get(t.id as string) ?? [],
    });
  }

  complaints.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const summary: ComplaintSummary = {
    total: complaints.length,
    open: complaints.filter((c) => c.status === 'open').length,
    inProgress: complaints.filter((c) => c.status === 'in_progress').length,
    resolved: complaints.filter((c) => c.status === 'resolved' || c.status === 'closed').length,
    teacherCount: complaints.filter((c) => c.submitterType === 'teacher').length,
    studentCount: complaints.filter((c) => c.submitterType === 'student').length,
  };

  return { complaints, summary };
}

export async function listUserComplaints(
  db: SupabaseClient,
  schoolId: string,
  userId: string
): Promise<ComplaintItem[]> {
  const { data: rows } = await db
    .from('complaints')
    .select('*')
    .eq('school_id', schoolId)
    .eq('submitted_by_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  const validRows = (rows ?? []).filter((r) => !isLeaveComplaintRow(r));
  if (validRows.length === 0) return [];

  const complaintIds = validRows.map((r) => r.id as string);
  const { data: replyRows } = await db
    .from('complaint_replies')
    .select('*')
    .eq('school_id', schoolId)
    .in('complaint_id', complaintIds)
    .order('created_at', { ascending: true });

  const repliesByComplaint = new Map<string, ComplaintReplyItem[]>();
  for (const r of replyRows ?? []) {
    const cid = r.complaint_id as string;
    const list = repliesByComplaint.get(cid) ?? [];
    list.push({
      id: r.id as string,
      complaintId: cid,
      senderUserId: (r.sender_user_id as string | null) ?? null,
      senderName: String(r.sender_name || 'School Admin'),
      message: String(r.message || ''),
      createdAt: String(r.created_at),
    });
    repliesByComplaint.set(cid, list);
  }

  return validRows.map((row) => ({
    id: row.id as string,
    schoolId: row.school_id as string,
    submittedByUserId: (row.submitted_by_user_id as string | null) ?? null,
    submitterType:
      String(row.submitter_type || '').toLowerCase() === 'teacher'
        ? 'teacher'
        : String(row.submitter_type || '').toLowerCase() === 'student'
          ? 'student'
          : 'other',
    submitterName: String(row.submitter_name || 'User'),
    submitterCode: '',
    submitterSubtext: '',
    category: String(row.category || 'Other'),
    priority: normalizeComplaintPriority(row.priority),
    subject: String(row.subject || 'Complaint'),
    description: String(row.description || ''),
    status: normalizeComplaintStatus(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at || row.created_at),
    replies: repliesByComplaint.get(row.id as string) ?? [],
  }));
}

export async function createComplaintRecord(params: {
  db: SupabaseClient;
  schoolId: string;
  submittedByUserId: string | null;
  submitterEmail?: string | null;
  submitterType: 'teacher' | 'student' | 'admin';
  submitterName: string;
  category: string;
  priority: ComplaintPriority;
  subject: string;
  description: string;
}) {
  const { db, schoolId, submittedByUserId } = params;

  if (submittedByUserId) {
    await ensurePublicUserProfile(
      db,
      submittedByUserId,
      params.submitterEmail,
      params.submitterName
    );
  }

  const nowIso = new Date().toISOString();
  const { data: created, error } = await db
    .from('complaints')
    .insert({
      school_id: schoolId,
      submitted_by_user_id: submittedByUserId,
      submitter_type: params.submitterType,
      submitter_name: params.submitterName,
      category: params.category,
      priority: params.priority,
      subject: params.subject,
      description: params.description,
      status: 'open',
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select('*')
    .single();

  if (error || !created) {
    return { error: error?.message || 'Unable to submit complaint.' };
  }

  const roleLabel =
    params.submitterType === 'teacher'
      ? 'Teacher'
      : params.submitterType === 'student'
        ? 'Student'
        : 'Admin';

  await db.from('notifications').insert({
    school_id: schoolId,
    recipient_user_id: null,
    target_audience: 'Admins',
    category: 'complaints',
    title: `New ${roleLabel} Complaint: ${params.subject}`,
    body: `${params.submitterName} (${roleLabel}) filed a ${params.priority} priority complaint in ${params.category}.`,
    metadata: {
      complaint_id: created.id,
      submitter_type: params.submitterType,
      category: params.category,
      priority: params.priority,
    },
    is_read: false,
  });

  return { complaint: created };
}

export async function replyToComplaintRecord(params: {
  db: SupabaseClient;
  schoolId: string;
  complaintId: string;
  senderUserId: string | null;
  senderEmail?: string | null;
  senderName: string;
  message: string;
  nextStatus?: ComplaintStatus;
  notifySubmitter?: boolean;
}) {
  const { db, schoolId, complaintId } = params;

  const { data: existing, error: fetchErr } = await db
    .from('complaints')
    .select('*')
    .eq('id', complaintId)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (existing && !fetchErr) {
    if (params.senderUserId) {
      await ensurePublicUserProfile(
        db,
        params.senderUserId,
        params.senderEmail,
        params.senderName
      );
    }

    const nowIso = new Date().toISOString();
    const { data: replyRow, error: repErr } = await db
      .from('complaint_replies')
      .insert({
        school_id: schoolId,
        complaint_id: complaintId,
        sender_user_id: params.senderUserId,
        sender_name: params.senderName,
        message: params.message,
        created_at: nowIso,
      })
      .select('*')
      .single();

    if (repErr || !replyRow) {
      return { error: repErr?.message || 'Unable to post reply.' };
    }

    const updatedStatus =
      params.nextStatus ??
      (existing.status === 'open' && params.notifySubmitter ? 'in_progress' : existing.status);

    await db
      .from('complaints')
      .update({
        status: updatedStatus,
        updated_at: nowIso,
      })
      .eq('id', complaintId)
      .eq('school_id', schoolId);

    if (params.notifySubmitter && existing.submitted_by_user_id) {
      await db.from('notifications').insert({
        school_id: schoolId,
        recipient_user_id: existing.submitted_by_user_id,
        target_audience:
          String(existing.submitter_type || '').toLowerCase() === 'teacher'
            ? 'Teachers'
            : 'Students',
        category: 'complaints',
        title: `Reply on Complaint: ${existing.subject}`,
        body: `${params.senderName} replied: ${params.message.slice(0, 140)}`,
        metadata: {
          complaint_id: complaintId,
          status: updatedStatus,
        },
        is_read: false,
      });
    }

    return { reply: replyRow, status: updatedStatus };
  }

  // Fallback: handle Student App support_tickets row
  const { data: ticketRow, error: ticketErr } = await db
    .from('support_tickets')
    .select('*')
    .eq('id', complaintId)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (ticketErr || !ticketRow) {
    return { error: 'Complaint or support message not found in your school.' };
  }

  if (params.senderUserId) {
    await ensurePublicUserProfile(
      db,
      params.senderUserId,
      params.senderEmail,
      params.senderName
    );
  }

  const nowIso = new Date().toISOString();
  const { data: msgRow, error: msgErr } = await db
    .from('support_ticket_messages')
    .insert({
      ticket_id: complaintId,
      school_id: schoolId,
      sender_user_id: params.senderUserId,
      sender_role: 'school_owner',
      sender_name: params.senderName,
      message: params.message,
      attachments: [],
      created_at: nowIso,
    })
    .select('*')
    .single();

  if (msgErr || !msgRow) {
    return { error: msgErr?.message || 'Unable to post reply.' };
  }

  const currentNorm = normalizeComplaintStatus(ticketRow.status);
  const nextNorm =
    params.nextStatus ??
    (currentNorm === 'open' && params.notifySubmitter ? 'in_progress' : currentNorm);

  await db
    .from('support_tickets')
    .update({
      status: formatSupportTicketStatus(nextNorm),
      updated_at: nowIso,
    })
    .eq('id', complaintId)
    .eq('school_id', schoolId);

  if (params.notifySubmitter && ticketRow.student_id) {
    const { data: stu } = await db
      .from('students')
      .select('user_id')
      .eq('id', ticketRow.student_id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (stu?.user_id) {
      await db.from('notifications').insert({
        school_id: schoolId,
        recipient_user_id: stu.user_id,
        target_audience: 'Students',
        category: 'complaints',
        title: `Reply on Support Message: ${ticketRow.subject || ticketRow.ticket_number}`,
        body: `${params.senderName} replied: ${params.message.slice(0, 140)}`,
        metadata: {
          ticket_id: complaintId,
          ticket_number: ticketRow.ticket_number,
          status: nextNorm,
        },
        is_read: false,
      });
    }
  }

  return { reply: msgRow, status: nextNorm };
}

export async function updateComplaintOrTicketStatus(params: {
  db: SupabaseClient;
  schoolId: string;
  complaintId: string;
  status: ComplaintStatus;
}) {
  const { db, schoolId, complaintId, status } = params;
  const nowIso = new Date().toISOString();

  const { data: existingComplaint } = await db
    .from('complaints')
    .select('id, subject, submitted_by_user_id, submitter_type')
    .eq('id', complaintId)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (existingComplaint) {
    const { error: upErr } = await db
      .from('complaints')
      .update({ status, updated_at: nowIso })
      .eq('id', complaintId)
      .eq('school_id', schoolId);

    if (upErr) {
      return { error: upErr.message };
    }

    if (existingComplaint.submitted_by_user_id) {
      const statusLabel = status.replace('_', ' ');
      await db.from('notifications').insert({
        school_id: schoolId,
        recipient_user_id: existingComplaint.submitted_by_user_id,
        target_audience:
          String(existingComplaint.submitter_type || '').toLowerCase() === 'teacher'
            ? 'Teachers'
            : 'Students',
        category: 'complaints',
        title: `Complaint Status Updated: ${existingComplaint.subject}`,
        body: `Your complaint status has been updated to "${statusLabel}".`,
        metadata: { complaint_id: complaintId, status },
        is_read: false,
      });
    }

    return { success: true, status };
  }

  const { data: existingTicket } = await db
    .from('support_tickets')
    .select('id, subject, ticket_number, student_id')
    .eq('id', complaintId)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (!existingTicket) {
    return { error: 'Complaint or support message not found in your school.' };
  }

  const { error: tUpErr } = await db
    .from('support_tickets')
    .update({ status: formatSupportTicketStatus(status), updated_at: nowIso })
    .eq('id', complaintId)
    .eq('school_id', schoolId);

  if (tUpErr) {
    return { error: tUpErr.message };
  }

  if (existingTicket.student_id) {
    const { data: stu } = await db
      .from('students')
      .select('user_id')
      .eq('id', existingTicket.student_id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (stu?.user_id) {
      const statusLabel = status.replace('_', ' ');
      await db.from('notifications').insert({
        school_id: schoolId,
        recipient_user_id: stu.user_id,
        target_audience: 'Students',
        category: 'complaints',
        title: `Support Message Updated: ${existingTicket.subject || existingTicket.ticket_number}`,
        body: `Your support message status has been updated to "${statusLabel}".`,
        metadata: { ticket_id: complaintId, status },
        is_read: false,
      });
    }
  }

  return { success: true, status };
}
