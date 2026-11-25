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
import { CalendarOff, CalendarRange, ShieldCheck, Trash2 } from 'lucide-react';

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

export default function AttendancePage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [tab, setTab] = useState<'student_manual' | 'qr_gate' | 'teacher' | 'reports'>('student_manual');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reportPeriod, setReportPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [students, setStudents] = useState<StudentBasic[]>([]);
  const [teachers, setTeachers] = useState<TeacherBasic[]>([]);
  const [classes, setClasses] = useState<ClassBasic[]>([]);
  const [sections, setSections] = useState<SectionBasic[]>([]);
  // --- NEW: Class-wise filter ---
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');
  const [studentLogs, setStudentLogs] = useState<AttendanceLog[]>([]);
  const [teacherLogs, setTeacherLogs] = useState<RawTeacherAttendanceRow[]>([]);
  const [workingDays, setWorkingDays] = useState<string[]>([...DEFAULT_WORKING_DAYS]);
  const [holidays, setHolidays] = useState<SchoolHolidayEvent[]>([]);
  const [allowOnHoliday, setAllowOnHoliday] = useState(false);

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
    // --- ONLY FIX: Classes / Sections - fetch directly with * so column name doesn't matter ---
    // 1. Try backend first
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
      // If backend gave IDs as names (like "Class bdca17f6"), treat as empty and refetch below
      const looksLikeId = finalClasses.length > 0 && finalClasses.every((c) => /^[a-f0-9-]{8,}/i.test(c.name.replace('Class ', '')));
      if (looksLikeId) finalClasses = [];
    }
    // 2. Direct Supabase fetch - this fixes the ID problem even if backend column is wrong
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
          // Sections also directly
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
        () => {
          void loadData();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'school_calendar_events', filter: `school_id=eq.${school.id}` },
        () => {
          void loadData();
        }
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

  // --- NEW: Filtered students by Class / Section ---
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

  const markStudent = async (studentId: string, status: 'Present' | 'Absent' | 'Late' | 'Leave') => {
    setBusyId(studentId);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'student',
          studentId,
          date,
          status,
          source: 'manual',
          allowOnHoliday,
        }),
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
        body: JSON.stringify({
          type: 'teacher',
          teacherId,
          date,
          status,
          allowOnHoliday,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Teacher attendance error', description: data.error, variant: 'error' });
        return;
      }
      toast({
        title: `Teacher marked ${status}`,
        description: data.salarySynced
          ? 'Monthly salary slip auto-recalculated from attendance.'
          : undefined,
        variant: 'success',
      });
      void loadData();
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
        body: JSON.stringify({
          type: 'declare_holiday',
          ...holidayForm,
        }),
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
        body: JSON.stringify({
          type: 'update_working_days',
          workingDays: workingDaysDraft,
        }),
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

  const reportLogs = studentLogs.filter((l) => {
    const diffDays = (new Date(date).getTime() - new Date(l.attendance_date).getTime()) / (1000 * 86400);
    if (reportPeriod === 'daily') return l.attendance_date === date;
    if (reportPeriod === 'weekly') return diffDays >= 0 && diffDays <= 7;
    if (reportPeriod === 'monthly') return l.attendance_date.startsWith(date.slice(0, 7));
    return l.attendance_date.startsWith(date.slice(0, 4));
  });

  const reportColumns: TableColumn<AttendanceLog>[] = [
    { key: 'code', header: 'Adm No', render: (r) => <span className="font-mono-tabular">{r.code}</span>, exportValue: (r) => r.code },
    { key: 'name', header: 'Student', render: (r) => r.personName, exportValue: (r) => r.personName },
    { key: 'date', header: 'Date', render: (r) => <span className="font-mono-tabular">{r.attendance_date}</span>, exportValue: (r) => r.attendance_date },
    { key: 'status', header: 'Status', render: (r) => r.status, exportValue: (r) => r.status },
    { key: 'source', header: 'Source', render: (r) => r.source || 'manual', exportValue: (r) => r.source || 'manual' },
    {
      key: 'gate',
      header: 'Gate IN / OUT',
      render: (r) => (
        <span className="font-mono-tabular text-[11px]">
          {r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString() : '—'} /{' '}
          {r.check_out_at ? new Date(r.check_out_at).toLocaleTimeString() : '—'}
        </span>
      ),
    },
  ];

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
              setHolidayForm({
                title: '',
                startDate: date,
                endDate: date,
                description: '',
                notifyAll: true,
              });
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
            <input
              type="checkbox"
              checked={allowOnHoliday}
              onChange={(e) => setAllowOnHoliday(e.target.checked)}
            />
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
          {/* --- NEW: Class-wise Filter Bar --- */}
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
                            <Link
                              href="/dashboard/app-access/students"
                              className="text-amber-700 dark:text-amber-400 hover:underline font-medium"
                            >
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

      {tab === 'reports' && (
        <DataTable
          title="Attendance Reports"
          rows={reportLogs}
          columns={reportColumns}
          getRowKey={(r) => r.id}
          getSearchText={(r) => `${r.code} ${r.personName} ${r.status}`}
          exportFileName={`attendance-${reportPeriod}-${date}`}
          filters={
            <select
              value={reportPeriod}
              onChange={(e) => setReportPeriod(e.target.value as typeof reportPeriod)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            >
              <option value="daily">Daily Report</option>
              <option value="weekly">Weekly Report</option>
              <option value="monthly">Monthly Report</option>
              <option value="yearly">Yearly Report</option>
            </select>
          }
        />
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

      <ModalDialog
        open={openHolidayModal}
        onClose={() => setOpenHolidayModal(false)}
        title="Declare School Holiday"
      >
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

      <ModalDialog
        open={openWorkingDaysModal}
        onClose={() => setOpenWorkingDaysModal(false)}
        title="Configure School Working Days"
      >
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