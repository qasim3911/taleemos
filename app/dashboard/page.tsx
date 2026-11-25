'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface DashboardMetrics {
  totalStudents: number;
  activeStudents: number;
  totalTeachers: number;
  totalStaff: number;
  presentToday: number;
  absentToday: number;
  teacherAttendancePct: number;
  monthlyFeeCollection: number;
  pendingFees: number;
  totalAdmissions: number;
  upcomingExams: number;
  onlineClasses: number;
  teacherAppAccounts: number;
  studentAppAccounts: number;
}

const CHART_COLORS = ['#0f766e', '#0284c7', '#d97706', '#4f46e5', '#16a34a', '#dc2626'];

export default function SchoolDashboardPage() {
  const { school, entitlements } = useSchool();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalStudents: 0,
    activeStudents: 0,
    totalTeachers: 0,
    totalStaff: 0,
    presentToday: 0,
    absentToday: 0,
    teacherAttendancePct: 0,
    monthlyFeeCollection: 0,
    pendingFees: 0,
    totalAdmissions: 0,
    upcomingExams: 0,
    onlineClasses: 0,
    teacherAppAccounts: 0,
    studentAppAccounts: 0,
  });

  const [feeChart, setFeeChart] = useState<Array<{ month: string; collected: number }>>([]);
  const [attendanceChart, setAttendanceChart] = useState<Array<{ status: string; count: number }>>([]);
  const [enrollmentChart, setEnrollmentChart] = useState<Array<{ month: string; students: number }>>([]);
  const [classDistChart, setClassDistChart] = useState<Array<{ name: string; value: number }>>([]);
  const [examPerfChart, setExamPerfChart] = useState<Array<{ exam: string; averagePct: number }>>([]);
  const [admissionsChart, setAdmissionsChart] = useState<Array<{ month: string; admissions: number }>>([]);
  const [recentActivities, setRecentActivities] = useState<Array<{ id: string; action: string; table_name: string; created_at: string }>>([]);
  const [recentNotifications, setRecentNotifications] = useState<Array<{ id: string; title: string; body: string; created_at: string }>>([]);

  const loadDashboard = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const today = new Date().toISOString().slice(0, 10);
    const monthPrefix = today.slice(0, 7);

    const [
      { data: students },
      { data: teachers },
      { data: classes },
      { data: studentAttToday },
      { data: teacherAttToday },
      { data: vouchers },
      { data: payments },
      { data: exams },
      { data: examMarks },
      { data: onlineClasses },
      { data: auditLogs },
      { data: notifications },
    ] = await Promise.all([
      supabase.from('students').select('id, status, class_id, admission_date, app_access_enabled').eq('school_id', school.id),
      supabase.from('teachers').select('id, designation, status, app_access_enabled').eq('school_id', school.id),
      supabase.from('classes').select('id, name').eq('school_id', school.id),
      supabase.from('student_attendance').select('status').eq('school_id', school.id).eq('attendance_date', today),
      supabase.from('teacher_attendance').select('status').eq('school_id', school.id).eq('attendance_date', today),
      supabase.from('fee_vouchers').select('total_amount_pkr, paid_amount_pkr, status').eq('school_id', school.id),
      supabase.from('fee_payments').select('amount_paid, paid_at').eq('school_id', school.id),
      supabase.from('exams').select('id, title, start_date').eq('school_id', school.id),
      supabase.from('exam_marks').select('exam_id, total_marks, obtained_marks').eq('school_id', school.id),
      supabase.from('online_classes').select('id, status').eq('school_id', school.id),
      supabase.from('audit_logs').select('id, action, table_name, created_at').eq('school_id', school.id).order('created_at', { ascending: false }).limit(8),
      supabase.from('notifications').select('id, title, body, created_at').eq('school_id', school.id).order('created_at', { ascending: false }).limit(6),
    ]);

    const sList = students ?? [];
    const tList = teachers ?? [];
    const sAtt = studentAttToday ?? [];
    const tAtt = teacherAttToday ?? [];
    const vList = vouchers ?? [];
    const pList = payments ?? [];
    const eList = exams ?? [];
    const mList = examMarks ?? [];

    const activeStudents = sList.filter((s: { status: string }) => s.status?.toLowerCase() === 'active').length;
    const teachingStaff = tList.filter((t: { designation: string; status: string }) => {
      const st = t.status?.toLowerCase();
      return st !== 'archived' && st !== 'resigned' && st !== 'inactive' && t.designation?.toLowerCase().includes('teach');
    }).length;
    const totalStaff = tList.filter((t: { status: string }) => {
      const st = t.status?.toLowerCase();
      return st !== 'archived' && st !== 'resigned' && st !== 'inactive';
    }).length;
    const presentToday = sAtt.filter((a: { status: string }) => a.status === 'Present' || a.status === 'Late').length;
    const absentToday = sAtt.filter((a: { status: string }) => a.status === 'Absent').length;
    const teacherPresent = tAtt.filter((a: { status: string }) => a.status === 'Present' || a.status === 'Late').length;
    const teacherAttendancePct = totalStaff > 0 ? Math.round((teacherPresent / totalStaff) * 100) : 0;

    const monthlyFeeCollection = pList
      .filter((p: { paid_at: string }) => p.paid_at?.startsWith(monthPrefix))
      .reduce((acc: number, p: { amount_paid: number }) => acc + Number(p.amount_paid || 0), 0);

    const pendingFees = vList
      .filter((v: { status: string }) => {
        const st = v.status?.toLowerCase();
        return st !== 'paid' && st !== 'cancelled';
      })
      .reduce((acc: number, v: { total_amount_pkr: number; paid_amount_pkr: number }) => acc + Math.max(0, Number(v.total_amount_pkr || 0) - Number(v.paid_amount_pkr || 0)), 0);

    const upcomingExams = eList.filter((e: { start_date: string | null }) => !e.start_date || e.start_date >= today).length;
    const activeOnlineClasses = (onlineClasses ?? []).filter((c: { status: string }) => c.status?.toLowerCase() !== 'cancelled').length;
    const teacherAppAccounts = tList.filter((t: { app_access_enabled: boolean }) => t.app_access_enabled).length;
    const studentAppAccounts = sList.filter((s: { app_access_enabled: boolean }) => s.app_access_enabled).length;

    setMetrics({
      totalStudents: sList.length,
      activeStudents,
      totalTeachers: teachingStaff,
      totalStaff,
      presentToday,
      absentToday,
      teacherAttendancePct,
      monthlyFeeCollection,
      pendingFees,
      totalAdmissions: sList.filter((s: { admission_date: string }) => s.admission_date?.startsWith(today.slice(0, 4))).length,
      upcomingExams,
      onlineClasses: activeOnlineClasses,
      teacherAppAccounts,
      studentAppAccounts,
    });

    // Monthly Fee Collection chart
    const feeByMonth = new Map<string, number>();
    for (const p of pList as Array<{ amount_paid: number; paid_at: string }>) {
      const m = (p.paid_at || '').slice(0, 7) || 'Unknown';
      feeByMonth.set(m, (feeByMonth.get(m) ?? 0) + Number(p.amount_paid || 0));
    }
    setFeeChart(Array.from(feeByMonth.entries()).sort().slice(-6).map(([month, collected]) => ({ month, collected })));

    // Attendance Overview
    const attCounts = { Present: 0, Absent: 0, Late: 0, Leave: 0 };
    for (const a of sAtt as Array<{ status: keyof typeof attCounts }>) {
      if (a.status in attCounts) attCounts[a.status] += 1;
    }
    setAttendanceChart(Object.entries(attCounts).map(([status, count]) => ({ status, count })));

    // Admissions & Enrollment by Month
    const admByMonth = new Map<string, number>();
    for (const s of sList as Array<{ admission_date: string }>) {
      const m = (s.admission_date || '').slice(0, 7) || 'Unknown';
      admByMonth.set(m, (admByMonth.get(m) ?? 0) + 1);
    }
    const sortedMonths = Array.from(admByMonth.entries()).sort().slice(-6);
    let running = 0;
    setAdmissionsChart(sortedMonths.map(([month, admissions]) => ({ month, admissions })));
    setEnrollmentChart(
      sortedMonths.map(([month, count]) => {
        running += count;
        return { month, students: running };
      })
    );

    // Class-wise Distribution
    const classNameMap = new Map<string, string>(
      ((classes ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name])
    );
    const classCounts = new Map<string, number>();
    for (const s of sList as Array<{ class_id: string | null }>) {
      const name = (s.class_id && classNameMap.get(s.class_id)) || 'Unassigned';
      classCounts.set(name, (classCounts.get(name) ?? 0) + 1);
    }
    setClassDistChart(Array.from(classCounts.entries()).map(([name, value]) => ({ name, value })));

    // Exam Performance
    const examNameMap = new Map<string, string>(
      (eList as Array<{ id: string; title: string }>).map((e) => [e.id, e.title])
    );
    const examAgg = new Map<string, { max: number; obt: number }>();
    for (const m of mList as Array<{ exam_id: string; total_marks: number; obtained_marks: number }>) {
      const curr = examAgg.get(m.exam_id) ?? { max: 0, obt: 0 };
      curr.max += Number(m.total_marks || 0);
      curr.obt += Number(m.obtained_marks || 0);
      examAgg.set(m.exam_id, curr);
    }
    setExamPerfChart(
      Array.from(examAgg.entries()).map(([id, agg]) => ({
        exam: examNameMap.get(id) || 'Exam',
        averagePct: agg.max > 0 ? Math.round((agg.obt / agg.max) * 100) : 0,
      }))
    );

    setRecentActivities(auditLogs ?? []);
    setRecentNotifications(notifications ?? []);
    setLoading(false);
  }, [school.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadDashboard();
      void fetch('/api/fees/auto-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((res) => {
          if (res && Number(res.createdCount) > 0) {
            void loadDashboard();
          }
        })
        .catch(() => {});
    });
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`dashboard-sync-${school.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'student_attendance', filter: `school_id=eq.${school.id}` },
        () => loadDashboard()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'students', filter: `school_id=eq.${school.id}` },
        () => loadDashboard()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fee_payments', filter: `school_id=eq.${school.id}` },
        () => loadDashboard()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadDashboard, school.id]);

  const statCards = [
    { label: 'Total Students', value: metrics.totalStudents.toLocaleString() },
    { label: 'Active Students', value: metrics.activeStudents.toLocaleString() },
    { label: 'Total Teachers', value: metrics.totalTeachers.toLocaleString() },
    { label: 'Total Staff', value: metrics.totalStaff.toLocaleString() },
    { label: 'Present Students Today', value: metrics.presentToday.toLocaleString() },
    { label: 'Absent Students Today', value: metrics.absentToday.toLocaleString() },
    { label: 'Teacher Attendance', value: `${metrics.teacherAttendancePct}%` },
    { label: 'Monthly Fee Collection', value: `PKR ${metrics.monthlyFeeCollection.toLocaleString()}` },
    { label: 'Pending Fees', value: `PKR ${metrics.pendingFees.toLocaleString()}` },
    { label: 'Total Admissions', value: metrics.totalAdmissions.toLocaleString() },
    { label: 'Upcoming Exams', value: metrics.upcomingExams.toLocaleString() },
    { label: 'Online Classes', value: metrics.onlineClasses.toLocaleString() },
    { label: 'Teacher App Accounts', value: metrics.teacherAppAccounts.toLocaleString() },
    { label: 'Student App Accounts', value: metrics.studentAppAccounts.toLocaleString() },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            School Operations Dashboard
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {school.name_en} · {school.board_type} · Plan: {entitlements.planName} ({entitlements.subscriptionStatus})
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
          >
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
              {card.label}
            </p>
            <p className="mt-1.5 font-mono-tabular text-lg font-bold text-slate-900 dark:text-white">
              {loading ? '—' : card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartPanel title="Monthly Fee Collection (PKR)" empty={feeChart.length === 0}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={feeChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.15} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Bar dataKey="collected" fill="#0f766e" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Today Attendance Overview" empty={attendanceChart.every((a) => a.count === 0)}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={attendanceChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.15} />
              <XAxis dataKey="status" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Bar dataKey="count" fill="#0284c7" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Student Enrollment Growth" empty={enrollmentChart.length === 0}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={enrollmentChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.15} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Line type="monotone" dataKey="students" stroke="#0f766e" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Class-wise Student Distribution" empty={classDistChart.length === 0}>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={classDistChart} dataKey="value" nameKey="name" outerRadius={84} label>
                {classDistChart.map((_, idx) => (
                  <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Examination Performance (%)" empty={examPerfChart.length === 0}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={examPerfChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.15} />
              <XAxis dataKey="exam" fontSize={11} />
              <YAxis domain={[0, 100]} fontSize={11} />
              <Tooltip />
              <Bar dataKey="averagePct" fill="#4f46e5" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Monthly Admissions" empty={admissionsChart.length === 0}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={admissionsChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.15} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Bar dataKey="admissions" fill="#16a34a" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="font-display text-base font-bold">Recent School Activities</h2>
          {recentActivities.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              No audit activities recorded yet. Actions across admissions, fees, and app access appear here.
            </p>
          ) : (
            <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
              {recentActivities.map((act) => (
                <div key={act.id} className="flex items-center justify-between py-2.5 text-xs">
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">{act.action}</p>
                    <p className="text-slate-500 dark:text-slate-400">{act.table_name}</p>
                  </div>
                  <span className="font-mono-tabular text-slate-400">
                    {new Date(act.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="font-display text-base font-bold">Recent Notifications</h2>
          {recentNotifications.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              No school notifications yet. Attendance alerts, fee reminders, and system alerts appear here in real time.
            </p>
          ) : (
            <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
              {recentNotifications.map((n) => (
                <div key={n.id} className="py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">{n.title}</p>
                    <span className="font-mono-tabular text-slate-400">
                      {new Date(n.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-0.5 text-slate-500 dark:text-slate-400">{n.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChartPanel({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
      {empty ? (
        <div className="flex h-[240px] items-center justify-center text-xs text-slate-400">
          No live records available for this metric yet.
        </div>
      ) : (
        <div className="mt-4">{children}</div>
      )}
    </div>
  );
}
