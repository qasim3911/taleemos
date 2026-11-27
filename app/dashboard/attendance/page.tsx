'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { QrGateScanner } from '@/components/dashboard/qr-scanner';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import {
  ALL_WEEK_DAYS,
  DEFAULT_WORKING_DAYS,
  getDateHolidayInfo,
  type SchoolHolidayEvent,
} from '@/lib/attendance/holidays';
import { ArrowLeft, CalendarOff, CalendarRange, Eye, GraduationCap, ShieldCheck, Trash2, Users } from 'lucide-react';

interface StudentBasic {
  id: string;
  admission_number: string;
  name_en: string;
  class_id: string | null;
  section_id: string | null;
  student_id?: string | null;
  qr_token: string | null;
  user_id: string | null;
  app_access_enabled: boolean;
  app_blocked: boolean;
}

interface TeacherBasic {
  id: string;
  employee_code: string;
  full_name: string;
}

interface ClassBasic {
  id: string;
  name: string;
  grade_level?: string | null;
}

interface SectionBasic {
  id: string;
  name: string;
  class_id: string | null;
}

interface RawAttendanceRow {
  id: string;
  student_id: string;
  attendance_date: string;
  status: string;
  source?: string;
  check_in_at?: string | null;
  check_out_at?: string | null;
}

interface RawTeacherAttendanceRow {
  id: string;
  teacher_id: string;
  attendance_date: string;
  status: string;
  source?: string;
  check_in_at?: string | null;
  check_out_at?: string | null;
}

interface AttendanceLog {
  id: string;
  student_id: string;
  personName: string;
  code: string;
  attendance_date: string;
  status: string;
  source?: string;
  check_in_at?: string | null;
  check_out_at?: string | null;
}

// ---------- NEW: unified report types ----------
type ReportRole = 'student' | 'teacher';
type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface ReportLog {
  id: string;
  personId: string;
  personName: string;
  code: string;
  attendance_date: string;
  status: string;
  source?: string;
  check_in_at?: string | null;
  check_out_at?: string | null;
}

interface PersonSummary {
  personId: string;
  code: string;
  personName: string;
  className: string;
  present: number;
  absent: number;
  late: number;
  leave: number;
  marked: number;
  workingDays: number;
  unmarked: number;
  percentage: number;
  logs: ReportLog[];
}

// --- ONLY FIX: pick class/section name from any possible column name ---
function pickName(row: Record<string, unknown>): string {
  const candidates = [
    row.name,
    row.name_en,
    row.class_name,
    row.title,
    row.label,
    row.grade,
    row.grade_level,
    row.class_title,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

// ---------- NEW: date helpers (local-safe, no UTC drift) ----------
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseIso = (s: string) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
};

function getPeriodRange(period: ReportPeriod, anchor: string): { start: string; end: string; label: string } {
  const d = parseIso(anchor);
  if (period === 'daily') {
    return { start: isoOf(d), end: isoOf(d), label: isoOf(d) };
  }
  if (period === 'weekly') {
    // Calendar week: Monday -> Sunday
    const dow = d.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const s = new Date(d);
    s.setDate(d.getDate() + mondayOffset);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    return { start: isoOf(s), end: isoOf(e), label: `${isoOf(s)} → ${isoOf(e)}` };
  }
  if (period === 'monthly') {
    const s = new Date(d.getFullYear(), d.getMonth(), 1);
    const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return {
      start: isoOf(s),
      end: isoOf(e),
      label: s.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    };
  }
  const s = new Date(d.getFullYear(), 0, 1);
  const e = new Date(d.getFullYear(), 11, 31);
  return { start: isoOf(s), end: isoOf(e), label: `Year ${d.getFullYear()}` };
}

function countWorkingDays(
  start: string,
  end: string,
  workingDays: string[],
  holidays: SchoolHolidayEvent[]
): number {
  const s = parseIso(start);
  const e = parseIso(end);
  if (e < s) return 0;
  let count = 0;
  let guard = 0;
  const cur = new Date(s);
  while (cur <= e && guard < 1000) {
    if (!getDateHolidayInfo(isoOf(cur), workingDays, holidays).isHoliday) count++;
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return count;
}

const pctColor = (p: number) =>
  p >= 90
    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
    : p >= 75
      ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-900'
      : p >= 50
        ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900'
        : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900';

const statusColor = (s: string) => {
  const v = s.toLowerCase();
  if (v === 'present') return 'text-emerald-700 dark:text-emerald-400 font-semibold';
  if (v === 'late') return 'text-amber-700 dark:text-amber-400 font-semibold';
  if (v === 'absent') return 'text-red-700 dark:text-red-400 font-semibold';
  if (v === 'leave') return 'text-sky-700 dark:text-sky-400 font-semibold';
  return 'text-slate-600 dark:text-slate-300';
};

export default function AttendancePage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [tab, setTab] = useState<'student_manual' | 'qr_gate' | 'teacher' | 'reports'>('student_manual');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('daily');
  const [students, setStudents] = useState<StudentBasic[]>([]);
  const [teachers, setTeachers] = useState<TeacherBasic[]>([]);
  const [classes, setClasses] = useState<ClassBasic[]>([]);
  const [sections, setSections] = useState<SectionBasic[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');
  const [studentLogs, setStudentLogs] = useState<AttendanceLog[]>([]);
  const [teacherLogs, setTeacherLogs] = useState<RawTeacherAttendanceRow[]>([]);
  const [workingDays, setWorkingDays] = useState<string[]>([...DEFAULT_WORKING_DAYS]);
  const [holidays, setHolidays] = useState<SchoolHolidayEvent[]>([]);
  const [allowOnHoliday, setAllowOnHoliday] = useState(false);

  // ---------- NEW: report states ----------
  const [reportRole, setReportRole] = useState<ReportRole>('student');
  const [reportClassId, setReportClassId] = useState<string>('');
  const [reportSectionId, setReportSectionId] = useState<string>('');
  const [detailPersonId, setDetailPersonId] = useState<string | null>(null);
  const [reportStudentRows, setReportStudentRows] = useState<RawAttendanceRow[]>([]);
  const [reportTeacherRows, setReportTeacherRows] = useState<RawTeacherAttendanceRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);

  const [openHolidayModal, setOpenHolidayModal] = useState(false);
  const [holidayForm, setHolidayForm] = useState({
    title: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    description: '',
    notifyAll: true,
  });

  const [openWorkingDaysModal, setOpenWorkingDaysModal] = useState(false);
  const [workingDaysDraft, setWorkingDaysDraft] = useState<string[]>([...DEFAULT_WORKING_DAYS]);

  const [qrMode, setQrMode] = useState<'IN' | 'OUT'>('IN');
  const [manualToken, setManualToken] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const res = await fetch('/api/attendance', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) return;

    const stus = (data.students ?? []) as StudentBasic[];
    const tchs = (data.teachers ?? []) as TeacherBasic[];
    const sAtt = (data.studentAttendance ?? []) as RawAttendanceRow[];
    const tAtt = (data.teacherAttendance ?? []) as RawTeacherAttendanceRow[];

    const sMap = new Map<string, StudentBasic>(stus.map((s) => [s.id, s]));
    setStudents(stus);
    setTeachers(tchs);
    setTeacherLogs(tAtt);
    if (Array.isArray(data.workingDays)) setWorkingDays(data.workingDays);
    if (Array.isArray(data.holidays)) setHolidays(data.holidays);

    let finalClasses: ClassBasic[] = [];
    if (Array.isArray(data.classes) && data.classes.length > 0) {
      finalClasses = (data.classes as Record<string, unknown>[])
        .filter((c) => c.id)
        .map((c) => ({
          id: String(c.id),
          name: pickName(c) || String(c.id),
          grade_level: typeof c.grade_level === 'string' ? c.grade_level : null,
        }))
        .filter((c) => c.name && !c.name.startsWith('Class ') || c.name.length > 0);
      const looksLikeId = finalClasses.length > 0 && finalClasses.every((c) => /^[a-f0-9-]{8,}/i.test(c.name.replace('Class ', '')));
      if (looksLikeId) finalClasses = [];
    }
    if (finalClasses.length === 0) {
      try {
        const supabase = createSupabaseBrowserClient();
        if (supabase) {
          const { data: clsRows } = await supabase
            .from('classes')
            .select('*')
            .eq('school_id', school.id)
            .order('created_at', { ascending: true });
          if (Array.isArray(clsRows) && clsRows.length > 0) {
            finalClasses = (clsRows as Record<string, unknown>[])
              .filter((c) => c.id)
              .map((c) => ({
                id: String(c.id),
                name: pickName(c) || String(c.id),
                grade_level: typeof c.grade_level === 'string' ? c.grade_level : null,
              }));
          }
          const { data: secRows } = await supabase
            .from('sections')
            .select('*')
            .eq('school_id', school.id);
          if (Array.isArray(secRows) && secRows.length > 0) {
            setSections(
              (secRows as Record<string, unknown>[])
                .filter((s) => s.id)
                .map((s) => ({
                  id: String(s.id),
                  name: pickName(s) || String(s.id),
                  class_id: s.class_id ? String(s.class_id) : null,
                }))
            );
          } else if (Array.isArray(data.sections)) {
            setSections(data.sections);
          }
        }
      } catch {
        // keep backend fallback
      }
    } else if (Array.isArray(data.sections)) {
      setSections(data.sections);
    }
    setClasses(finalClasses);
    setStudentLogs(
      sAtt.map((row) => {
        const st = sMap.get(row.student_id);
        return {
          id: row.id,
          student_id: row.student_id,
          personName: st?.name_en || 'Student',
          code: st?.admission_number || '',
          attendance_date: row.attendance_date,
          status: row.status,
          source: row.source,
          check_in_at: row.check_in_at,
          check_out_at: row.check_out_at,
        };
      })
    );
  }, [school.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`attendance-rt-${school.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'student_attendance', filter: `school_id=eq.${school.id}` },
        () => { void loadData(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'teacher_attendance', filter: `school_id=eq.${school.id}` },
        () => { void loadData(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'school_calendar_events', filter: `school_id=eq.${school.id}` },
        () => { void loadData(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData, school.id]);

  const holidayInfo = useMemo(
    () => getDateHolidayInfo(date, workingDays, holidays),
    [date, workingDays, holidays]
  );

  const attendanceLockedForHoliday = holidayInfo.isHoliday && !allowOnHoliday;

  const filteredSections = useMemo(() => {
    if (!selectedClassId) return [];
    return sections.filter((sec) => sec.class_id === selectedClassId);
  }, [sections, selectedClassId]);

  const filteredStudents = useMemo(() => {
    if (!selectedClassId) return [];
    return students.filter((s) => {
      if (s.class_id !== selectedClassId) return false;
      if (selectedSectionId && s.section_id !== selectedSectionId) return false;
      return true;
    });
  }, [students, selectedClassId, selectedSectionId]);

  const selectedClassName = useMemo(() => {
    return classes.find((c) => c.id === selectedClassId)?.name || '';
  }, [classes, selectedClassId]);

  // ================= REPORT ENGINE (NEW) =================
  const periodRange = useMemo(() => getPeriodRange(reportPeriod, date), [reportPeriod, date]);

  const todayIso = useMemo(() => isoOf(new Date()), []);
  const effectiveEnd = periodRange.end < todayIso ? periodRange.end : todayIso;

  const workingDaysInRange = useMemo(
    () => countWorkingDays(periodRange.start, effectiveEnd, workingDays, holidays),
    [periodRange.start, effectiveEnd, workingDays, holidays]
  );

  const reportSections = useMemo(() => {
    if (!reportClassId) return [];
    return sections.filter((s) => s.class_id === reportClassId);
  }, [sections, reportClassId]);

  // Full-period history direct from Supabase (API route may only return recent rows)
  const loadReportHistory = useCallback(
    async (start: string, end: string) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      setReportLoading(true);
      try {
        const { data: sRows, error: sErr } = await supabase
          .from('student_attendance')
          .select('*')
          .eq('school_id', school.id)
          .gte('attendance_date', start)
          .lte('attendance_date', end)
          .order('attendance_date', { ascending: false })
          .limit(20000);
        if (!sErr && Array.isArray(sRows)) setReportStudentRows(sRows as RawAttendanceRow[]);

        for (const tbl of ['teacher_attendance', 'staff_attendance']) {
          const { data: tRows, error: tErr } = await supabase
            .from(tbl)
            .select('*')
            .eq('school_id', school.id)
            .gte('attendance_date', start)
            .lte('attendance_date', end)
            .order('attendance_date', { ascending: false })
            .limit(20000);
          if (!tErr && Array.isArray(tRows)) {
            setReportTeacherRows(tRows as RawTeacherAttendanceRow[]);
            break;
          }
        }
      } finally {
        setReportLoading(false);
      }
    },
    [school.id]
  );

  useEffect(() => {
    if (tab !== 'reports') return;
    void loadReportHistory(periodRange.start, periodRange.end);
  }, [tab, periodRange.start, periodRange.end, loadReportHistory]);

  useEffect(() => {
    setDetailPersonId(null);
  }, [reportRole, reportPeriod, date, reportClassId, reportSectionId]);

  // Unified logs for selected role (API rows + direct history rows, deduped by id)
  const reportLogs: ReportLog[] = useMemo(() => {
    const inRange = (d: string) => {
      const day = String(d || '').slice(0, 10);
      return day >= periodRange.start && day <= periodRange.end;
    };
    const map = new Map<string, ReportLog>();

    if (reportRole === 'student') {
      const sMap = new Map(students.map((s) => [s.id, s]));
      const push = (r: RawAttendanceRow) => {
        if (!r?.id || !inRange(r.attendance_date)) return;
        const st = sMap.get(r.student_id);
        map.set(String(r.id), {
          id: String(r.id),
          personId: r.student_id,
          personName: st?.name_en || 'Student',
          code: st?.admission_number || '',
          attendance_date: String(r.attendance_date).slice(0, 10),
          status: r.status || '',
          source: r.source,
          check_in_at: r.check_in_at,
          check_out_at: r.check_out_at,
        });
      };
      studentLogs.forEach((l) =>
        push({
          id: l.id,
          student_id: l.student_id,
          attendance_date: l.attendance_date,
          status: l.status,
          source: l.source,
          check_in_at: l.check_in_at,
          check_out_at: l.check_out_at,
        })
      );
      reportStudentRows.forEach(push);
    } else {
      const tMap = new Map(teachers.map((t) => [t.id, t]));
      const push = (r: RawTeacherAttendanceRow) => {
        if (!r?.id || !inRange(r.attendance_date)) return;
        const tc = tMap.get(r.teacher_id);
        map.set(String(r.id), {
          id: String(r.id),
          personId: r.teacher_id,
          personName: tc?.full_name || 'Staff',
          code: tc?.employee_code || '',
          attendance_date: String(r.attendance_date).slice(0, 10),
          status: r.status || '',
          source: r.source,
          check_in_at: r.check_in_at,
          check_out_at: r.check_out_at,
        });
      };
      teacherLogs.forEach(push);
      reportTeacherRows.forEach(push);
    }

    return Array.from(map.values()).sort((a, b) => b.attendance_date.localeCompare(a.attendance_date));
  }, [reportRole, periodRange.start, periodRange.end, students, teachers, studentLogs, teacherLogs, reportStudentRows, reportTeacherRows]);

  // Per-person summary: har student / har teacher ki ALAG report
  const reportSummaries: PersonSummary[] = useMemo(() => {
    const logsByPerson = new Map<string, ReportLog[]>();
    for (const l of reportLogs) {
      const arr = logsByPerson.get(l.personId) ?? [];
      arr.push(l);
      logsByPerson.set(l.personId, arr);
    }

    const classNameOf = (cid: string | null) => classes.find((c) => c.id === cid)?.name || '';

    const roster: Array<{ personId: string; code: string; personName: string; className: string }> =
      reportRole === 'student'
        ? students
            .filter((s) => (!reportClassId || s.class_id === reportClassId) && (!reportSectionId || s.section_id === reportSectionId))
            .map((s) => ({
              personId: s.id,
              code: s.admission_number || '',
              personName: s.name_en || 'Student',
              className: classNameOf(s.class_id),
            }))
        : teachers.map((t) => ({
            personId: t.id,
            code: t.employee_code || '',
            personName: t.full_name || 'Staff',
            className: '',
          }));

    // Include people who have logs but are not in roster (only when no class filter)
    if (!(reportRole === 'student' && reportClassId)) {
      const known = new Set(roster.map((r) => r.personId));
      for (const [pid, logs] of logsByPerson) {
        if (!known.has(pid)) {
          roster.push({ personId: pid, code: logs[0]?.code || '', personName: logs[0]?.personName || 'Unknown', className: '' });
        }
      }
    }

    const summaries = roster.map((r) => {
      const logs = (logsByPerson.get(r.personId) ?? []).slice().sort((a, b) => b.attendance_date.localeCompare(a.attendance_date));
      // one record per date (duplicate scans protect)
      const perDate = new Map<string, ReportLog>();
      for (const l of logs) if (!perDate.has(l.attendance_date)) perDate.set(l.attendance_date, l);
      const uniq = Array.from(perDate.values());

      let present = 0, absent = 0, late = 0, leave = 0;
      for (const l of uniq) {
        const v = (l.status || '').toLowerCase();
        if (v === 'present') present++;
        else if (v === 'absent') absent++;
        else if (v === 'late') late++;
        else if (v === 'leave') leave++;
      }
      const marked = uniq.length;
      const percentage = workingDaysInRange > 0
        ? Math.min(100, Math.round(((present + late) / workingDaysInRange) * 1000) / 10)
        : 0;

      return {
        personId: r.personId,
        code: r.code,
        personName: r.personName,
        className: r.className,
        present,
        absent,
        late,
        leave,
        marked,
        workingDays: workingDaysInRange,
        unmarked: Math.max(0, workingDaysInRange - marked),
        percentage,
        logs: uniq,
      } as PersonSummary;
    });

    return summaries.sort((a, b) => a.personName.localeCompare(b.personName));
  }, [reportRole, reportLogs, students, teachers, classes, reportClassId, reportSectionId, workingDaysInRange]);

  const overallStats = useMemo(() => {
    const t = reportSummaries.reduce(
      (acc, s) => {
        acc.present += s.present;
        acc.absent += s.absent;
        acc.late += s.late;
        acc.leave += s.leave;
        acc.pct += s.percentage;
        return acc;
      },
      { present: 0, absent: 0, late: 0, leave: 0, pct: 0 }
    );
    return {
      people: reportSummaries.length,
      ...t,
      avg: reportSummaries.length ? Math.round((t.pct / reportSummaries.length) * 10) / 10 : 0,
    };
  }, [reportSummaries]);

  const detailSummary = useMemo(
    () => reportSummaries.find((s) => s.personId === detailPersonId) ?? null,
    [reportSummaries, detailPersonId]
  );

  const summaryColumns: TableColumn<PersonSummary>[] = [
    {
      key: 'code',
      header: reportRole === 'student' ? 'Adm No' : 'Emp Code',
      render: (r) => <span className="font-mono-tabular font-semibold">{r.code || '—'}</span>,
      exportValue: (r) => r.code,
    },
    {
      key: 'name',
      header: reportRole === 'student' ? 'Student' : 'Staff Name',
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{r.personName}</p>
          {reportRole === 'student' && r.className && (
            <p className="text-[11px] text-slate-500">{r.className}</p>
          )}
        </div>
      ),
      exportValue: (r) => r.personName,
    },
    { key: 'present', header: 'Present', align: 'right', render: (r) => <span className="font-mono-tabular text-emerald-700 dark:text-emerald-400 font-semibold">{r.present}</span>, exportValue: (r) => r.present },
    { key: 'absent', header: 'Absent', align: 'right', render: (r) => <span className="font-mono-tabular text-red-700 dark:text-red-400 font-semibold">{r.absent}</span>, exportValue: (r) => r.absent },
    { key: 'late', header: 'Late', align: 'right', render: (r) => <span className="font-mono-tabular text-amber-700 dark:text-amber-400 font-semibold">{r.late}</span>, exportValue: (r) => r.late },
    { key: 'leave', header: 'Leave', align: 'right', render: (r) => <span className="font-mono-tabular text-sky-700 dark:text-sky-400 font-semibold">{r.leave}</span>, exportValue: (r) => r.leave },
    {
      key: 'marked',
      header: 'Marked / Working',
      align: 'right',
      render: (r) => (
        <span className="font-mono-tabular text-[11px]">
          {r.marked} / {r.workingDays}
          {r.unmarked > 0 && <span className="ml-1 text-slate-400">({r.unmarked} unmarked)</span>}
        </span>
      ),
      exportValue: (r) => `${r.marked}/${r.workingDays}`,
    },
    {
      key: 'pct',
      header: 'Attendance %',
      align: 'right',
      render: (r) => (
        <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-bold font-mono-tabular ${pctColor(r.percentage)}`}>
          {r.percentage}%
        </span>
      ),
      exportValue: (r) => r.percentage,
    },
    {
      key: 'actions',
      header: 'Report',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          onClick={() => setDetailPersonId(r.personId)}
          className="inline-flex items-center gap-1 rounded border border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-2 py-1 text-[11px] font-semibold text-teal-700 dark:text-teal-300 hover:bg-teal-100"
        >
          <Eye className="h-3 w-3" />
          View
        </button>
      ),
    },
  ];

  const detailColumns: TableColumn<ReportLog>[] = [
    { key: 'date', header: 'Date', render: (r) => <span className="font-mono-tabular font-semibold">{r.attendance_date}</span>, exportValue: (r) => r.attendance_date },
    {
      key: 'day',
      header: 'Day',
      render: (r) => parseIso(r.attendance_date).toLocaleDateString('en-US', { weekday: 'short' }),
      exportValue: (r) => parseIso(r.attendance_date).toLocaleDateString('en-US', { weekday: 'short' }),
    },
    { key: 'status', header: 'Status', render: (r) => <span className={statusColor(r.status)}>{r.status}</span>, exportValue: (r) => r.status },
    { key: 'source', header: 'Source', render: (r) => r.source || 'manual', exportValue: (r) => r.source || 'manual' },
    ...(reportRole === 'student'
      ? [{
          key: 'gate',
          header: 'Gate IN / OUT',
          render: (r: ReportLog) => (
            <span className="font-mono-tabular text-[11px]">
              {r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString() : '—'} /{' '}
              {r.check_out_at ? new Date(r.check_out_at).toLocaleTimeString() : '—'}
            </span>
          ),
        } as TableColumn<ReportLog>]
      : []),
  ];

  const markStudent = async (studentId: string, status: 'Present' | 'Absent' | 'Late' | 'Leave') => {
    setBusyId(studentId);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'student', studentId, date, status, source: 'manual', allowOnHoliday }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Attendance error', description: data.error, variant: 'error' });
        return;
      }
      toast({
        title: `Marked ${status}`,
        description: data.appLinked
          ? 'Synced to Student App & attendance notification sent.'
          : 'Saved. Link Student App Access so this student can view attendance in the mobile app.',
        variant: 'success',
      });
      void loadData();
      if (tab === 'reports') void loadReportHistory(periodRange.start, periodRange.end);
    } finally {
      setBusyId(null);
    }
  };

  const markTeacher = async (teacherId: string, status: 'Present' | 'Absent' | 'Late' | 'Leave') => {
    setBusyId(teacherId);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'teacher', teacherId, date, status, allowOnHoliday }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Teacher attendance error', description: data.error, variant: 'error' });
        return;
      }
      toast({
        title: `Teacher marked ${status}`,
        description: data.salarySynced ? 'Monthly salary slip auto-recalculated from attendance.' : undefined,
        variant: 'success',
      });
      void loadData();
      void loadReportHistory(periodRange.start, periodRange.end);
    } finally {
      setBusyId(null);
    }
  };

  const playBeep = (type: 'success' | 'warning' | 'error') => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type === 'success' ? 'sine' : type === 'warning' ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(type === 'success' ? 880 : type === 'warning' ? 440 : 220, ctx.currentTime);
      if (type === 'success') {
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15);
      }
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (type === 'success' ? 0.3 : 0.5));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (type === 'success' ? 0.3 : 0.5));
    } catch {
      // Ignore audio context restrictions
    }
  };

  const handleQrGate = async (token: string) => {
    const match = students.find(
      (s) => s.student_id === token || s.qr_token === token || s.admission_number === token
    );
    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'student',
        studentId: match?.id,
        token: match ? undefined : token,
        date,
        status: 'Present',
        source: 'qr_gate',
        qrMode,
        allowOnHoliday,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.isDuplicate) {
        playBeep('warning');
        toast({ title: 'Duplicate Scan Prevented', description: data.error, variant: 'info' });
      } else {
        playBeep('error');
        toast({ title: 'QR gate error', description: data.error, variant: 'error' });
      }
      return;
    }
    playBeep('success');
    toast({
      title: `${data.studentName || match?.name_en || 'Student'} checked ${qrMode}`,
      description: data.appLinked ? 'Synced to Student App.' : 'Saved.',
      variant: 'success',
    });
    setManualToken('');
    void loadData();
  };

  const handleDeclareHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId('holiday-save');
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'declare_holiday', ...holidayForm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to save holiday', description: data.error, variant: 'error' });
        return;
      }
      toast({
        title: 'School Holiday Scheduled',
        description: holidayForm.notifyAll
          ? 'Attendance closed for holiday & notification sent to Students and Staff.'
          : 'Attendance closed for the selected holiday date(s).',
        variant: 'success',
      });
      setOpenHolidayModal(false);
      await loadData();
    } finally {
      setBusyId(null);
    }
  };

  const handleRemoveHoliday = async (eventId: string) => {
    setBusyId(eventId);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'remove_holiday', eventId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to remove holiday', description: data.error, variant: 'error' });
        return;
      }
      toast({ title: 'Holiday removed', variant: 'success' });
      await loadData();
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveWorkingDays = async (e: React.FormEvent) => {
    e.preventDefault();
    if (workingDaysDraft.length === 0) {
      toast({ title: 'Select at least 1 working day', variant: 'error' });
      return;
    }
    setBusyId('working-days');
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'update_working_days', workingDays: workingDaysDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to update working days', description: data.error, variant: 'error' });
        return;
      }
      toast({ title: 'Weekly working days updated', variant: 'success' });
      setOpenWorkingDaysModal(false);
      await loadData();
    } finally {
      setBusyId(null);
    }
  };

  const statusByStudentForDate = new Map<string, AttendanceLog>();
  for (const log of studentLogs) {
    if (log.attendance_date === date && !statusByStudentForDate.has(log.student_id)) {
      statusByStudentForDate.set(log.student_id, log);
    }
  }

  const statusByTeacherForDate = new Map<string, RawTeacherAttendanceRow>();
  for (const log of teacherLogs) {
    if (log.attendance_date === date && !statusByTeacherForDate.has(log.teacher_id)) {
      statusByTeacherForDate.set(log.teacher_id, log);
    }
  }

  const offDaysList = ALL_WEEK_DAYS.filter((d) => !workingDays.includes(d));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Attendance Management</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Manual attendance, QR Gate IN/OUT scanning, Teacher attendance, Holiday protection, and real-time Student App sync.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setHolidayForm({ title: '', startDate: date, endDate: date, description: '', notifyAll: true });
              setOpenHolidayModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            <CalendarOff className="h-3.5 w-3.5" />
            Declare Holiday
          </button>
          <button
            type="button"
            onClick={() => {
              setWorkingDaysDraft([...workingDays]);
              setOpenWorkingDaysModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <CalendarRange className="h-3.5 w-3.5" />
            Weekly Off: {offDaysList.length > 0 ? offDaysList.join(', ') : 'None'}
          </button>
          <Link
            href="/dashboard/leave-requests"
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Leave Requests & Approvals
          </Link>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setAllowOnHoliday(false);
            }}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-mono-tabular"
          />
        </div>
      </div>

      {holidayInfo.isHoliday && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-2.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <CalendarOff className="h-5 w-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <p className="font-display text-sm font-bold text-amber-950 dark:text-amber-100">
                  Holiday / Non-Working Day ({date}): {holidayInfo.title}
                </p>
                <p className="text-amber-900 dark:text-amber-200">
                  Attendance is automatically closed on holidays — no student or teacher needs to be marked, no Absent is recorded, and <strong>Teacher Salaries are 100% protected</strong> with zero deduction.
                </p>
                {holidayInfo.description && (
                  <p className="text-amber-800 dark:text-amber-300 italic">{holidayInfo.description}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {holidayInfo.eventId && (
                <button
                  type="button"
                  disabled={busyId === holidayInfo.eventId}
                  onClick={() => handleRemoveHoliday(holidayInfo.eventId!)}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-300 dark:border-red-900 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove Holiday
                </button>
              )}
            </div>
          </div>
          <label className="inline-flex items-center gap-2 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-amber-200 dark:border-amber-900 px-3 py-1.5 text-xs font-medium text-amber-950 dark:text-amber-200 cursor-pointer">
            <input type="checkbox" checked={allowOnHoliday} onChange={(e) => setAllowOnHoliday(e.target.checked)} />
            <span>Extra Class / Special Duty Override (unlock attendance marking on this holiday)</span>
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 p-1 w-fit border border-slate-200 dark:border-slate-800">
        {[
          { key: 'student_manual', label: 'Manual Student' },
          { key: 'qr_gate', label: 'QR Gate IN/OUT' },
          { key: 'teacher', label: 'Teacher Attendance' },
          { key: 'reports', label: 'Attendance Reports' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key as typeof tab)}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              tab === item.key
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'student_manual' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <label className="text-xs font-semibold">Select Class:</label>
            <select
              value={selectedClassId}
              onChange={(e) => {
                setSelectedClassId(e.target.value);
                setSelectedSectionId('');
              }}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold min-w-[160px]"
            >
              <option value="">-- Select Class --</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <label className="text-xs font-semibold">Select Section:</label>
            <select
              value={selectedSectionId}
              onChange={(e) => setSelectedSectionId(e.target.value)}
              disabled={!selectedClassId}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold min-w-[140px] disabled:opacity-50"
            >
              <option value="">All Sections</option>
              {filteredSections.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            {selectedClassId && (
              <span className="ml-auto rounded-lg bg-teal-700/10 text-teal-700 dark:text-teal-300 px-3 py-1.5 text-xs font-bold">
                {selectedClassName} - {filteredStudents.length} Students
              </span>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            {!selectedClassId ? (
              <div className="p-8 text-center text-xs text-slate-500">Please select a class to view students.</div>
            ) : filteredStudents.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No active students found in this class.</div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                  <tr>
                    <th className="px-4 py-3">Adm No</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Student App</th>
                    <th className="px-4 py-3">Status ({date})</th>
                    <th className="px-4 py-3 text-right">Mark Attendance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredStudents.map((s) => {
                    const marked = statusByStudentForDate.get(s.id);
                    const appLinked = Boolean(s.user_id && s.app_access_enabled && !s.app_blocked);
                    return (
                      <tr key={s.id}>
                        <td className="px-4 py-3 font-mono-tabular font-semibold">{s.admission_number}</td>
                        <td className="px-4 py-3 font-medium">{s.name_en}</td>
                        <td className="px-4 py-3 text-[11px]">
                          {appLinked ? (
                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">Synced</span>
                          ) : (
                            <Link href="/dashboard/app-access/students" className="text-amber-700 dark:text-amber-400 hover:underline font-medium">
                              App Not Linked
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {marked ? (
                            marked.status
                          ) : holidayInfo.isHoliday ? (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                              Holiday ({holidayInfo.title})
                            </span>
                          ) : (
                            <span className="text-slate-400">Not marked</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-1.5">
                            {(['Present', 'Absent', 'Late', 'Leave'] as const).map((status) => {
                              const active = marked?.status === status;
                              return (
                                <button
                                  key={status}
                                  type="button"
                                  disabled={busyId === s.id || attendanceLockedForHoliday}
                                  onClick={() => markStudent(s.id, status)}
                                  className={`rounded border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                    active
                                      ? 'border-teal-700 bg-teal-700 text-white'
                                      : 'border-slate-200 dark:border-slate-700 hover:bg-teal-700 hover:text-white'
                                  }`}
                                >
                                  {status}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'qr_gate' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          {attendanceLockedForHoliday ? (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 text-xs text-amber-900 dark:text-amber-200">
              QR Gate scanning is paused because <strong>{date}</strong> is a Holiday ({holidayInfo.title}). Enable <strong>Extra Class Override</strong> above if gate entry needs to be scanned today.
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQrMode('IN')}
                    className={`rounded-lg px-4 py-1.5 text-xs font-semibold ${qrMode === 'IN' ? 'bg-teal-700 text-white' : 'border border-slate-300 dark:border-slate-700'}`}
                  >
                    Gate IN Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => setQrMode('OUT')}
                    className={`rounded-lg px-4 py-1.5 text-xs font-semibold ${qrMode === 'OUT' ? 'bg-teal-700 text-white' : 'border border-slate-300 dark:border-slate-700'}`}
                  >
                    Gate OUT Mode
                  </button>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg">
                  Camera blocked or unavailable? Use manual admission number entry or click a student below.
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <QrGateScanner onScanToken={handleQrGate} />
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (manualToken.trim()) handleQrGate(manualToken.trim());
                    }}
                    className="flex gap-2"
                  >
                    <input
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      placeholder="Or enter Admission No, Student ID, or QR token..."
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                    />
                    <button type="submit" className="rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 text-xs font-semibold text-white">
                      Record {qrMode}
                    </button>
                  </form>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Quick Student List (Click to Record {qrMode})
                  </h4>
                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 pr-1">
                    {filteredStudents.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">{selectedClassId ? 'No students in this class.' : 'Please select a class in Manual Student tab first.'}</p>
                    ) : (
                      filteredStudents.map((s) => (
                        <div key={s.id} className="py-2 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">{s.name_en}</span>
                            <span className="ml-2 text-slate-500">({s.admission_number})</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleQrGate(s.admission_number)}
                            className="rounded-md bg-teal-700/10 hover:bg-teal-700 hover:text-white text-teal-700 dark:text-teal-400 px-2.5 py-1 text-[11px] font-medium transition-colors"
                          >
                            Mark {qrMode}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'teacher' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          {teachers.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">No active teachers found.</div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-3">Emp Code</th>
                  <th className="px-4 py-3">Staff Name</th>
                  <th className="px-4 py-3">Status ({date})</th>
                  <th className="px-4 py-3 text-right">Mark Attendance ({date})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {teachers.map((t) => {
                  const tMarked = statusByTeacherForDate.get(t.id);
                  return (
                    <tr key={t.id}>
                      <td className="px-4 py-3 font-mono-tabular font-semibold">{t.employee_code}</td>
                      <td className="px-4 py-3 font-medium">{t.full_name}</td>
                      <td className="px-4 py-3 font-medium">
                        {tMarked ? (
                          tMarked.status
                        ) : holidayInfo.isHoliday ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                            <ShieldCheck className="h-3 w-3" />
                            Paid Holiday (No Deduction)
                          </span>
                        ) : (
                          <span className="text-slate-400">Not marked</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1.5">
                          {(['Present', 'Absent', 'Late', 'Leave'] as const).map((status) => {
                            const active = tMarked?.status === status;
                            return (
                              <button
                                key={status}
                                type="button"
                                disabled={busyId === t.id || attendanceLockedForHoliday}
                                onClick={() => markTeacher(t.id, status)}
                                className={`rounded border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                  active
                                    ? 'border-teal-700 bg-teal-700 text-white'
                                    : 'border-slate-200 dark:border-slate-700 hover:bg-teal-700 hover:text-white'
                                }`}
                              >
                                {status}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ================= REPORTS TAB (NEW) ================= */}
      {tab === 'reports' && (
        <div className="space-y-4">
          {/* Role toggle + Period filter */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-950 p-1 border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setReportRole('student')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors ${
                  reportRole === 'student' ? 'bg-teal-700 text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <GraduationCap className="h-3.5 w-3.5" />
                Student Report
              </button>
              <button
                type="button"
                onClick={() => setReportRole('teacher')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors ${
                  reportRole === 'teacher' ? 'bg-teal-700 text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                Teacher Report
              </button>
            </div>

            <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-950 p-1 border border-slate-200 dark:border-slate-800">
              {([
                { key: 'daily', label: 'Daily' },
                { key: 'weekly', label: 'Weekly' },
                { key: 'monthly', label: 'Monthly' },
                { key: 'yearly', label: 'Yearly' },
              ] as const).map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setReportPeriod(p.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    reportPeriod === p.key ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {reportRole === 'student' && (
              <>
                <select
                  value={reportClassId}
                  onChange={(e) => {
                    setReportClassId(e.target.value);
                    setReportSectionId('');
                  }}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-semibold min-w-[150px]"
                >
                  <option value="">All Classes</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  value={reportSectionId}
                  onChange={(e) => setReportSectionId(e.target.value)}
                  disabled={!reportClassId}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-semibold min-w-[130px] disabled:opacity-50"
                >
                  <option value="">All Sections</option>
                  {reportSections.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </>
            )}

            <button
              type="button"
              onClick={() => void loadReportHistory(periodRange.start, periodRange.end)}
              className="ml-auto rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {reportLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {/* Period info + overall stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              { label: 'Period', value: periodRange.label },
              { label: reportRole === 'student' ? 'Students' : 'Teachers', value: String(overallStats.people) },
              { label: 'Working Days', value: String(workingDaysInRange) },
              { label: 'Present', value: String(overallStats.present) },
              { label: 'Absent', value: String(overallStats.absent) },
              { label: 'Average %', value: `${overallStats.avg}%` },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">{s.label}</p>
                <p className="font-display text-sm font-bold text-slate-900 dark:text-white truncate">{s.value}</p>
              </div>
            ))}
          </div>

          {workingDaysInRange === 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-[11px] text-amber-900 dark:text-amber-200">
              Is period mein koi working day nahi hai (ya selected date future mein hai) — is liye percentage 0% show ho raha hai.
            </div>
          )}

          {/* DETAIL: ek shakhs ki alag report */}
          {detailSummary ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 dark:border-teal-900 bg-teal-50/60 dark:bg-teal-950/20 p-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setDetailPersonId(null)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Back to all
                  </button>
                  <div>
                    <p className="font-display text-sm font-bold text-slate-900 dark:text-white">
                      {detailSummary.personName}
                      <span className="ml-2 font-mono-tabular text-[11px] font-semibold text-slate-500">
                        {detailSummary.code}
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      {reportRole === 'student' ? 'Student' : 'Teacher'} · {periodRange.label}
                      {detailSummary.className ? ` · ${detailSummary.className}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="rounded bg-emerald-100 dark:bg-emerald-950/60 px-2 py-1 text-emerald-800 dark:text-emerald-300">P {detailSummary.present}</span>
                  <span className="rounded bg-red-100 dark:bg-red-950/60 px-2 py-1 text-red-800 dark:text-red-300">A {detailSummary.absent}</span>
                  <span className="rounded bg-amber-100 dark:bg-amber-950/60 px-2 py-1 text-amber-800 dark:text-amber-300">L {detailSummary.late}</span>
                  <span className="rounded bg-sky-100 dark:bg-sky-950/60 px-2 py-1 text-sky-800 dark:text-sky-300">Lv {detailSummary.leave}</span>
                  <span className={`rounded border px-2 py-1 font-mono-tabular ${pctColor(detailSummary.percentage)}`}>{detailSummary.percentage}%</span>
                </div>
              </div>

              <DataTable
                title={`${detailSummary.personName} — ${reportPeriod.charAt(0).toUpperCase() + reportPeriod.slice(1)} Attendance`}
                subtitle={`${periodRange.start} → ${periodRange.end} · ${detailSummary.marked} marked of ${detailSummary.workingDays} working days`}
                rows={detailSummary.logs}
                columns={detailColumns}
                loading={reportLoading}
                getRowKey={(r) => r.id}
                getSearchText={(r) => `${r.attendance_date} ${r.status} ${r.source || ''}`}
                exportFileName={`${reportRole}-${detailSummary.code || detailSummary.personId}-${reportPeriod}-${periodRange.start}`}
              />
            </div>
          ) : (
            /* SUMMARY: har student / har teacher ki alag row */
            <DataTable
              title={`${reportRole === 'student' ? 'Student' : 'Teacher'} Attendance Reports`}
              subtitle={`${periodRange.label} · ${periodRange.start} → ${periodRange.end} · ${workingDaysInRange} working days (holidays excluded) · ${reportLogs.length} records loaded · Click "View" for individual report`}
              rows={reportSummaries}
              columns={summaryColumns}
              loading={reportLoading}
              getRowKey={(r) => r.personId}
              getSearchText={(r) => `${r.code} ${r.personName} ${r.className}`}
              exportFileName={`${reportRole}-attendance-summary-${reportPeriod}-${periodRange.start}`}
            />
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-bold">Scheduled School Holidays</h2>
            <p className="text-[11px] text-slate-500">
              Working days: <span className="font-semibold text-slate-700 dark:text-slate-300">{workingDays.join(', ')}</span> · Off days:{' '}
              <span className="font-semibold text-amber-700 dark:text-amber-400">{offDaysList.length > 0 ? offDaysList.join(', ') : 'None'}</span>
            </p>
          </div>
          <Link href="/dashboard/timetable" className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline">
            View Full School Calendar →
          </Link>
        </div>

        {holidays.length === 0 ? (
          <p className="text-xs text-slate-500">
            No custom holidays declared yet. Weekly off days ({offDaysList.join(', ') || 'None'}) automatically apply as holidays.
          </p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {holidays.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{h.title}</p>
                  {h.description && <p className="text-[11px] text-slate-500">{h.description}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setDate(String(h.start_date).slice(0, 10));
                      setAllowOnHoliday(false);
                    }}
                    className="font-mono-tabular text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline"
                  >
                    {String(h.start_date).slice(0, 10)}
                    {h.end_date && h.end_date !== h.start_date ? ` → ${String(h.end_date).slice(0, 10)}` : ''}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === h.id}
                    onClick={() => handleRemoveHoliday(h.id)}
                    className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ModalDialog open={openHolidayModal} onClose={() => setOpenHolidayModal(false)} title="Declare School Holiday">
        <form onSubmit={handleDeclareHoliday} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Holiday Title *</label>
            <input
              required
              value={holidayForm.title}
              onChange={(e) => setHolidayForm({ ...holidayForm, title: e.target.value })}
              placeholder="e.g. Eid-ul-Fitr Holiday, Quaid-e-Azam Day, Winter Break"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">From Date *</label>
              <input
                type="date"
                required
                value={holidayForm.startDate}
                onChange={(e) =>
                  setHolidayForm({
                    ...holidayForm,
                    startDate: e.target.value,
                    endDate: holidayForm.endDate < e.target.value ? e.target.value : holidayForm.endDate,
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block font-medium">To Date *</label>
              <input
                type="date"
                required
                min={holidayForm.startDate}
                value={holidayForm.endDate}
                onChange={(e) => setHolidayForm({ ...holidayForm, endDate: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>
          <div>
            <label className="block font-medium">Note / Instructions (Optional)</label>
            <textarea
              rows={2}
              value={holidayForm.description}
              onChange={(e) => setHolidayForm({ ...holidayForm, description: e.target.value })}
              placeholder="e.g. School will reopen on Monday at 8:00 AM."
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={holidayForm.notifyAll}
              onChange={(e) => setHolidayForm({ ...holidayForm, notifyAll: e.target.checked })}
            />
            <span>Notify all Students & Teachers (shows in Student Portal & Alerts)</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpenHolidayModal(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busyId === 'holiday-save'}
              className="rounded-lg bg-amber-600 hover:bg-amber-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {busyId === 'holiday-save' ? 'Saving...' : 'Save Holiday'}
            </button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog open={openWorkingDaysModal} onClose={() => setOpenWorkingDaysModal(false)} title="Configure School Working Days">
        <form onSubmit={handleSaveWorkingDays} className="space-y-4 text-xs">
          <p className="text-slate-500">
            Select the days your school is open. Unchecked days (e.g., Sunday) are automatically treated as weekly holidays across Attendance and Payroll.
          </p>
          <div className="flex flex-wrap gap-2">
            {ALL_WEEK_DAYS.map((day) => {
              const checked = workingDaysDraft.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() =>
                    setWorkingDaysDraft((prev) =>
                      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                    )
                  }
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                    checked
                      ? 'border-teal-700 bg-teal-700 text-white'
                      : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {day} {checked ? '(Open)' : '(Holiday)'}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpenWorkingDaysModal(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busyId === 'working-days'}
              className="rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {busyId === 'working-days' ? 'Saving...' : 'Save Working Days'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}