import type { SupabaseClient } from '@supabase/supabase-js';
import { ensurePublicUserProfile } from '@/lib/auth/ensure-user-profile';
import { syncMonthlySalarySlipsForSchool } from '@/lib/payroll/auto-salary';
import {
  isLeaveRelatedTicketOrComplaint,
  parseSupportTicketLeaveDetails,
} from '@/lib/leaves/leave-ticket-utils';

export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected';
export type LeaveSource =
  | 'staff_leave'
  | 'student_leave'
  | 'complaint_leave'
  | 'support_ticket_leave'
  | 'notification_leave';

export interface UnifiedLeaveRequest {
  id: string;
  source: LeaveSource;
  requesterType: 'Teacher' | 'Student';
  requesterId: string | null;
  requesterName: string;
  requesterCode: string;
  requesterSubtext: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  reviewerNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export function expandDateRange(startDate: string, endDate: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
  const effectiveEnd =
    /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate >= startDate ? endDate : startDate;

  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${effectiveEnd}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [startDate];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && dates.length < 31) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function countDaysInclusive(startDate: string, endDate: string): number {
  const days = expandDateRange(startDate, endDate).length;
  return days > 0 ? days : 1;
}

export function normalizeLeaveStatus(raw: unknown): LeaveStatus {
  const s = String(raw || 'Pending').trim().toLowerCase();
  if (s === 'approved' || s === 'resolved' || s === 'accepted') return 'Approved';
  if (s === 'rejected' || s === 'closed' || s === 'declined') return 'Rejected';
  return 'Pending';
}

function formatLeaveTypeLabel(raw: unknown): string {
  const val = String(raw || 'Casual').trim();
  if (!val) return 'Casual';
  return val.charAt(0).toUpperCase() + val.slice(1);
}

export async function listSchoolLeaveRequests(
  db: SupabaseClient,
  schoolId: string
): Promise<UnifiedLeaveRequest[]> {
  const [
    { data: staffLeaves },
    { data: studentLeaves },
    { data: teachers },
    { data: students },
    { data: classes },
    { data: sections },
    { data: complaintRows },
    { data: supportTicketRows },
    { data: notifRows },
  ] = await Promise.all([
    db
      .from('staff_leave_records')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(200),
    db
      .from('leave_requests')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(200),
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
    db
      .from('complaints')
      .select('*')
      .eq('school_id', schoolId)
      .or('category.ilike.%leave%,subject.ilike.%leave%')
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('support_tickets')
      .select('*')
      .eq('school_id', schoolId)
      .not('student_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200),
    db
      .from('notifications')
      .select('*')
      .eq('school_id', schoolId)
      .or('category.ilike.%leave%,title.ilike.%leave%')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const teacherMap = new Map((teachers ?? []).map((t) => [t.id as string, t]));
  const teacherByUserMap = new Map(
    (teachers ?? [])
      .filter((t) => Boolean(t.user_id))
      .map((t) => [t.user_id as string, t])
  );
  const studentMap = new Map((students ?? []).map((s) => [s.id as string, s]));
  const studentByUserMap = new Map(
    (students ?? [])
      .filter((s) => Boolean(s.user_id))
      .map((s) => [s.user_id as string, s])
  );
  const classMap = new Map((classes ?? []).map((c) => [c.id as string, c.name as string]));
  const sectionMap = new Map((sections ?? []).map((s) => [s.id as string, s.name as string]));

  const seenStaffLeaveIds = new Set<string>();
  const seenStudentLeaveIds = new Set<string>();

  const unified: UnifiedLeaveRequest[] = [];

  for (const row of staffLeaves ?? []) {
    seenStaffLeaveIds.add(String(row.id));
    const t = teacherMap.get(row.teacher_id as string);
    const startDate = String(row.start_date || '').slice(0, 10);
    const endDate = String(row.end_date || startDate).slice(0, 10);

    unified.push({
      id: row.id as string,
      source: 'staff_leave',
      requesterType: 'Teacher',
      requesterId: (row.teacher_id as string) || null,
      requesterName: t?.full_name || 'Teacher / Staff',
      requesterCode: t?.employee_code || 'STAFF',
      requesterSubtext:
        [t?.designation, t?.department].filter(Boolean).join(' · ') || 'Staff Member',
      leaveType: formatLeaveTypeLabel(row.leave_type),
      startDate,
      endDate,
      totalDays: countDaysInclusive(startDate, endDate),
      reason: String(row.reason || '—'),
      status: normalizeLeaveStatus(row.status),
      reviewerNote: null,
      reviewedAt: null,
      createdAt: String(row.created_at),
    });
  }

  for (const row of studentLeaves ?? []) {
    seenStudentLeaveIds.add(String(row.id));
    const st = studentMap.get(row.student_id as string);
    const classId = st?.class_id as string | null;
    const sectionId = st?.section_id as string | null;
    const classLabel = classId ? classMap.get(classId) : undefined;
    const sectionLabel = sectionId ? sectionMap.get(sectionId) : undefined;

    const startDate = String(row.start_date || '').slice(0, 10);
    const endDate = String(row.end_date || startDate).slice(0, 10);

    unified.push({
      id: row.id as string,
      source: 'student_leave',
      requesterType: 'Student',
      requesterId: (row.student_id as string) || null,
      requesterName: st?.name_en || 'Student',
      requesterCode: st?.admission_number || 'STU',
      requesterSubtext: classLabel
        ? `${classLabel}${sectionLabel ? ` (${sectionLabel})` : ''}`
        : 'Student',
      leaveType: formatLeaveTypeLabel(row.leave_type),
      startDate,
      endDate,
      totalDays: countDaysInclusive(startDate, endDate),
      reason: String(row.reason || '—'),
      status: normalizeLeaveStatus(row.status),
      reviewerNote: (row.review_note as string | null) ?? null,
      reviewedAt: null,
      createdAt: String(row.created_at),
    });
  }

  for (const c of complaintRows ?? []) {
    const isTeacher = String(c.submitter_type || '').toLowerCase().includes('teacher');
    const createdDate = String(c.created_at).slice(0, 10);
    const userId = (c.submitted_by_user_id as string | null) ?? null;
    const linkedTeacher = userId ? teacherByUserMap.get(userId) : undefined;
    const linkedStudent = userId ? studentByUserMap.get(userId) : undefined;

    unified.push({
      id: c.id as string,
      source: 'complaint_leave',
      requesterType: isTeacher || linkedTeacher ? 'Teacher' : 'Student',
      requesterId:
        isTeacher || linkedTeacher
          ? linkedTeacher?.id ?? userId
          : linkedStudent?.id ?? userId,
      requesterName: String(
        c.submitter_name ||
          linkedTeacher?.full_name ||
          linkedStudent?.name_en ||
          (isTeacher ? 'Teacher' : 'Student')
      ),
      requesterCode: linkedTeacher?.employee_code || linkedStudent?.admission_number || (isTeacher ? 'STAFF' : 'STU'),
      requesterSubtext: String(c.category || 'Leave Request'),
      leaveType: String(c.subject || 'Leave Request'),
      startDate: createdDate,
      endDate: createdDate,
      totalDays: 1,
      reason: String(c.description || '—'),
      status: normalizeLeaveStatus(c.status),
      reviewerNote: null,
      reviewedAt: c.updated_at ? String(c.updated_at) : null,
      createdAt: String(c.created_at),
    });
  }

  for (const t of supportTicketRows ?? []) {
    if (!isLeaveRelatedTicketOrComplaint(t)) continue;
    const st = t.student_id ? studentMap.get(t.student_id as string) : undefined;
    const classId = st?.class_id as string | null;
    const sectionId = st?.section_id as string | null;
    const classLabel = classId ? classMap.get(classId) : undefined;
    const sectionLabel = sectionId ? sectionMap.get(sectionId) : undefined;
    const parsed = parseSupportTicketLeaveDetails(t);

    unified.push({
      id: t.id as string,
      source: 'support_ticket_leave',
      requesterType: 'Student',
      requesterId: (t.student_id as string) || null,
      requesterName: st?.name_en || 'Student',
      requesterCode: st?.admission_number || (t.ticket_number as string | null) || 'STU',
      requesterSubtext: classLabel
        ? `${classLabel}${sectionLabel ? ` (${sectionLabel})` : ''}`
        : 'Student App',
      leaveType: parsed.leaveType,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      totalDays: countDaysInclusive(parsed.startDate, parsed.endDate),
      reason: parsed.reason,
      status: normalizeLeaveStatus(t.status),
      reviewerNote: null,
      reviewedAt: t.updated_at ? String(t.updated_at) : null,
      createdAt: String(t.created_at),
    });
  }

  for (const n of notifRows ?? []) {
    const meta = (n.metadata as Record<string, unknown> | null) ?? {};
    const kind = String(meta.request_kind || '');
    const titleLower = String(n.title || '').toLowerCase();

    // Skip notifications that already correspond to a row in staff_leave_records or leave_requests
    if (
      typeof meta.staff_leave_id === 'string' &&
      seenStaffLeaveIds.has(meta.staff_leave_id)
    ) {
      continue;
    }
    if (
      typeof meta.leave_request_id === 'string' &&
      seenStudentLeaveIds.has(meta.leave_request_id)
    ) {
      continue;
    }
    // Skip outgoing decision notifications sent TO teachers/students
    if (
      titleLower.includes('approved') ||
      titleLower.includes('rejected') ||
      n.recipient_user_id
    ) {
      continue;
    }

    const metaTeacherId = typeof meta.teacher_id === 'string' ? meta.teacher_id : null;
    const metaStudentId = typeof meta.student_id === 'string' ? meta.student_id : null;
    const linkedTeacher = metaTeacherId ? teacherMap.get(metaTeacherId) : undefined;
    const linkedStudent = metaStudentId ? studentMap.get(metaStudentId) : undefined;

    const isTeacher =
      Boolean(linkedTeacher) ||
      kind.includes('teacher') ||
      kind.includes('staff') ||
      titleLower.includes('teacher') ||
      titleLower.includes('staff');

    const createdDate = String(n.created_at).slice(0, 10);
    const startDate =
      typeof meta.start_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(meta.start_date)
        ? meta.start_date.slice(0, 10)
        : createdDate;
    const endDate =
      typeof meta.end_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(meta.end_date)
        ? meta.end_date.slice(0, 10)
        : startDate;

    unified.push({
      id: n.id as string,
      source: 'notification_leave',
      requesterType: isTeacher ? 'Teacher' : 'Student',
      requesterId: isTeacher ? metaTeacherId : metaStudentId,
      requesterName:
        linkedTeacher?.full_name ||
        linkedStudent?.name_en ||
        (typeof meta.requester_name === 'string' ? meta.requester_name : null) ||
        String(n.title || 'Leave Request'),
      requesterCode:
        linkedTeacher?.employee_code ||
        linkedStudent?.admission_number ||
        (isTeacher ? 'STAFF' : 'STU'),
      requesterSubtext: isTeacher ? 'Teacher App Alert' : 'Student App Alert',
      leaveType: formatLeaveTypeLabel(meta.leave_type || 'Casual'),
      startDate,
      endDate,
      totalDays: countDaysInclusive(startDate, endDate),
      reason: String(meta.reason || n.body || '—'),
      status: normalizeLeaveStatus(meta.review_status || 'Pending'),
      reviewerNote: typeof meta.reviewer_note === 'string' ? meta.reviewer_note : null,
      reviewedAt: typeof meta.reviewed_at === 'string' ? meta.reviewed_at : null,
      createdAt: String(n.created_at),
    });
  }

  unified.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return unified;
}

export async function createStudentLeaveRequest({
  db,
  schoolId,
  studentId,
  leaveType,
  startDate,
  endDate,
  reason,
  initialStatus = 'Pending',
  reviewerUserId,
}: {
  db: SupabaseClient;
  schoolId: string;
  studentId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  initialStatus?: LeaveStatus;
  reviewerUserId?: string | null;
}) {
  const { data: student, error: sErr } = await db
    .from('students')
    .select('id, school_id, name_en, admission_number, class_id, section_id, user_id, student_email')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (sErr || !student) {
    return { error: 'Student not found in school.', leave: null };
  }

  const effectiveEnd = endDate >= startDate ? endDate : startDate;
  const dbStatus = initialStatus.toLowerCase(); // 'pending' | 'approved'

  const { data: record, error: insErr } = await db
    .from('leave_requests')
    .insert({
      school_id: schoolId,
      student_id: student.id,
      leave_type: leaveType,
      start_date: startDate,
      end_date: effectiveEnd,
      reason,
      status: dbStatus,
      review_note: initialStatus === 'Approved' ? 'Auto-approved' : null,
    })
    .select('*')
    .single();

  if (insErr || !record) {
    return { error: insErr?.message || 'Unable to submit leave request.', leave: null };
  }

  if (initialStatus === 'Pending') {
    await db.from('notifications').insert({
      school_id: schoolId,
      recipient_user_id: null,
      target_audience: 'school_staff',
      category: 'attendance',
      title: `Student Leave Request: ${student.name_en} (${leaveType})`,
      body: `${student.name_en} (${student.admission_number}) requested ${leaveType} leave from ${startDate} to ${effectiveEnd}. Reason: ${reason}`,
      metadata: {
        request_kind: 'student_leave_alert',
        leave_request_id: record.id,
        student_id: student.id,
      },
      is_read: false,
    });
  } else if (initialStatus === 'Approved') {
    const dates = expandDateRange(startDate, effectiveEnd);
    if (dates.length > 0) {
      await db.from('student_attendance').upsert(
        dates.map((d) => ({
          school_id: schoolId,
          student_id: student.id,
          class_id: student.class_id ?? null,
          section_id: student.section_id ?? null,
          attendance_date: d,
          status: 'Leave',
          source: 'manual',
          marked_by: reviewerUserId ?? null,
        })),
        { onConflict: 'school_id,student_id,attendance_date' }
      );
    }
  }

  return { error: null, leave: record };
}

export async function createTeacherLeaveRequest({
  db,
  schoolId,
  teacherId,
  leaveType,
  startDate,
  endDate,
  reason,
  initialStatus = 'Pending',
  reviewerUserId,
}: {
  db: SupabaseClient;
  schoolId: string;
  teacherId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  initialStatus?: LeaveStatus;
  reviewerUserId?: string | null;
}) {
  const { data: teacher, error: tErr } = await db
    .from('teachers')
    .select('id, school_id, full_name, employee_code, user_id, email')
    .eq('id', teacherId)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (tErr || !teacher) {
    return { error: 'Teacher / staff member not found in school.', leave: null };
  }

  const effectiveEnd = endDate >= startDate ? endDate : startDate;

  const { data: record, error: insErr } = await db
    .from('staff_leave_records')
    .insert({
      school_id: schoolId,
      teacher_id: teacher.id,
      leave_type: leaveType,
      start_date: startDate,
      end_date: effectiveEnd,
      reason,
      status: initialStatus,
    })
    .select('*')
    .single();

  if (insErr || !record) {
    return { error: insErr?.message || 'Unable to save teacher leave request.', leave: null };
  }

  if (initialStatus === 'Pending') {
    await db.from('notifications').insert({
      school_id: schoolId,
      recipient_user_id: null,
      target_audience: 'school_staff',
      category: 'attendance',
      title: `Teacher Leave Request: ${teacher.full_name} (${leaveType})`,
      body: `${teacher.full_name} (${teacher.employee_code}) requested ${leaveType} leave from ${startDate} to ${effectiveEnd}. Reason: ${reason}`,
      metadata: {
        request_kind: 'teacher_leave_alert',
        staff_leave_id: record.id,
        teacher_id: teacher.id,
      },
      is_read: false,
    });
  } else if (initialStatus === 'Approved') {
    await applyApprovedTeacherLeave({
      db,
      schoolId,
      teacherId: teacher.id,
      startDate,
      endDate: effectiveEnd,
      reviewerUserId: reviewerUserId ?? null,
    });
  }

  return { error: null, leave: record };
}

async function applyApprovedTeacherLeave({
  db,
  schoolId,
  teacherId,
  startDate,
  endDate,
  reviewerUserId,
}: {
  db: SupabaseClient;
  schoolId: string;
  teacherId: string;
  startDate: string;
  endDate: string;
  reviewerUserId: string | null;
}) {
  const dates = expandDateRange(startDate, endDate);
  if (dates.length > 0) {
    await db.from('teacher_attendance').upsert(
      dates.map((d) => ({
        school_id: schoolId,
        teacher_id: teacherId,
        attendance_date: d,
        status: 'Leave',
        remarks: 'Approved Leave Request',
        marked_by: reviewerUserId,
      })),
      { onConflict: 'school_id,teacher_id,attendance_date' }
    );

    const months = Array.from(new Set(dates.map((d) => d.slice(0, 7))));
    for (const payrollMonth of months) {
      await syncMonthlySalarySlipsForSchool({
        db,
        schoolId,
        payrollMonth,
        teacherIds: [teacherId],
        forceRecalculateUnpaid: true,
      }).catch(() => null);
    }
  }
}

export async function reviewLeaveRequest({
  db,
  schoolId,
  source,
  id,
  decision,
  reviewerUserId,
  reviewerNote,
}: {
  db: SupabaseClient;
  schoolId: string;
  source: LeaveSource;
  id: string;
  decision: 'Approved' | 'Rejected';
  reviewerUserId: string;
  reviewerNote?: string | null;
}) {
  if (source === 'staff_leave') {
    const { data: leaveRow, error: lookupErr } = await db
      .from('staff_leave_records')
      .select('*')
      .eq('id', id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (lookupErr || !leaveRow) {
      return { error: 'Teacher leave request not found.' };
    }

    const { error: updErr } = await db
      .from('staff_leave_records')
      .update({ status: decision })
      .eq('id', id)
      .eq('school_id', schoolId);

    if (updErr) {
      return { error: updErr.message };
    }

    if (decision === 'Approved') {
      await applyApprovedTeacherLeave({
        db,
        schoolId,
        teacherId: leaveRow.teacher_id as string,
        startDate: String(leaveRow.start_date).slice(0, 10),
        endDate: String(leaveRow.end_date).slice(0, 10),
        reviewerUserId,
      });
    }

    const { data: teacher } = await db
      .from('teachers')
      .select('id, full_name, user_id, email')
      .eq('id', leaveRow.teacher_id)
      .maybeSingle();

    if (teacher?.user_id) {
      await ensurePublicUserProfile(db, teacher.user_id, teacher.email, teacher.full_name);
      await db.from('notifications').insert({
        school_id: schoolId,
        recipient_user_id: teacher.user_id,
        target_audience: 'Teachers',
        category: 'attendance',
        title: `Leave Request ${decision} (${leaveRow.leave_type})`,
        body: `Your ${leaveRow.leave_type} leave (${leaveRow.start_date} to ${leaveRow.end_date}) has been ${decision}.${reviewerNote ? ` Note: ${reviewerNote}` : ''}`,
        is_read: false,
      });
    }

    return { error: null };
  }

  if (source === 'student_leave') {
    const { data: leaveRow, error: lookupErr } = await db
      .from('leave_requests')
      .select('*')
      .eq('id', id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (lookupErr || !leaveRow) {
      return { error: 'Student leave request not found.' };
    }

    const { error: updErr } = await db
      .from('leave_requests')
      .update({
        status: decision.toLowerCase(),
        review_note: reviewerNote || null,
      })
      .eq('id', id)
      .eq('school_id', schoolId);

    if (updErr) {
      return { error: updErr.message };
    }

    const { data: student } = await db
      .from('students')
      .select('id, name_en, admission_number, class_id, section_id, user_id, student_email')
      .eq('id', leaveRow.student_id)
      .maybeSingle();

    if (decision === 'Approved' && student) {
      const dates = expandDateRange(String(leaveRow.start_date), String(leaveRow.end_date));
      if (dates.length > 0) {
        await db.from('student_attendance').upsert(
          dates.map((d) => ({
            school_id: schoolId,
            student_id: student.id,
            class_id: student.class_id ?? null,
            section_id: student.section_id ?? null,
            attendance_date: d,
            status: 'Leave',
            source: 'manual',
            marked_by: reviewerUserId,
          })),
          { onConflict: 'school_id,student_id,attendance_date' }
        );
      }
    }

    if (student?.user_id) {
      await db.from('notifications').insert({
        school_id: schoolId,
        recipient_user_id: student.user_id,
        target_audience: 'Students',
        category: 'attendance',
        title: `Leave Request ${decision} (${leaveRow.leave_type})`,
        body: `Your ${leaveRow.leave_type} leave (${leaveRow.start_date} to ${leaveRow.end_date}) has been ${decision}.${reviewerNote ? ` Note: ${reviewerNote}` : ''}`,
        is_read: false,
      });
    }

    return { error: null };
  }

  if (source === 'complaint_leave') {
    const { data: cRow, error: lookupErr } = await db
      .from('complaints')
      .select('*')
      .eq('id', id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (lookupErr || !cRow) {
      return { error: 'Complaint leave request not found.' };
    }

    const { error: updErr } = await db
      .from('complaints')
      .update({
        status: decision === 'Approved' ? 'resolved' : 'closed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('school_id', schoolId);

    if (updErr) {
      return { error: updErr.message };
    }

    if (cRow.submitted_by_user_id) {
      const targetDate = String(cRow.created_at).slice(0, 10);
      if (decision === 'Approved') {
        const [{ data: teacher }, { data: student }] = await Promise.all([
          db
            .from('teachers')
            .select('id')
            .eq('school_id', schoolId)
            .eq('user_id', cRow.submitted_by_user_id)
            .maybeSingle(),
          db
            .from('students')
            .select('id, class_id, section_id')
            .eq('school_id', schoolId)
            .eq('user_id', cRow.submitted_by_user_id)
            .maybeSingle(),
        ]);

        if (teacher) {
          await applyApprovedTeacherLeave({
            db,
            schoolId,
            teacherId: teacher.id,
            startDate: targetDate,
            endDate: targetDate,
            reviewerUserId,
          });
        } else if (student) {
          await db.from('student_attendance').upsert(
            {
              school_id: schoolId,
              student_id: student.id,
              class_id: student.class_id ?? null,
              section_id: student.section_id ?? null,
              attendance_date: targetDate,
              status: 'Leave',
              source: 'manual',
              marked_by: reviewerUserId,
            },
            { onConflict: 'school_id,student_id,attendance_date' }
          );
        }
      }

      await db.from('notifications').insert({
        school_id: schoolId,
        recipient_user_id: cRow.submitted_by_user_id,
        target_audience: String(cRow.submitter_type || '').toLowerCase().includes('teacher')
          ? 'Teachers'
          : 'Students',
        category: 'attendance',
        title: `Leave Request ${decision}`,
        body: `Your leave request (${cRow.subject || 'Leave'}) has been ${decision}.${reviewerNote ? ` Note: ${reviewerNote}` : ''}`,
        is_read: false,
      });
    }

    return { error: null };
  }

  if (source === 'support_ticket_leave') {
    const { data: ticketRow, error: lookupErr } = await db
      .from('support_tickets')
      .select('*')
      .eq('id', id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (lookupErr || !ticketRow) {
      return { error: 'Student leave request not found.' };
    }

    const nowIso = new Date().toISOString();
    const { error: updErr } = await db
      .from('support_tickets')
      .update({
        status: decision === 'Approved' ? 'Resolved' : 'Closed',
        updated_at: nowIso,
      })
      .eq('id', id)
      .eq('school_id', schoolId);

    if (updErr) {
      return { error: updErr.message };
    }

    const parsed = parseSupportTicketLeaveDetails(ticketRow);

    if (ticketRow.student_id) {
      const { data: student } = await db
        .from('students')
        .select('id, class_id, section_id, user_id')
        .eq('id', ticketRow.student_id)
        .eq('school_id', schoolId)
        .maybeSingle();

      if (decision === 'Approved' && student) {
        const dates = expandDateRange(parsed.startDate, parsed.endDate);
        if (dates.length > 0) {
          await db.from('student_attendance').upsert(
            dates.map((d) => ({
              school_id: schoolId,
              student_id: student.id,
              class_id: student.class_id ?? null,
              section_id: student.section_id ?? null,
              attendance_date: d,
              status: 'Leave',
              source: 'manual',
              marked_by: reviewerUserId,
            })),
            { onConflict: 'school_id,student_id,attendance_date' }
          );
        }
      }

      await db.from('support_ticket_messages').insert({
        ticket_id: id,
        school_id: schoolId,
        sender_user_id: reviewerUserId,
        sender_role: 'school_owner',
        sender_name: 'School Admin',
        message: `Leave Request ${decision} (${parsed.leaveType}: ${parsed.startDate} to ${parsed.endDate})${reviewerNote ? `. Note: ${reviewerNote}` : ''}`,
        attachments: [],
        created_at: nowIso,
      });

      if (student?.user_id) {
        await db.from('notifications').insert({
          school_id: schoolId,
          recipient_user_id: student.user_id,
          target_audience: 'Students',
          category: 'attendance',
          title: `Leave Request ${decision} (${parsed.leaveType})`,
          body: `Your ${parsed.leaveType} leave (${parsed.startDate} to ${parsed.endDate}) has been ${decision}.${reviewerNote ? ` Note: ${reviewerNote}` : ''}`,
          is_read: false,
        });
      }
    }

    return { error: null };
  }

  if (source === 'notification_leave') {
    const { data: nRow, error: lookupErr } = await db
      .from('notifications')
      .select('*')
      .eq('id', id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (lookupErr || !nRow) {
      return { error: 'Notification leave request not found.' };
    }

    const meta = (nRow.metadata as Record<string, unknown> | null) ?? {};
    const { error: updErr } = await db
      .from('notifications')
      .update({
        is_read: true,
        metadata: {
          ...meta,
          review_status: decision,
          reviewer_note: reviewerNote || null,
          reviewed_at: new Date().toISOString(),
        },
      })
      .eq('id', id)
      .eq('school_id', schoolId);

    if (updErr) {
      return { error: updErr.message };
    }

    const startDate =
      typeof meta.start_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(meta.start_date)
        ? meta.start_date.slice(0, 10)
        : String(nRow.created_at).slice(0, 10);
    const endDate =
      typeof meta.end_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(meta.end_date)
        ? meta.end_date.slice(0, 10)
        : startDate;

    if (decision === 'Approved' && typeof meta.teacher_id === 'string') {
      await applyApprovedTeacherLeave({
        db,
        schoolId,
        teacherId: meta.teacher_id,
        startDate,
        endDate,
        reviewerUserId,
      });
    } else if (decision === 'Approved' && typeof meta.student_id === 'string') {
      const { data: stu } = await db
        .from('students')
        .select('id, class_id, section_id')
        .eq('id', meta.student_id)
        .maybeSingle();
      if (stu) {
        const dates = expandDateRange(startDate, endDate);
        await db.from('student_attendance').upsert(
          dates.map((d) => ({
            school_id: schoolId,
            student_id: stu.id,
            class_id: stu.class_id ?? null,
            section_id: stu.section_id ?? null,
            attendance_date: d,
            status: 'Leave',
            source: 'manual',
            marked_by: reviewerUserId,
          })),
          { onConflict: 'school_id,student_id,attendance_date' }
        );
      }
    }

    return { error: null };
  }

  return { error: 'Unknown leave source.' };
}
