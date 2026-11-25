'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import type { UnifiedLeaveRequest } from '@/lib/leaves/leave-service';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  GraduationCap,
  Plus,
  Users,
  XCircle,
} from 'lucide-react';

interface StudentOption {
  id: string;
  admission_number: string;
  name_en: string;
}

interface TeacherOption {
  id: string;
  employee_code: string;
  full_name: string;
  designation: string;
}

interface LeaveSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  studentPending: number;
  teacherPending: number;
}

function LeaveStatusBadge({ status }: { status: string }) {
  const s = (status || 'Pending').toLowerCase();
  const classes =
    s === 'approved'
      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
      : s === 'rejected'
        ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900'
        : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900';

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${classes}`}>
      {s === 'approved' ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : s === 'rejected' ? (
        <XCircle className="h-3 w-3" />
      ) : (
        <Clock className="h-3 w-3" />
      )}
      {status}
    </span>
  );
}

export default function LeaveRequestsPage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [leaves, setLeaves] = useState<UnifiedLeaveRequest[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [summary, setSummary] = useState<LeaveSummary>({
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    studentPending: 0,
    teacherPending: 0,
  });

  const [audienceFilter, setAudienceFilter] = useState<'all' | 'Student' | 'Teacher'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Pending' | 'Approved' | 'Rejected'>('all');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [reviewTarget, setReviewTarget] = useState<UnifiedLeaveRequest | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const [openCreate, setOpenCreate] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [createForm, setCreateForm] = useState({
    requesterType: 'Student' as 'Student' | 'Teacher',
    requesterId: '',
    leaveType: 'Casual',
    startDate: today,
    endDate: today,
    reason: '',
    initialStatus: 'Pending' as 'Pending' | 'Approved',
  });

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/leaves', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to load leave requests', description: data.error, variant: 'error' });
        return;
      }
      setLeaves(data.leaves ?? []);
      setStudents(data.students ?? []);
      setTeachers(data.teachers ?? []);
      if (data.summary) setSummary(data.summary);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`leave-requests-${school.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'staff_leave_records', filter: `school_id=eq.${school.id}` },
        () => void loadData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leave_requests', filter: `school_id=eq.${school.id}` },
        () => void loadData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `school_id=eq.${school.id}` },
        () => void loadData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'complaints', filter: `school_id=eq.${school.id}` },
        () => void loadData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_tickets', filter: `school_id=eq.${school.id}` },
        () => void loadData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData, school.id]);

  const handleReview = async (
    row: UnifiedLeaveRequest,
    decision: 'Approved' | 'Rejected',
    note?: string
  ) => {
    const key = `${row.source}:${row.id}`;
    setBusyKey(key);
    try {
      const res = await fetch('/api/leaves', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          source: row.source,
          decision,
          reviewerNote: note?.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Review failed', description: data.error, variant: 'error' });
        return;
      }

      toast({
        title: `Leave ${decision}`,
        description:
          decision === 'Approved'
            ? row.requesterType === 'Teacher'
              ? 'Teacher attendance marked Leave, salary slip synced, and notification sent.'
              : 'Student attendance marked Leave and student portal notified.'
            : 'Requester has been notified of the decision.',
        variant: 'success',
      });
      setReviewTarget(null);
      setReviewNote('');
      await loadData();
    } finally {
      setBusyKey(null);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.requesterId) {
      toast({ title: 'Select a student or teacher', variant: 'error' });
      return;
    }

    setBusyKey('create');
    try {
      const res = await fetch('/api/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to submit leave', description: data.error, variant: 'error' });
        return;
      }

      toast({
        title: createForm.initialStatus === 'Approved' ? 'Leave Recorded & Approved' : 'Leave Request Submitted',
        description:
          createForm.initialStatus === 'Approved'
            ? 'Attendance has been automatically marked as Leave.'
            : 'Added to Pending Review queue.',
        variant: 'success',
      });
      setOpenCreate(false);
      setCreateForm({
        requesterType: 'Student',
        requesterId: '',
        leaveType: 'Casual',
        startDate: today,
        endDate: today,
        reason: '',
        initialStatus: 'Pending',
      });
      await loadData();
    } finally {
      setBusyKey(null);
    }
  };

  const filteredLeaves = useMemo(() => {
    return leaves.filter((item) => {
      if (audienceFilter !== 'all' && item.requesterType !== audienceFilter) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      return true;
    });
  }, [leaves, audienceFilter, statusFilter]);

  const columns: TableColumn<UnifiedLeaveRequest>[] = [
    {
      key: 'requester',
      header: 'Requester',
      render: (r) => (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                r.requesterType === 'Teacher'
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                  : 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300'
              }`}
            >
              {r.requesterType === 'Teacher' ? (
                <Users className="h-2.5 w-2.5" />
              ) : (
                <GraduationCap className="h-2.5 w-2.5" />
              )}
              {r.requesterType}
            </span>
            <span className="font-semibold text-slate-900 dark:text-white">{r.requesterName}</span>
          </div>
          <p className="text-[11px] text-slate-500">
            <span className="font-mono-tabular">{r.requesterCode}</span> · {r.requesterSubtext}
          </p>
        </div>
      ),
      exportValue: (r) => `${r.requesterType} - ${r.requesterName} (${r.requesterCode})`,
    },
    {
      key: 'type',
      header: 'Leave Type',
      render: (r) => <span className="font-medium">{r.leaveType}</span>,
      exportValue: (r) => r.leaveType,
    },
    {
      key: 'dates',
      header: 'Dates & Duration',
      render: (r) => (
        <div>
          <p className="font-mono-tabular font-medium">
            {r.startDate}
            {r.endDate !== r.startDate ? ` → ${r.endDate}` : ''}
          </p>
          <p className="text-[11px] text-slate-500">
            {r.totalDays} {r.totalDays === 1 ? 'day' : 'days'}
          </p>
        </div>
      ),
      exportValue: (r) => `${r.startDate} to ${r.endDate} (${r.totalDays}d)`,
    },
    {
      key: 'reason',
      header: 'Reason & Notes',
      render: (r) => (
        <div className="max-w-xs space-y-0.5">
          <p className="text-slate-700 dark:text-slate-300 line-clamp-2">{r.reason}</p>
          {r.reviewerNote && (
            <p className="text-[11px] text-slate-500 italic">Admin note: {r.reviewerNote}</p>
          )}
        </div>
      ),
      exportValue: (r) => r.reason,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <LeaveStatusBadge status={r.status} />,
      exportValue: (r) => r.status,
    },
    {
      key: 'actions',
      header: 'Approve / Reject',
      align: 'right',
      render: (r) => {
        const isBusy = busyKey === `${r.source}:${r.id}`;
        return (
          <div className="flex flex-wrap justify-end gap-1.5">
            {r.status !== 'Approved' && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => handleReview(r, 'Approved')}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                <CheckCircle2 className="h-3 w-3" />
                Approve
              </button>
            )}
            {r.status !== 'Rejected' && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setReviewTarget(r);
                  setReviewNote(r.reviewerNote || '');
                }}
                className="inline-flex items-center gap-1 rounded-md border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950/70 px-2.5 py-1 text-[11px] font-semibold text-red-700 dark:text-red-300 disabled:opacity-50"
              >
                <XCircle className="h-3 w-3" />
                Reject
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const activeOptions = createForm.requesterType === 'Student' ? students : teachers;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Leave Requests & Approvals</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            All incoming Student & Teacher leave applications appear here. Approving automatically marks attendance as Leave and updates teacher payroll.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const firstStudent = students[0]?.id || '';
            setCreateForm({
              requesterType: 'Student',
              requesterId: firstStudent,
              leaveType: 'Casual',
              startDate: today,
              endDate: today,
              reason: '',
              initialStatus: 'Pending',
            });
            setOpenCreate(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-2 text-xs font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          New Leave Request
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 p-4">
          <div className="flex items-center justify-between text-amber-800 dark:text-amber-300">
            <span className="text-[11px] font-semibold">Pending Review</span>
            <CalendarClock className="h-4 w-4" />
          </div>
          <p className="mt-1 font-mono-tabular text-2xl font-bold text-amber-900 dark:text-amber-200">
            {summary.pending}
          </p>
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            {summary.studentPending} Student · {summary.teacherPending} Teacher
          </p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
            <span className="text-[11px] font-semibold">Approved</span>
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <p className="mt-1 font-mono-tabular text-2xl font-bold text-emerald-700 dark:text-emerald-300">
            {summary.approved}
          </p>
          <p className="text-[11px] text-slate-400">Synced with attendance</p>
        </div>

        <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-red-700 dark:text-red-400">
            <span className="text-[11px] font-semibold">Rejected</span>
            <XCircle className="h-4 w-4" />
          </div>
          <p className="mt-1 font-mono-tabular text-2xl font-bold text-red-700 dark:text-red-300">
            {summary.rejected}
          </p>
          <p className="text-[11px] text-slate-400">Declined applications</p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold">Total Requests</span>
            <Users className="h-4 w-4" />
          </div>
          <p className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-white">
            {summary.total}
          </p>
          <p className="text-[11px] text-slate-400">Students & Staff combined</p>
        </div>
      </div>

      <DataTable
        title="Leave Applications Queue"
        subtitle="Filter by Student or Teacher and review Pending, Approved, or Rejected requests."
        rows={filteredLeaves}
        columns={columns}
        loading={loading}
        getRowKey={(r) => `${r.source}-${r.id}`}
        getSearchText={(r) =>
          `${r.requesterName} ${r.requesterCode} ${r.requesterType} ${r.leaveType} ${r.reason} ${r.status}`
        }
        exportFileName="leave-requests"
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={audienceFilter}
              onChange={(e) => setAudienceFilter(e.target.value as typeof audienceFilter)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            >
              <option value="all">All (Students + Teachers)</option>
              <option value="Student">Students Only</option>
              <option value="Teacher">Teachers / Staff Only</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            >
              <option value="all">All Statuses</option>
              <option value="Pending">Pending Only</option>
              <option value="Approved">Approved Only</option>
              <option value="Rejected">Rejected Only</option>
            </select>
          </div>
        }
      />

      <ModalDialog
        open={Boolean(reviewTarget)}
        onClose={() => {
          setReviewTarget(null);
          setReviewNote('');
        }}
        title={`Reject Leave Request — ${reviewTarget?.requesterName || ''}`}
      >
        {reviewTarget && (
          <div className="space-y-4 text-xs">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 space-y-1">
              <p className="font-semibold text-slate-900 dark:text-white">
                {reviewTarget.requesterType}: {reviewTarget.requesterName} ({reviewTarget.requesterCode})
              </p>
              <p className="text-slate-500">
                {reviewTarget.leaveType} · {reviewTarget.startDate} to {reviewTarget.endDate} ({reviewTarget.totalDays}{' '}
                {reviewTarget.totalDays === 1 ? 'day' : 'days'})
              </p>
              <p className="text-slate-700 dark:text-slate-300 pt-1">{reviewTarget.reason}</p>
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">
                Reason / Note for {reviewTarget.requesterType} (Optional)
              </label>
              <textarea
                rows={3}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="e.g. Exam week active — please attend classes or provide medical certificate."
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setReviewTarget(null);
                  setReviewNote('');
                }}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyKey === `${reviewTarget.source}:${reviewTarget.id}`}
                onClick={() => handleReview(reviewTarget, 'Rejected', reviewNote)}
                className="rounded-lg bg-red-600 hover:bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        )}
      </ModalDialog>

      <ModalDialog
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        title="Submit Student or Teacher Leave Request"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Requester Type *</label>
              <select
                value={createForm.requesterType}
                onChange={(e) => {
                  const nextType = e.target.value as 'Student' | 'Teacher';
                  const nextDefaultId =
                    nextType === 'Student' ? students[0]?.id || '' : teachers[0]?.id || '';
                  setCreateForm({ ...createForm, requesterType: nextType, requesterId: nextDefaultId });
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="Student">Student</option>
                <option value="Teacher">Teacher / Staff</option>
              </select>
            </div>
            <div>
              <label className="block font-medium">Leave Type *</label>
              <select
                value={createForm.leaveType}
                onChange={(e) => setCreateForm({ ...createForm, leaveType: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="Casual">Casual Leave</option>
                <option value="Sick">Sick / Medical Leave</option>
                <option value="Urgent">Urgent Work</option>
                <option value="Family Event">Family Event</option>
                <option value="Unpaid">Unpaid Leave</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium">
              Select {createForm.requesterType} *
            </label>
            <select
              required
              value={createForm.requesterId}
              onChange={(e) => setCreateForm({ ...createForm, requesterId: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="">Select {createForm.requesterType}...</option>
              {activeOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {'name_en' in opt
                    ? `${opt.name_en} (${opt.admission_number})`
                    : `${opt.full_name} (${opt.employee_code} · ${opt.designation})`}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Start Date *</label>
              <input
                type="date"
                required
                value={createForm.startDate}
                onChange={(e) => setCreateForm({ ...createForm, startDate: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium">End Date *</label>
              <input
                type="date"
                required
                min={createForm.startDate}
                value={createForm.endDate}
                onChange={(e) => setCreateForm({ ...createForm, endDate: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium">Initial Status</label>
            <select
              value={createForm.initialStatus}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  initialStatus: e.target.value as 'Pending' | 'Approved',
                })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="Pending">Pending Review (Approve/Reject later)</option>
              <option value="Approved">Approved Immediately (Mark Attendance as Leave)</option>
            </select>
          </div>

          <div>
            <label className="block font-medium">Reason *</label>
            <textarea
              required
              rows={3}
              value={createForm.reason}
              onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })}
              placeholder="Write reason for leave..."
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpenCreate(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busyKey === 'create'}
              className="rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {busyKey === 'create' ? 'Submitting...' : 'Submit Leave'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
