'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  generateFeeReceiptPdf,
  generateFeeVoucherPdf,
  generateReportCardPdf,
} from '@/lib/pdf/generators';
import {
  ALL_WEEK_DAYS,
  DEFAULT_WORKING_DAYS,
  getDateHolidayInfo,
  type SchoolHolidayEvent,
} from '@/lib/attendance/holidays';
import { useTheme } from '@/components/providers/theme-provider';
import { PortalComplaintsTab } from '@/components/complaints/portal-complaints-tab';
import type { ComplaintItem } from '@/lib/complaints/complaint-service';
import {
  AlertTriangle,
  Award,
  Bell,
  CalendarCheck2,
  CalendarOff,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileText,
  LogOut,
  MessageSquareWarning,
  Moon,
  Receipt,
  Send,
  Sun,
  XCircle,
} from 'lucide-react';

interface StudentInfo {
  id: string;
  school_id: string;
  admission_number: string;
  roll_number: string | null;
  name_en: string;
  father_name: string | null;
  className: string;
  sectionName: string;
  student_email: string | null;
  photo_url: string | null;
  student_id?: string | null;
  qr_token: string | null;
}

interface SchoolInfo {
  id: string;
  name_en: string;
  address: string;
  city: string;
  phone: string;
  logo_url: string | null;
}

interface VoucherItem {
  id: string;
  voucher_number: string;
  billing_month: string;
  issue_date: string;
  due_date: string;
  tuition_amount_pkr: number;
  other_charges_pkr: number;
  discount_pkr: number;
  fine_pkr: number;
  total_amount_pkr: number;
  paid_amount_pkr: number;
  status: string;
  line_items?: Array<{ label: string; amount: number }>;
}

interface PaymentItem {
  id: string;
  voucher_id: string;
  receipt_no: string;
  amount_paid: number;
  payment_method: string;
  transaction_ref: string | null;
  paid_at: string;
}

interface AttendanceItem {
  id: string;
  attendance_date: string;
  status: string;
  source: string;
  check_in_at: string | null;
  check_out_at: string | null;
}

interface ExamItem {
  id: string;
  title: string;
  exam_type: string;
  start_date: string;
}

interface MarkItem {
  id: string;
  exam_id: string;
  subject_id: string;
  total_marks: number;
  obtained_marks: number;
  grade: string;
  remarks: string | null;
}

interface NotificationItem {
  id: string;
  category: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

interface StudentLeaveItem {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: string;
  reviewerNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

function StatusBadge({ status }: { status: string }) {
  const normalized = (status || 'unpaid').toLowerCase();
  const classes =
    normalized === 'paid'
      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
      : normalized === 'partial'
        ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900'
        : normalized === 'overdue'
          ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900'
          : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900';

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize ${classes}`}>
      {normalized}
    </span>
  );
}

export default function StudentPortalPage() {
  const { theme, toggleTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'fees' | 'attendance' | 'leaves' | 'complaints' | 'results' | 'notifications'>('fees');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unpaid' | 'partial' | 'paid' | 'overdue'>('all');

  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [school, setSchool] = useState<SchoolInfo | null>(null);
  const [vouchers, setVouchers] = useState<VoucherItem[]>([]);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [attendance, setAttendance] = useState<AttendanceItem[]>([]);
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [marks, setMarks] = useState<MarkItem[]>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<StudentLeaveItem[]>([]);
  const [complaints, setComplaints] = useState<ComplaintItem[]>([]);
  const [workingDays, setWorkingDays] = useState<string[]>([...DEFAULT_WORKING_DAYS]);
  const [holidays, setHolidays] = useState<SchoolHolidayEvent[]>([]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const [leaveForm, setLeaveForm] = useState({
    leaveType: 'Casual',
    startDate: todayStr,
    endDate: todayStr,
    reason: '',
  });
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveFeedback, setLeaveFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [complaintFeedback, setComplaintFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadPortal = useCallback(async () => {
    try {
      const res = await fetch('/api/student-portal', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.assign('/login?next=/student-portal&portal=student');
        return;
      }
      if (!res.ok) {
        setErrorMsg(data.error || 'Unable to load Student Portal.');
        setLoading(false);
        return;
      }
      setStudent(data.student);
      setSchool(data.school);
      setVouchers(data.vouchers ?? []);
      setPayments(data.payments ?? []);
      setAttendance(data.attendance ?? []);
      setExams(data.exams ?? []);
      setMarks(data.marks ?? []);
      setSubjects(data.subjects ?? []);
      setNotifications(data.notifications ?? []);
      setLeaveRequests(data.leaveRequests ?? []);
      setComplaints(data.complaints ?? []);
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

  useEffect(() => {
    if (!student?.school_id) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`student-portal-${student.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fee_vouchers', filter: `school_id=eq.${student.school_id}` },
        () => void loadPortal()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fee_payments', filter: `school_id=eq.${student.school_id}` },
        () => void loadPortal()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `school_id=eq.${student.school_id}` },
        () => void loadPortal()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'student_attendance', filter: `school_id=eq.${student.school_id}` },
        () => void loadPortal()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'complaints', filter: `school_id=eq.${student.school_id}` },
        () => void loadPortal()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'complaint_replies', filter: `school_id=eq.${student.school_id}` },
        () => void loadPortal()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [student?.id, student?.school_id, loadPortal]);

  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => null);
    window.location.assign('/login');
  };

  const markNotifRead = async (id: string) => {
    await fetch('/api/student-portal', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationId: id }),
    });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLeaveSubmitting(true);
    setLeaveFeedback(null);
    try {
      const res = await fetch('/api/student-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leaveForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLeaveFeedback({ type: 'error', text: data.error || 'Unable to submit leave request.' });
        return;
      }
      setLeaveFeedback({
        type: 'success',
        text: 'Leave request sent to School Admin. You will see approval status updates right here.',
      });
      setLeaveForm({
        leaveType: 'Casual',
        startDate: todayStr,
        endDate: todayStr,
        reason: '',
      });
      await loadPortal();
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const feeStats = useMemo(() => {
    let totalBilled = 0;
    let totalPaid = 0;
    let totalDue = 0;
    let unpaidCount = 0;
    let overdueCount = 0;
    let paidCount = 0;

    for (const v of vouchers) {
      const total = Number(v.total_amount_pkr || 0);
      const paid = Number(v.paid_amount_pkr || 0);
      const st = (v.status || 'unpaid').toLowerCase();
      totalBilled += total;
      totalPaid += paid;
      totalDue += Math.max(0, total - paid);
      if (st === 'paid') paidCount++;
      else {
        unpaidCount++;
        if (st === 'overdue') overdueCount++;
      }
    }
    return { totalBilled, totalPaid, totalDue, unpaidCount, overdueCount, paidCount };
  }, [vouchers]);

  const filteredVouchers = useMemo(() => {
    if (statusFilter === 'all') return vouchers;
    return vouchers.filter((v) => (v.status || 'unpaid').toLowerCase() === statusFilter);
  }, [vouchers, statusFilter]);

  const voucherNumberMap = useMemo(
    () => new Map(vouchers.map((v) => [v.id, v.voucher_number])),
    [vouchers]
  );

  const subjectMap = useMemo(
    () => new Map(subjects.map((s) => [s.id, s.name])),
    [subjects]
  );

  const unreadNotifs = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const todayHoliday = useMemo(
    () => getDateHolidayInfo(todayStr, workingDays, holidays),
    [todayStr, workingDays, holidays]
  );

  const weeklyOffDays = useMemo(
    () => ALL_WEEK_DAYS.filter((d) => !workingDays.includes(d)),
    [workingDays]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-sm text-slate-500">
        Loading Student Portal & Fee Challans...
      </div>
    );
  }

  if (errorMsg || !student || !school) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center space-y-4">
          <AlertTriangle className="h-10 w-10 text-amber-600 mx-auto" />
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            Student Portal Unavailable
          </h1>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            {errorMsg || 'No active student account is linked to this sign-in email.'}
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Link
              href="/dashboard"
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              School Admin Dashboard
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
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-700 text-xs font-bold text-white">
                {school.name_en.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-teal-700 dark:text-teal-400">
                {school.name_en} · Student Portal
              </p>
              <h1 className="truncate font-display text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                {student.name_en}{' '}
                <span className="font-mono-tabular text-xs font-normal text-slate-500">
                  ({student.admission_number} · {student.className}
                  {student.sectionName ? ` - ${student.sectionName}` : ''})
                </span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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
          {student.photo_url ? (
            <img
              src={student.photo_url}
              alt={student.name_en}
              referrerPolicy="no-referrer"
              className="h-16 w-16 sm:h-20 sm:w-20 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
            />
          ) : (
            <div className="flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-900 text-lg font-bold text-teal-700 dark:text-teal-300">
              {student.name_en
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
                {student.name_en}
              </h2>
              <span className="rounded bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-900 px-2 py-0.5 text-[10px] font-semibold text-teal-700 dark:text-teal-300">
                Active Student Profile
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {student.father_name ? `S/O · D/O ${student.father_name} · ` : ''}
              Adm No: <span className="font-mono-tabular font-semibold">{student.admission_number}</span>
              {student.student_id ? ` · Student ID: ${student.student_id}` : ''}
              {student.roll_number ? ` · Roll No: ${student.roll_number}` : ''}
            </p>
            <p className="text-xs text-slate-500">
              Class: <span className="font-semibold text-slate-700 dark:text-slate-300">{student.className}</span>
              {student.sectionName ? ` (${student.sectionName})` : ''}
              {student.student_email ? ` · ${student.student_email}` : ''}
            </p>
          </div>
        </div>

        {todayHoliday.isHoliday && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2.5">
            <CalendarOff className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <span>
              <strong>Today is a School Holiday ({todayHoliday.title})</strong> — School is closed today and no attendance is required.
            </span>
          </div>
        )}

        {feeStats.totalDue > 0 && (
          <div
            className={`rounded-xl border px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2 ${
              feeStats.overdueCount > 0
                ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200'
                : 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                You have <strong>{feeStats.unpaidCount}</strong> pending fee challan(s) totaling{' '}
                <strong className="font-mono-tabular">PKR {feeStats.totalDue.toLocaleString()}</strong>
                {feeStats.overdueCount > 0 ? ` (${feeStats.overdueCount} overdue)` : ''}. Download your challan PDF below to pay via Cash Counter, Bank, JazzCash, or Easypaisa.
              </span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-[11px] font-medium text-slate-500">Total Billed</p>
            <p className="mt-1 font-mono-tabular text-lg font-bold text-slate-900 dark:text-white">
              PKR {feeStats.totalBilled.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Paid Fees</p>
            <p className="mt-1 font-mono-tabular text-lg font-bold text-emerald-700 dark:text-emerald-300">
              PKR {feeStats.totalPaid.toLocaleString()}
            </p>
            <p className="text-[10px] text-slate-400">{feeStats.paidCount} paid voucher(s)</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Unpaid / Balance Due</p>
            <p className="mt-1 font-mono-tabular text-lg font-bold text-amber-700 dark:text-amber-300">
              PKR {feeStats.totalDue.toLocaleString()}
            </p>
            <p className="text-[10px] text-slate-400">{feeStats.unpaidCount} pending voucher(s)</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-[11px] font-medium text-slate-500">Attendance Records</p>
            <p className="mt-1 font-mono-tabular text-lg font-bold text-slate-900 dark:text-white">
              {attendance.filter((a) => a.status === 'Present' || a.status === 'Late').length} / {attendance.length}
            </p>
            <p className="text-[10px] text-slate-400">Present days recorded</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          {[
            { id: 'fees', label: `Fee Vouchers (${vouchers.length})`, icon: CreditCard },
            { id: 'attendance', label: `Attendance (${attendance.length})`, icon: CalendarCheck2 },
            { id: 'leaves', label: `Leave Requests (${leaveRequests.length})`, icon: CalendarOff },
            { id: 'complaints', label: `Complaints (${complaints.length})`, icon: MessageSquareWarning },
            { id: 'results', label: `Exam Results (${exams.length})`, icon: Award },
            { id: 'notifications', label: `Alerts (${unreadNotifs} unread)`, icon: Bell },
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

        {activeTab === 'fees' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {(['all', 'unpaid', 'partial', 'paid', 'overdue'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${
                      statusFilter === st
                        ? 'bg-slate-900 dark:bg-teal-700 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">
                Monthly vouchers auto-appear here on generation and update live when paid.
              </p>
            </div>

            {filteredVouchers.length === 0 ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">
                No fee vouchers found for the selected filter.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {filteredVouchers.map((v) => {
                  const balance = Math.max(0, Number(v.total_amount_pkr) - Number(v.paid_amount_pkr));
                  return (
                    <div
                      key={v.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-mono-tabular text-xs font-bold text-slate-900 dark:text-white">
                            {v.voucher_number}
                          </p>
                          <p className="text-xs text-slate-500">
                            Billing Month: <strong className="font-mono-tabular">{v.billing_month}</strong> · Due:{' '}
                            <span className="font-mono-tabular">{v.due_date}</span>
                          </p>
                        </div>
                        <StatusBadge status={v.status} />
                      </div>

                      <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3 space-y-1 text-xs">
                        {Array.isArray(v.line_items) && v.line_items.length > 0 ? (
                          v.line_items.map((item, idx) => (
                            <div key={idx} className="flex justify-between text-slate-600 dark:text-slate-300">
                              <span>{item.label}</span>
                              <span className="font-mono-tabular">PKR {Number(item.amount).toLocaleString()}</span>
                            </div>
                          ))
                        ) : (
                          <div className="flex justify-between text-slate-600 dark:text-slate-300">
                            <span>Monthly Tuition Fee</span>
                            <span className="font-mono-tabular">PKR {Number(v.tuition_amount_pkr).toLocaleString()}</span>
                          </div>
                        )}
                        {Number(v.discount_pkr) > 0 && (
                          <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                            <span>Discount</span>
                            <span className="font-mono-tabular">- PKR {Number(v.discount_pkr).toLocaleString()}</span>
                          </div>
                        )}
                        {Number(v.fine_pkr) > 0 && (
                          <div className="flex justify-between text-red-600 dark:text-red-400">
                            <span>Late Fine</span>
                            <span className="font-mono-tabular">+ PKR {Number(v.fine_pkr).toLocaleString()}</span>
                          </div>
                        )}
                        <div className="border-t border-slate-200 dark:border-slate-800 pt-1.5 mt-1.5 flex justify-between font-bold text-slate-900 dark:text-white">
                          <span>Net Payable</span>
                          <span className="font-mono-tabular">PKR {Number(v.total_amount_pkr).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-500">
                          <span>Paid: PKR {Number(v.paid_amount_pkr).toLocaleString()}</span>
                          <span className={balance > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
                            Balance Due: PKR {balance.toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            generateFeeVoucherPdf(
                              {
                                nameEn: school.name_en,
                                address: school.address,
                                city: school.city,
                                phone: school.phone,
                              },
                              {
                                voucher_no: v.voucher_number,
                                studentName: student.name_en,
                                admissionNo: student.admission_number,
                                className: student.className,
                                billing_month: v.billing_month,
                                due_date: v.due_date,
                                gross_amount: v.tuition_amount_pkr,
                                discount_amount: v.discount_pkr,
                                fine_amount: v.fine_pkr,
                                net_amount: v.total_amount_pkr,
                                paid_amount: v.paid_amount_pkr,
                                status: v.status,
                              }
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download Challan PDF
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-teal-700 dark:text-teal-400" />
                <h2 className="font-display text-sm font-bold">Verified Fee Payment Receipts</h2>
              </div>
              {payments.length === 0 ? (
                <p className="text-xs text-slate-500">No fee payments recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 pr-3">Receipt No</th>
                        <th className="py-2 pr-3">Voucher</th>
                        <th className="py-2 pr-3">Method</th>
                        <th className="py-2 pr-3">Amount</th>
                        <th className="py-2 pr-3">Paid On</th>
                        <th className="py-2 text-right">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2.5 pr-3 font-mono-tabular font-semibold">{p.receipt_no}</td>
                          <td className="py-2.5 pr-3 font-mono-tabular">{voucherNumberMap.get(p.voucher_id) || '—'}</td>
                          <td className="py-2.5 pr-3">{p.payment_method}</td>
                          <td className="py-2.5 pr-3 font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400">
                            PKR {Number(p.amount_paid).toLocaleString()}
                          </td>
                          <td className="py-2.5 pr-3 text-slate-500">
                            {new Date(p.paid_at).toLocaleDateString()}
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                generateFeeReceiptPdf(
                                  {
                                    nameEn: school.name_en,
                                    address: school.address,
                                    city: school.city,
                                    phone: school.phone,
                                  },
                                  {
                                    receipt_no: p.receipt_no,
                                    studentName: student.name_en,
                                    admissionNo: student.admission_number,
                                    voucherNo: voucherNumberMap.get(p.voucher_id) || '—',
                                    amount_paid: p.amount_paid,
                                    payment_method: p.payment_method,
                                    transaction_ref: p.transaction_ref,
                                    paid_at: p.paid_at,
                                  }
                                )
                              }
                              className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold"
                            >
                              <FileText className="h-3 w-3" />
                              Receipt PDF
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'attendance' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-sm font-bold">School Holidays & Weekly Off Days</h2>
                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  Weekly Off: {weeklyOffDays.length > 0 ? weeklyOffDays.join(', ') : 'None'}
                </span>
              </div>
              {holidays.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No special holidays declared yet. Attendance is closed on weekly off days ({weeklyOffDays.join(', ') || 'None'}).
                </p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {holidays.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{h.title}</p>
                        {h.description && <p className="text-[11px] text-slate-500">{h.description}</p>}
                      </div>
                      <span className="font-mono-tabular text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                        {String(h.start_date).slice(0, 10)}
                        {h.end_date && h.end_date !== h.start_date ? ` → ${String(h.end_date).slice(0, 10)}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="font-display text-sm font-bold mb-4">Attendance History</h2>
              {attendance.length === 0 ? (
                <p className="text-xs text-slate-500">No attendance records marked yet.</p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {attendance.map((a) => (
                    <div key={a.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="font-mono-tabular font-semibold">{a.attendance_date}</p>
                        <p className="text-[11px] text-slate-500">
                          Source: {a.source}
                          {a.check_in_at ? ` · IN ${new Date(a.check_in_at).toLocaleTimeString()}` : ''}
                          {a.check_out_at ? ` · OUT ${new Date(a.check_out_at).toLocaleTimeString()}` : ''}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ${
                          a.status === 'Present'
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                            : a.status === 'Late'
                              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                              : a.status === 'Leave'
                                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300'
                                : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {a.status === 'Present' ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                        {a.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'leaves' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <form
              onSubmit={handleLeaveSubmit}
              className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit"
            >
              <h2 className="font-display text-sm font-bold">Apply for Leave</h2>
              <p className="text-[11px] text-slate-500">
                Submit your leave application to the School Admin. Once approved, your attendance is automatically marked as Leave.
              </p>

              {leaveFeedback && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    leaveFeedback.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                      : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 text-red-800 dark:text-red-200'
                  }`}
                >
                  {leaveFeedback.text}
                </div>
              )}

              <div className="text-xs space-y-3">
                <div>
                  <label className="block font-medium">Leave Type *</label>
                  <select
                    value={leaveForm.leaveType}
                    onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  >
                    <option value="Casual">Casual Leave</option>
                    <option value="Sick">Sick Leave</option>
                    <option value="Urgent">Urgent Work</option>
                    <option value="Family Event">Family Event</option>
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
                  disabled={leaveSubmitting}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  {leaveSubmitting ? 'Sending Application...' : 'Submit Leave Application'}
                </button>
              </div>
            </form>

            <div className="lg:col-span-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h2 className="font-display text-sm font-bold">My Leave Applications</h2>
              {leaveRequests.length === 0 ? (
                <p className="text-xs text-slate-500">You have not submitted any leave applications yet.</p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {leaveRequests.map((lr) => {
                    const st = lr.status.toLowerCase();
                    const badgeClasses =
                      st === 'approved'
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
                        : st === 'rejected'
                          ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900'
                          : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900';

                    return (
                      <div key={lr.id} className="py-3 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-semibold text-slate-900 dark:text-white">{lr.leaveType} Leave</span>
                            <span className="ml-2 font-mono-tabular text-[11px] text-slate-500">
                              {lr.startDate}
                              {lr.endDate !== lr.startDate ? ` → ${lr.endDate}` : ''} ({lr.totalDays}{' '}
                              {lr.totalDays === 1 ? 'day' : 'days'})
                            </span>
                          </div>
                          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${badgeClasses}`}>
                            {st === 'approved' ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : st === 'rejected' ? (
                              <XCircle className="h-3 w-3" />
                            ) : (
                              <Clock className="h-3 w-3" />
                            )}
                            {lr.status}
                          </span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300">{lr.reason}</p>
                        {lr.reviewerNote && (
                          <p className="text-[11px] text-slate-500 italic">
                            School Admin Note: {lr.reviewerNote}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'results' && (
          <div className="space-y-4">
            {exams.length === 0 ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">
                No published exam results yet.
              </div>
            ) : (
              exams.map((exam) => {
                const examMarks = marks.filter((m) => m.exam_id === exam.id);
                return (
                  <div
                    key={exam.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-display text-sm font-bold">{exam.title}</h3>
                        <p className="text-xs text-slate-500">{exam.exam_type} · {exam.start_date}</p>
                      </div>
                      {examMarks.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            generateReportCardPdf(
                              {
                                nameEn: school.name_en,
                                address: school.address,
                                city: school.city,
                                phone: school.phone,
                              },
                              {
                                examName: exam.title,
                                studentName: student.name_en,
                                admissionNo: student.admission_number,
                                className: student.className,
                                subjects: examMarks.map((m) => ({
                                  subjectName: subjectMap.get(m.subject_id) || 'Subject',
                                  totalMarks: m.total_marks,
                                  obtainedMarks: m.obtained_marks,
                                  grade: m.grade,
                                  remarks: m.remarks,
                                })),
                              }
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Report Card PDF
                        </button>
                      )}
                    </div>
                    {examMarks.length === 0 ? (
                      <p className="text-xs text-slate-500">No marks recorded for your profile in this exam.</p>
                    ) : (
                      <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                        {examMarks.map((m) => (
                          <div key={m.id} className="flex items-center justify-between py-2">
                            <span>{subjectMap.get(m.subject_id) || 'Subject'}</span>
                            <span className="font-mono-tabular font-semibold">
                              {m.obtained_marks} / {m.total_marks} ({m.grade})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'notifications' && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="font-display text-sm font-bold mb-4">Fee & School Alerts</h2>
            {notifications.length === 0 ? (
              <p className="text-xs text-slate-500">No notifications yet.</p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {notifications.map((n) => (
                  <div key={n.id} className="flex items-start justify-between gap-3 py-3">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{n.title}</p>
                      <p className="mt-0.5 text-slate-600 dark:text-slate-400">{n.body}</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {n.category} · {new Date(n.created_at).toLocaleString()}
                      </p>
                    </div>
                    {!n.is_read && (
                      <button
                        type="button"
                        onClick={() => markNotifRead(n.id)}
                        className="shrink-0 rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold"
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
          <div className="space-y-4">
            {complaintFeedback && (
              <div
                className={`rounded-xl border px-4 py-3 text-xs ${
                  complaintFeedback.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                    : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 text-red-800 dark:text-red-200'
                }`}
              >
                {complaintFeedback.text}
              </div>
            )}
            <PortalComplaintsTab
              roleLabel="Student"
              endpoint="/api/student-portal"
              complaints={complaints}
              onRefresh={loadPortal}
              onFeedback={setComplaintFeedback}
            />
          </div>
        )}
      </main>
    </div>
  );
}
