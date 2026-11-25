'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { generateSalarySlipPdf } from '@/lib/pdf/generators';
import { DEFAULT_WORKING_DAYS, getDateHolidayInfo, type SchoolHolidayEvent } from '@/lib/attendance/holidays';
import { useTheme } from '@/components/providers/theme-provider';
import { PortalComplaintsTab } from '@/components/complaints/portal-complaints-tab';
import type { ComplaintItem } from '@/lib/complaints/complaint-service';
import {
  AlertTriangle,
  Award,
  Bell,
  BookOpen,
  CalendarCheck2,
  CalendarOff,
  CheckCircle2,
  Clock,
  Download,
  LogOut,
  MessageSquareWarning,
  Moon,
  Send,
  Sun,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';

interface TeacherInfo {
  id: string;
  school_id: string;
  employee_code: string;
  full_name: string;
  designation: string;
  department: string;
  qualification: string | null;
  email: string | null;
  mobile_number: string;
  photo_url: string | null;
  salary_pkr: number;
}

interface SchoolInfo {
  id: string;
  name_en: string;
  address: string;
  city: string;
  phone: string;
  logo_url: string | null;
}

interface AssignmentItem {
  id: string;
  class_id: string;
  className: string;
  section_id: string | null;
  sectionName: string;
  subject_id: string | null;
  subjectName: string;
  is_class_incharge: boolean;
}

interface StudentRow {
  id: string;
  admission_number: string;
  roll_number: string | null;
  name_en: string;
  class_id: string | null;
  section_id: string | null;
}

interface AttendanceRecord {
  id: string;
  student_id: string;
  attendance_date: string;
  status: 'Present' | 'Absent' | 'Late' | 'Leave';
}

interface TeacherAttendanceRow {
  id: string;
  attendance_date: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
}

interface SalarySlipRow {
  id: string;
  payroll_month: string;
  base_salary: number;
  allowances: number;
  bonuses: number;
  deductions: number;
  advance_salary: number;
  absent_days: number;
  attendance_deduction: number;
  net_salary: number;
  status: string;
  payment_method: string | null;
}

interface LeaveItem {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: string;
  reviewerNote: string | null;
}

interface HomeworkRow {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  class_id: string;
  section_id?: string | null;
  subject_id: string;
  created_at?: string;
}

interface ExamRow {
  id: string;
  title: string;
  exam_type: string;
  start_date: string;
}

interface MarkRow {
  id: string;
  exam_id: string;
  student_id: string;
  subject_id: string;
  total_marks: number;
  passing_marks?: number;
  obtained_marks: number;
  attendance_status?: string;
  grade: string;
}

interface NotificationRow {
  id: string;
  category: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export default function TeacherPortalPage() {
  const { theme, toggleTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'attendance' | 'homework' | 'marks' | 'leaves' | 'complaints' | 'salary' | 'notifications' | 'leaving'
  >('attendance');

  const [teacher, setTeacher] = useState<TeacherInfo | null>(null);
  const [school, setSchool] = useState<SchoolInfo | null>(null);
  const [hasSchoolAdminAccess, setHasSchoolAdminAccess] = useState(false);
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [sections, setSections] = useState<Array<{ id: string; name: string; class_id: string }>>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [studentAttendance, setStudentAttendance] = useState<AttendanceRecord[]>([]);
  const [teacherAttendance, setTeacherAttendance] = useState<TeacherAttendanceRow[]>([]);
  const [salarySlips, setSalarySlips] = useState<SalarySlipRow[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveItem[]>([]);
  const [complaints, setComplaints] = useState<ComplaintItem[]>([]);
  const [homework, setHomework] = useState<HomeworkRow[]>([]);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [workingDays, setWorkingDays] = useState<string[]>([...DEFAULT_WORKING_DAYS]);
  const [holidays, setHolidays] = useState<SchoolHolidayEvent[]>([]);

  const nowLocal = new Date();
  const todayStr = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [selectedClassId, setSelectedClassId] = useState('All');
  const [attDrafts, setAttDrafts] = useState<Record<string, 'Present' | 'Absent' | 'Late' | 'Leave'>>({});
  const [attBusy, setAttBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [hwForm, setHwForm] = useState({
    classId: '',
    sectionId: '',
    subjectId: '',
    title: '',
    description: '',
    homeworkDate: todayStr,
    dueDate: todayStr,
  });
  const [hwBusy, setHwBusy] = useState(false);

  const [marksExamId, setMarksExamId] = useState('');
  const [marksSubjectId, setMarksSubjectId] = useState('');
  const [marksClassId, setMarksClassId] = useState('All');
  const [totalMarks, setTotalMarks] = useState('100');
  const [passingMarks, setPassingMarks] = useState('33');
  const [marksDraft, setMarksDraft] = useState<Record<string, string>>({});
  const [marksBusy, setMarksBusy] = useState(false);

  const [leaveForm, setLeaveForm] = useState({
    leaveType: 'Casual',
    startDate: todayStr,
    endDate: todayStr,
    reason: '',
  });
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leavingReason, setLeavingReason] = useState('');
  const [leavingBusy, setLeavingBusy] = useState(false);

  const handleRequestLeaving = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirm('Are you sure you want to submit a school leaving / resignation request? This will deactivate your teacher portal access and notify school administration.')) return;
    setLeavingBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/teacher-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request_school_leaving',
          reason: leavingReason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Unable to submit leaving request.' });
        return;
      }
      setFeedback({ type: 'success', text: 'School leaving request submitted successfully. Portal access deactivated.' });
      setTimeout(() => {
        window.location.assign('/login');
      }, 2000);
    } finally {
      setLeavingBusy(false);
    }
  };

  const loadPortal = useCallback(async () => {
    try {
      const res = await fetch('/api/teacher-portal', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.assign('/login?next=/teacher-portal&portal=teacher');
        return;
      }
      if (!res.ok) {
        setErrorMsg(data.error || 'Unable to load Teacher Portal.');
        setLoading(false);
        return;
      }
      setTeacher(data.teacher);
      setSchool(data.school);
      setHasSchoolAdminAccess(Boolean(data.hasSchoolAdminAccess));
      setAssignments(data.assignments ?? []);
      setStudents(data.students ?? []);
      setClasses(data.classes ?? []);
      setSections(data.sections ?? []);
      setSubjects(data.subjects ?? []);
      setStudentAttendance(data.studentAttendance ?? []);
      setTeacherAttendance(data.teacherAttendance ?? []);
      setSalarySlips(data.salarySlips ?? []);
      setLeaveRequests(data.leaveRequests ?? []);
      setComplaints(data.complaints ?? []);
      setHomework(data.homework ?? []);
      setExams(data.exams ?? []);
      setMarks(data.marks ?? []);
      setNotifications(data.notifications ?? []);
      if (Array.isArray(data.workingDays)) setWorkingDays(data.workingDays);
      if (Array.isArray(data.holidays)) setHolidays(data.holidays);
      setErrorMsg(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadPortal();
    });
  }, [loadPortal]);

  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);
  const sectionMap = useMemo(() => new Map(sections.map((s) => [s.id, s.name])), [sections]);
  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);

  const effectiveHwClassId = hwForm.classId || classes[0]?.id || '';
  const hwClassSections = useMemo(
    () => sections.filter((s) => s.class_id === effectiveHwClassId),
    [sections, effectiveHwClassId]
  );
  const effectiveHwSectionId =
    hwForm.sectionId && hwClassSections.some((s) => s.id === hwForm.sectionId)
      ? hwForm.sectionId
      : '';
  const effectiveHwSubjectId = hwForm.subjectId || subjects[0]?.id || '';
  const effectiveMarksExamId = marksExamId || exams[0]?.id || '';
  const effectiveMarksSubjectId = marksSubjectId || subjects[0]?.id || '';

  const filteredStudents = useMemo(() => {
    if (selectedClassId === 'All') return students;
    return students.filter((s) => s.class_id === selectedClassId);
  }, [students, selectedClassId]);

  const marksStudents = useMemo(() => {
    if (marksClassId === 'All') return students;
    return students.filter((s) => s.class_id === marksClassId);
  }, [students, marksClassId]);

  const existingAttendanceForDate = useMemo(() => {
    const map = new Map<string, 'Present' | 'Absent' | 'Late' | 'Leave'>();
    for (const row of studentAttendance) {
      if (String(row.attendance_date).slice(0, 10) === selectedDate) {
        map.set(row.student_id, row.status);
      }
    }
    return map;
  }, [studentAttendance, selectedDate]);

  const existingMarksMap = useMemo(() => {
    const map = new Map<string, MarkRow>();
    for (const m of marks) {
      if (m.exam_id === effectiveMarksExamId && m.subject_id === effectiveMarksSubjectId) {
        map.set(m.student_id, m);
      }
    }
    return map;
  }, [marks, effectiveMarksExamId, effectiveMarksSubjectId]);

  const unreadNotifs = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const todayHoliday = useMemo(
    () => getDateHolidayInfo(todayStr, workingDays, holidays),
    [todayStr, workingDays, holidays]
  );

  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => null);
    window.location.assign('/login');
  };

  const handleSaveAttendance = async () => {
    if (filteredStudents.length === 0) return;
    setAttBusy(true);
    setFeedback(null);
    try {
      const records = filteredStudents.map((stu) => ({
        studentId: stu.id,
        classId: stu.class_id,
        sectionId: stu.section_id,
        status: attDrafts[stu.id] || existingAttendanceForDate.get(stu.id) || 'Present',
      }));
      const res = await fetch('/api/teacher-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_student_attendance',
          attendanceDate: selectedDate,
          records,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Unable to save attendance.' });
        return;
      }
      setFeedback({ type: 'success', text: `Attendance saved for ${records.length} student(s) on ${selectedDate}.` });
      await loadPortal();
    } finally {
      setAttBusy(false);
    }
  };

  const handleCreateHomework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveHwClassId || !effectiveHwSubjectId) return;
    setHwBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/teacher-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_homework',
          classId: effectiveHwClassId,
          sectionId: effectiveHwSectionId || null,
          subjectId: effectiveHwSubjectId,
          title: hwForm.title,
          description: hwForm.description,
          homeworkDate: hwForm.homeworkDate,
          dueDate: hwForm.dueDate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Unable to save daily homework.' });
        return;
      }
      setFeedback({ type: 'success', text: 'Daily homework saved & synced with Student App.' });
      setHwForm({ ...hwForm, title: '', description: '' });
      await loadPortal();
    } finally {
      setHwBusy(false);
    }
  };

  const handleSaveMarks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveMarksExamId || !effectiveMarksSubjectId || marksStudents.length === 0) return;
    setMarksBusy(true);
    setFeedback(null);
    try {
      const entries = marksStudents
        .map((stu) => {
          const valStr =
            marksDraft[stu.id] !== undefined
              ? marksDraft[stu.id]
              : existingMarksMap.has(stu.id)
                ? String(existingMarksMap.get(stu.id)!.obtained_marks)
                : '';
          if (valStr.trim() === '') return null;
          return {
            studentId: stu.id,
            obtainedMarks: Number(valStr),
            attendanceStatus: 'Present' as const,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      if (entries.length === 0) {
        setFeedback({ type: 'error', text: 'Enter obtained marks for at least one student.' });
        return;
      }

      const res = await fetch('/api/teacher-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_exam_marks',
          examId: effectiveMarksExamId,
          subjectId: effectiveMarksSubjectId,
          totalMarks: Number(totalMarks || 100),
          passingMarks: Number(passingMarks || 33),
          entries,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Unable to save exam marks.' });
        return;
      }
      setFeedback({ type: 'success', text: `Saved exam marks for ${entries.length} student(s).` });
      await loadPortal();
    } finally {
      setMarksBusy(false);
    }
  };

  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLeaveBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/teacher-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply_leave',
          ...leaveForm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Unable to submit leave request.' });
        return;
      }
      setFeedback({ type: 'success', text: 'Leave application submitted to School Admin.' });
      setLeaveForm({ leaveType: 'Casual', startDate: todayStr, endDate: todayStr, reason: '' });
      await loadPortal();
    } finally {
      setLeaveBusy(false);
    }
  };

  const markNotifRead = async (id: string) => {
    await fetch('/api/teacher-portal', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationId: id }),
    });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-sm text-slate-500">
        Loading Teacher Portal...
      </div>
    );
  }

  if (errorMsg || !teacher || !school) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center space-y-4">
          <AlertTriangle className="h-10 w-10 text-amber-600 mx-auto" />
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            Teacher Portal Unavailable
          </h1>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            {errorMsg || 'No active teacher account is linked to this sign-in email.'}
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Link
              href="/login?portal=teacher"
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              Sign In with Teacher Email
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white"
            >
              Sign Out & Switch Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            {school.logo_url ? (
              <img
                src={school.logo_url}
                alt={school.name_en}
                referrerPolicy="no-referrer"
                className="h-10 w-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-700 text-xs font-bold text-white">
                {school.name_en.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-sky-700 dark:text-sky-400">
                {school.name_en} · Teacher Portal
              </p>
              <h1 className="truncate font-display text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                {teacher.full_name}{' '}
                <span className="font-mono-tabular text-xs font-normal text-slate-500">
                  ({teacher.employee_code} · {teacher.designation})
                </span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasSchoolAdminAccess && (
              <Link
                href="/dashboard"
                className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                School Portal
              </Link>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg border border-slate-200 dark:border-slate-800 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-6">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 flex flex-wrap items-center gap-4">
          {teacher.photo_url ? (
            <img
              src={teacher.photo_url}
              alt={teacher.full_name}
              referrerPolicy="no-referrer"
              className="h-16 w-16 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-900 text-lg font-bold text-sky-700 dark:text-sky-300">
              {teacher.full_name
                .split(' ')
                .slice(0, 2)
                .map((p) => p[0] || '')
                .join('')
                .toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                {teacher.full_name}
              </h2>
              <span className="rounded bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-900 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                Active Teacher Account
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Code: <span className="font-mono-tabular font-semibold">{teacher.employee_code}</span> ·{' '}
              {teacher.designation} ({teacher.department})
              {teacher.qualification ? ` · ${teacher.qualification}` : ''}
            </p>
            <p className="text-xs text-slate-500">
              Registered Login Email:{' '}
              <span className="font-mono-tabular font-semibold text-slate-700 dark:text-slate-300">
                {teacher.email || '—'}
              </span>
            </p>
          </div>
          {assignments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {assignments.map((a) => (
                <span
                  key={a.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1 text-[11px] font-medium"
                >
                  {a.className}
                  {a.sectionName && a.sectionName !== 'All Sections' ? ` (${a.sectionName})` : ''}
                  {a.subjectName ? ` · ${a.subjectName}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>

        {todayHoliday.isHoliday && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2.5">
            <CalendarOff className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <span>
              <strong>Today is a School Holiday ({todayHoliday.title})</strong>
            </span>
          </div>
        )}

        {feedback && (
          <div
            className={`rounded-xl border px-4 py-3 text-xs ${
              feedback.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 text-red-800 dark:text-red-200'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-[11px] font-medium text-slate-500">Assigned Classes</p>
            <p className="mt-1 font-mono-tabular text-lg font-bold">{assignments.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-[11px] font-medium text-slate-500">My Students</p>
            <p className="mt-1 font-mono-tabular text-lg font-bold">{students.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-[11px] font-medium text-slate-500">Pending Leaves</p>
            <p className="mt-1 font-mono-tabular text-lg font-bold">
              {leaveRequests.filter((l) => l.status === 'Pending').length}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-[11px] font-medium text-slate-500">Base Monthly Salary</p>
            <p className="mt-1 font-mono-tabular text-lg font-bold text-teal-700 dark:text-teal-400">
              PKR {Number(teacher.salary_pkr || 0).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          {[
            { id: 'attendance', label: `Student Attendance (${students.length})`, icon: Users },
            { id: 'homework', label: `Daily Homework (${homework.length})`, icon: BookOpen },
            { id: 'marks', label: `Exam Marks (${exams.length})`, icon: Award },
            { id: 'leaves', label: `Leave Requests (${leaveRequests.length})`, icon: CalendarOff },
            { id: 'complaints', label: `Complaints (${complaints.length})`, icon: MessageSquareWarning },
            { id: 'salary', label: `My Attendance & Salary (${salarySlips.length})`, icon: Wallet },
            { id: 'notifications', label: `Alerts (${unreadNotifs} unread)`, icon: Bell },
            { id: 'leaving', label: 'School Leaving / Resign', icon: XCircle },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-teal-700 text-white'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'attendance' && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold">Mark Student Attendance</h2>
                <p className="text-[11px] text-slate-500">
                  Attendance marked here syncs live to School Admin and Student Portal.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono-tabular"
                />
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                >
                  <option value="All">All Classes</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={attBusy || filteredStudents.length === 0}
                  onClick={() => void handleSaveAttendance()}
                  className="rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {attBusy ? 'Saving...' : 'Save Attendance'}
                </button>
              </div>
            </div>

            {filteredStudents.length === 0 ? (
              <p className="text-xs text-slate-500">No active students found in this filter.</p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {filteredStudents.map((stu) => {
                  const currentStatus =
                    attDrafts[stu.id] || existingAttendanceForDate.get(stu.id) || 'Present';
                  return (
                    <div key={stu.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{stu.name_en}</p>
                        <p className="text-[11px] text-slate-500">
                          {stu.admission_number} · {(stu.class_id && classMap.get(stu.class_id)) || 'Unassigned'}
                          {stu.section_id && sectionMap.get(stu.section_id) ? ` (${sectionMap.get(stu.section_id)})` : ''}
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        {(['Present', 'Absent', 'Late', 'Leave'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setAttDrafts((prev) => ({ ...prev, [stu.id]: st }))}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border ${
                              currentStatus === st
                                ? st === 'Present'
                                  ? 'bg-emerald-700 text-white border-emerald-700'
                                  : st === 'Absent'
                                    ? 'bg-red-600 text-white border-red-600'
                                    : st === 'Late'
                                      ? 'bg-amber-600 text-white border-amber-600'
                                      : 'bg-sky-700 text-white border-sky-700'
                                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'homework' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <form
              onSubmit={handleCreateHomework}
              className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs h-fit"
            >
              <h2 className="font-display text-sm font-bold">Add Daily Homework</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium">Class *</label>
                  <select
                    required
                    value={effectiveHwClassId}
                    onChange={(e) => setHwForm({ ...hwForm, classId: e.target.value, sectionId: '' })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium">Section</label>
                  <select
                    value={effectiveHwSectionId}
                    onChange={(e) => setHwForm({ ...hwForm, sectionId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  >
                    <option value="">All Sections</option>
                    {hwClassSections.map((s) => (
                      <option key={s.id} value={s.id}>Section {s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium">Subject *</label>
                <select
                  required
                  value={effectiveHwSubjectId}
                  onChange={(e) => setHwForm({ ...hwForm, subjectId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium">Title *</label>
                <input
                  required
                  value={hwForm.title}
                  onChange={(e) => setHwForm({ ...hwForm, title: e.target.value })}
                  placeholder="Chapter 3 Exercise"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium">Homework Date *</label>
                  <input
                    type="date"
                    required
                    value={hwForm.homeworkDate}
                    onChange={(e) =>
                      setHwForm((prev) => ({
                        ...prev,
                        homeworkDate: e.target.value,
                        dueDate: prev.dueDate < e.target.value ? e.target.value : prev.dueDate,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block font-medium">Due Date *</label>
                  <input
                    type="date"
                    required
                    value={hwForm.dueDate}
                    onChange={(e) => setHwForm({ ...hwForm, dueDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono-tabular"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium">Instructions</label>
                <textarea
                  rows={3}
                  value={hwForm.description}
                  onChange={(e) => setHwForm({ ...hwForm, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={hwBusy || classes.length === 0 || subjects.length === 0}
                className="w-full rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {hwBusy ? 'Saving...' : 'Save Daily Homework'}
              </button>
            </form>

            <div className="lg:col-span-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h2 className="font-display text-sm font-bold">Recent Daily Homework</h2>
              {homework.length === 0 ? (
                <p className="text-xs text-slate-500">No daily homework created yet.</p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {homework.map((hw) => {
                    const secName = hw.section_id ? sectionMap.get(hw.section_id) : null;
                    const hwDateStr = hw.created_at ? hw.created_at.slice(0, 10) : hw.due_date;
                    return (
                      <div key={hw.id} className="py-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-slate-900 dark:text-white">{hw.title}</p>
                          <span className="font-mono-tabular text-[11px] text-slate-500">
                            Date: {hwDateStr} · Due: {hw.due_date}
                          </span>
                        </div>
                        <p className="text-[11px] text-teal-700 dark:text-teal-400">
                          {classMap.get(hw.class_id) || 'Class'} ({secName ? `Section ${secName}` : 'All Sections'}) · {subjectMap.get(hw.subject_id) || 'Subject'}
                        </p>
                        {hw.description && <p className="text-slate-600 dark:text-slate-400">{hw.description}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'marks' && (
          <form
            onSubmit={handleSaveMarks}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold">Enter Exam Marks</h2>
                <p className="text-[11px] text-slate-500">
                  Marks entered here update the School Exam Ledger and Student Report Cards.
                </p>
              </div>
              <button
                type="submit"
                disabled={marksBusy || !effectiveMarksExamId || !effectiveMarksSubjectId}
                className="rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {marksBusy ? 'Saving...' : 'Save Exam Marks'}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <label className="block font-medium">Exam</label>
                <select
                  value={effectiveMarksExamId}
                  onChange={(e) => setMarksExamId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                >
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.id}>{ex.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium">Subject</label>
                <select
                  value={effectiveMarksSubjectId}
                  onChange={(e) => setMarksSubjectId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                >
                  {subjects.map((sub) => (
                    <option key={sub.id} value={sub.id}>{sub.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium">Class</label>
                <select
                  value={marksClassId}
                  onChange={(e) => setMarksClassId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                >
                  <option value="All">All Classes</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium">Total Marks</label>
                <input
                  type="number"
                  min={1}
                  value={totalMarks}
                  onChange={(e) => setTotalMarks(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono-tabular"
                />
              </div>
              <div>
                <label className="block font-medium">Passing Marks</label>
                <input
                  type="number"
                  min={0}
                  value={passingMarks}
                  onChange={(e) => setPassingMarks(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono-tabular"
                />
              </div>
            </div>

            {marksStudents.length === 0 ? (
              <p className="text-slate-500">No students found in this filter.</p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {marksStudents.map((stu) => {
                  const existing = existingMarksMap.get(stu.id);
                  const val =
                    marksDraft[stu.id] !== undefined
                      ? marksDraft[stu.id]
                      : existing
                        ? String(existing.obtained_marks)
                        : '';
                  return (
                    <div key={stu.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{stu.name_en}</p>
                        <p className="text-[11px] text-slate-500">
                          {stu.admission_number} · {(stu.class_id && classMap.get(stu.class_id)) || '—'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={Number(totalMarks || 100)}
                          value={val}
                          onChange={(e) => setMarksDraft((prev) => ({ ...prev, [stu.id]: e.target.value }))}
                          placeholder={`0 - ${totalMarks}`}
                          className="w-28 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono-tabular"
                        />
                        {existing && (
                          <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold">
                            Grade: {existing.grade}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </form>
        )}

        {activeTab === 'leaves' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <form
              onSubmit={handleLeaveSubmit}
              className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs h-fit"
            >
              <h2 className="font-display text-sm font-bold">Apply for Staff Leave</h2>
              <div>
                <label className="block font-medium">Leave Type *</label>
                <select
                  value={leaveForm.leaveType}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                >
                  <option value="Casual">Casual Leave</option>
                  <option value="Medical">Medical Leave</option>
                  <option value="Earned">Earned Leave</option>
                  <option value="Urgent">Urgent Work</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium">From Date *</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.startDate}
                    onChange={(e) =>
                      setLeaveForm({
                        ...leaveForm,
                        startDate: e.target.value,
                        endDate: leaveForm.endDate < e.target.value ? e.target.value : leaveForm.endDate,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block font-medium">To Date *</label>
                  <input
                    type="date"
                    required
                    min={leaveForm.startDate}
                    value={leaveForm.endDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono-tabular"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium">Reason *</label>
                <textarea
                  required
                  minLength={3}
                  rows={3}
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  placeholder="Write reason for leave..."
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={leaveBusy}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {leaveBusy ? 'Sending...' : 'Submit Leave Request'}
              </button>
            </form>

            <div className="lg:col-span-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h2 className="font-display text-sm font-bold">My Leave Applications</h2>
              {leaveRequests.length === 0 ? (
                <p className="text-xs text-slate-500">No leave requests submitted yet.</p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {leaveRequests.map((lr) => {
                    const st = lr.status.toLowerCase();
                    const badgeCls =
                      st === 'approved'
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
                        : st === 'rejected'
                          ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900'
                          : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900';
                    return (
                      <div key={lr.id} className="py-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className="font-semibold">{lr.leaveType} Leave</span>
                            <span className="ml-2 font-mono-tabular text-[11px] text-slate-500">
                              {lr.startDate}
                              {lr.endDate !== lr.startDate ? ` → ${lr.endDate}` : ''} ({lr.totalDays} day(s))
                            </span>
                          </div>
                          <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold ${badgeCls}`}>
                            {st === 'approved' ? <CheckCircle2 className="h-3 w-3" /> : st === 'rejected' ? <XCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                            {lr.status}
                          </span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300">{lr.reason}</p>
                        {lr.reviewerNote && <p className="text-[11px] text-slate-500">Admin Note: {lr.reviewerNote}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'salary' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-teal-700 dark:text-teal-400" />
                <h2 className="font-display text-sm font-bold">My Salary Slips</h2>
              </div>
              {salarySlips.length === 0 ? (
                <p className="text-xs text-slate-500">No salary slips generated yet.</p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {salarySlips.map((slip) => (
                    <div key={slip.id} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-mono-tabular font-semibold">{slip.payroll_month}</p>
                        <p className="text-[11px] text-slate-500">
                          Net Salary: <strong className="font-mono-tabular text-slate-800 dark:text-slate-200">PKR {Number(slip.net_salary).toLocaleString()}</strong> · Absent: {slip.absent_days || 0} · {slip.status}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          generateSalarySlipPdf(
                            {
                              nameEn: school.name_en,
                              address: school.address,
                              city: school.city,
                              phone: school.phone,
                            },
                            {
                              employeeName: teacher.full_name,
                              employeeCode: teacher.employee_code,
                              designation: teacher.designation,
                              payroll_month: slip.payroll_month,
                              base_salary: Number(slip.base_salary),
                              allowances: Number(slip.allowances),
                              bonuses: Number(slip.bonuses),
                              deductions: Number(slip.deductions),
                              advance_salary: Number(slip.advance_salary),
                              absent_days: Number(slip.absent_days || 0),
                              attendance_deduction: Number(slip.attendance_deduction || 0),
                              net_salary: Number(slip.net_salary),
                              status: slip.status,
                              payment_method: slip.payment_method,
                            }
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-teal-700 hover:bg-teal-800 px-3 py-1.5 text-[11px] font-semibold text-white"
                      >
                        <Download className="h-3 w-3" />
                        Slip PDF
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <CalendarCheck2 className="h-4 w-4 text-teal-700 dark:text-teal-400" />
                <h2 className="font-display text-sm font-bold">My Staff Attendance History</h2>
              </div>
              {teacherAttendance.length === 0 ? (
                <p className="text-xs text-slate-500">No attendance records marked yet.</p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {teacherAttendance.map((a) => (
                    <div key={a.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="font-mono-tabular font-semibold">{a.attendance_date}</p>
                        <p className="text-[11px] text-slate-500">
                          {a.check_in_at ? `IN ${new Date(a.check_in_at).toLocaleTimeString()}` : ''}
                          {a.check_out_at ? ` · OUT ${new Date(a.check_out_at).toLocaleTimeString()}` : ''}
                        </p>
                      </div>
                      <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold">
                        {a.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'notifications' && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h2 className="font-display text-sm font-bold">School Alerts & Notices</h2>
            {notifications.length === 0 ? (
              <p className="text-xs text-slate-500">No alerts or announcements yet.</p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {notifications.map((n) => (
                  <div key={n.id} className="flex items-start justify-between gap-3 py-3">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{n.title}</p>
                      <p className="mt-0.5 text-slate-600 dark:text-slate-300">{n.body}</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {n.category} · {new Date(n.created_at).toLocaleString()}
                      </p>
                    </div>
                    {!n.is_read && (
                      <button
                        type="button"
                        onClick={() => void markNotifRead(n.id)}
                        className="shrink-0 rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium"
                      >
                        Mark Read
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'complaints' && (
          <PortalComplaintsTab
            roleLabel="Teacher"
            endpoint="/api/teacher-portal"
            complaints={complaints}
            onRefresh={loadPortal}
            onFeedback={setFeedback}
          />
        )}

        {activeTab === 'leaving' && (
          <div className="max-w-xl rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 p-6 space-y-4 text-xs">
            <div className="flex items-center gap-2.5 text-red-700 dark:text-red-400">
              <XCircle className="h-5 w-5" />
              <h2 className="font-display text-sm font-bold">Teacher School Leaving / Resignation Request</h2>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Submitting a school leaving request will notify the School Administration, update your employment status to left school / resigned, and deactivate your app portal access.
            </p>
            <form onSubmit={handleRequestLeaving} className="space-y-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300">Reason for Leaving / Resigning *</label>
                <textarea
                  required
                  rows={4}
                  value={leavingReason}
                  onChange={(e) => setLeavingReason(e.target.value)}
                  placeholder="Please state your reason for leaving school..."
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={leavingBusy || !leavingReason.trim()}
                className="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2.5 font-semibold text-white w-full"
              >
                {leavingBusy ? 'Submitting...' : 'Submit School Leaving & Resign'}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
