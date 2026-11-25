import type { SupabaseClient } from '@supabase/supabase-js';
import { getDateHolidayInfo, getSchoolHolidayContext } from '@/lib/attendance/holidays';

export interface TeacherAttendanceStats {
  presentDays: number;
  absentDays: number;
  lateDays: number;
  leaveDays: number;
  markedDays: number;
}

export function getMonthDateRange(payrollMonth?: string | null) {
  const now = new Date();
  const fallbackMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const validMonth =
    payrollMonth && /^\d{4}-\d{2}$/.test(payrollMonth.trim()) ? payrollMonth.trim() : fallbackMonth;

  const [yearStr, monthStr] = validMonth.split('-');
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDateExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    month: validMonth,
    startDate,
    endDateExclusive,
    daysInMonth,
  };
}

export async function getTeacherAttendanceMapForMonth(
  db: SupabaseClient,
  schoolId: string,
  payrollMonth: string,
  teacherIds?: string[]
): Promise<{
  month: string;
  daysInMonth: number;
  attendanceByTeacher: Map<string, TeacherAttendanceStats>;
}> {
  const range = getMonthDateRange(payrollMonth);
  let query = db
    .from('teacher_attendance')
    .select('teacher_id, status, attendance_date')
    .eq('school_id', schoolId)
    .gte('attendance_date', range.startDate)
    .lt('attendance_date', range.endDateExclusive);

  if (teacherIds && teacherIds.length > 0) {
    query = query.in('teacher_id', teacherIds);
  }

  let teachersQuery = db
    .from('teachers')
    .select('id, joining_date, status')
    .eq('school_id', schoolId)
    .in('status', ['active', 'Active']);

  if (teacherIds && teacherIds.length > 0) {
    teachersQuery = teachersQuery.in('id', teacherIds);
  }

  const [{ data: rows }, { data: teacherRows }, holidayContext] = await Promise.all([
    query,
    teachersQuery,
    getSchoolHolidayContext(db, schoolId),
  ]);

  const teacherDateStatus = new Map<string, Map<string, string>>();
  for (const row of rows ?? []) {
    const tid = row.teacher_id as string;
    const attDate = String(row.attendance_date || '').slice(0, 10);
    if (!attDate) continue;
    let dateMap = teacherDateStatus.get(tid);
    if (!dateMap) {
      dateMap = new Map<string, string>();
      teacherDateStatus.set(tid, dateMap);
    }
    dateMap.set(attDate, String(row.status || 'Present'));
  }

  // Generate all working dates in the month up to today (or end of month if month has passed)
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const targetEndDate = range.endDateExclusive < todayStr ? range.endDateExclusive : todayStr;

  const workingDates: string[] = [];
  let curr = new Date(range.startDate + 'T00:00:00Z');
  const endLimit = new Date(targetEndDate + 'T00:00:00Z');

  while (curr < endLimit && curr.toISOString().slice(0, 10) < range.endDateExclusive) {
    const dStr = curr.toISOString().slice(0, 10);
    const hInfo = getDateHolidayInfo(dStr, holidayContext.workingDays, holidayContext.holidays);
    if (!hInfo.isHoliday) {
      workingDates.push(dStr);
    }
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  const attendanceByTeacher = new Map<string, TeacherAttendanceStats>();

  for (const t of teacherRows ?? []) {
    const tid = t.id as string;
    const joinDate = t.joining_date ? String(t.joining_date).slice(0, 10) : range.startDate;
    const stats: TeacherAttendanceStats = {
      presentDays: 0,
      absentDays: 0,
      lateDays: 0,
      leaveDays: 0,
      markedDays: 0,
    };

    const dateMap = teacherDateStatus.get(tid) ?? new Map<string, string>();

    for (const dStr of workingDates) {
      if (dStr < joinDate) continue;
      const st = dateMap.get(dStr);
      if (st === 'Present') {
        stats.presentDays += 1;
        stats.markedDays += 1;
      } else if (st === 'Late') {
        stats.lateDays += 1;
        stats.markedDays += 1;
      } else if (st === 'Leave') {
        stats.leaveDays += 1;
        stats.markedDays += 1;
      } else if (st === 'Absent') {
        stats.absentDays += 1;
        stats.markedDays += 1;
      } else {
        // Unmarked working day is counted as absent for payroll deduction
        stats.absentDays += 1;
      }
    }

    attendanceByTeacher.set(tid, stats);
  }

  return {
    month: range.month,
    daysInMonth: range.daysInMonth,
    attendanceByTeacher,
  };
}

export async function syncMonthlySalarySlipsForSchool({
  db,
  schoolId,
  payrollMonth,
  teacherIds,
  forceRecalculateUnpaid = true,
}: {
  db: SupabaseClient;
  schoolId: string;
  payrollMonth?: string | null;
  teacherIds?: string[];
  forceRecalculateUnpaid?: boolean;
}) {
  const { month, daysInMonth, attendanceByTeacher } = await getTeacherAttendanceMapForMonth(
    db,
    schoolId,
    payrollMonth || '',
    teacherIds
  );

  let teachersQuery = db
    .from('teachers')
    .select('id, employee_code, full_name, designation, department, salary_pkr, status')
    .eq('school_id', schoolId)
    .in('status', ['active', 'Active']);

  if (teacherIds && teacherIds.length > 0) {
    teachersQuery = teachersQuery.in('id', teacherIds);
  }

  let slipsQuery = db
    .from('salary_slips')
    .select('*')
    .eq('school_id', schoolId)
    .eq('payroll_month', month);

  if (teacherIds && teacherIds.length > 0) {
    slipsQuery = slipsQuery.in('teacher_id', teacherIds);
  }

  const [{ data: teachers }, { data: existingSlips }] = await Promise.all([
    teachersQuery,
    slipsQuery,
  ]);

  const slipByTeacher = new Map(
    (existingSlips ?? []).map((s) => [s.teacher_id as string, s])
  );

  const toInsert: Array<Record<string, unknown>> = [];
  let updatedCount = 0;

  for (const teacher of teachers ?? []) {
    const tid = teacher.id as string;
    const stats = attendanceByTeacher.get(tid) ?? {
      presentDays: 0,
      absentDays: 0,
      lateDays: 0,
      leaveDays: 0,
      markedDays: 0,
    };

    const baseSalary = Number(teacher.salary_pkr || 0);
    const perDayRate = daysInMonth > 0 ? baseSalary / daysInMonth : baseSalary / 30;
    const absentDays = stats.absentDays;
    const attendanceDeduction = Math.round(perDayRate * absentDays);
    const existing = slipByTeacher.get(tid);

    if (!existing) {
      const netSalary = Math.max(0, Math.round(baseSalary - attendanceDeduction));
      toInsert.push({
        school_id: schoolId,
        teacher_id: tid,
        payroll_month: month,
        base_salary: baseSalary,
        allowances: 0,
        bonuses: 0,
        deductions: 0,
        advance_salary: 0,
        absent_days: absentDays,
        attendance_deduction: attendanceDeduction,
        net_salary: netSalary,
        status: 'Unpaid',
      });
    } else if (existing.status !== 'Paid' && forceRecalculateUnpaid) {
      const allowances = Number(existing.allowances || 0);
      const bonuses = Number(existing.bonuses || 0);
      const deductions = Number(existing.deductions || 0);
      const advanceSalary = Number(existing.advance_salary || 0);
      const netSalary = Math.max(
        0,
        Math.round(
          baseSalary + allowances + bonuses - deductions - advanceSalary - attendanceDeduction
        )
      );

      if (
        Number(existing.base_salary) !== baseSalary ||
        Number(existing.absent_days) !== absentDays ||
        Number(existing.attendance_deduction) !== attendanceDeduction ||
        Number(existing.net_salary) !== netSalary
      ) {
        await db
          .from('salary_slips')
          .update({
            base_salary: baseSalary,
            absent_days: absentDays,
            attendance_deduction: attendanceDeduction,
            net_salary: netSalary,
          })
          .eq('id', existing.id)
          .eq('school_id', schoolId);
        updatedCount += 1;
      }
    }
  }

  let createdCount = 0;
  if (toInsert.length > 0) {
    const { data: inserted } = await db
      .from('salary_slips')
      .upsert(toInsert, { onConflict: 'school_id,teacher_id,payroll_month', ignoreDuplicates: true })
      .select('id');
    createdCount = inserted?.length ?? toInsert.length;
  }

  return {
    month,
    daysInMonth,
    createdCount,
    updatedCount,
    attendanceByTeacher,
  };
}
