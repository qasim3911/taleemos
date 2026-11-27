'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  type ComplaintItem,
  type ComplaintPriority,
  type ComplaintStatus,
  type ComplaintSummary,
} from '@/lib/complaints/complaint-service';
import {
  CheckCircle2,
  Clock,
  MessageSquare,
  MessageSquareWarning,
  Plus,
  Search,
  Send,
  UserCheck,
  Users,
} from 'lucide-react';

function StatusBadge({ status }: { status: ComplaintStatus }) {
  const cls =
    status === 'resolved' || status === 'closed'
      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
      : status === 'in_progress'
        ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900'
        : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900';

  const label =
    status === 'in_progress'
      ? 'In Progress'
      : status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: ComplaintPriority }) {
  const cls =
    priority === 'urgent'
      ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900'
      : priority === 'high'
        ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700';

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold capitalize ${cls}`}>
      {priority}
    </span>
  );
}

export default function SchoolComplaintsPage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [complaints, setComplaints] = useState<ComplaintItem[]>([]);
  const [summary, setSummary] = useState<ComplaintSummary>({
    total: 0,
    open: 0,
    inProgress: 0,
    resolved: 0,
    teacherCount: 0,
    studentCount: 0,
  });
  const [loading, setLoading] = useState(true);

  const [roleFilter, setRoleFilter] = useState<'all' | 'teacher' | 'student'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ComplaintStatus>('all');
  const [query, setQuery] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyStatus, setReplyStatus] = useState<ComplaintStatus | ''>('');
  const [busyAction, setBusyAction] = useState(false);

  const [openNewModal, setOpenNewModal] = useState(false);
  const [newForm, setNewForm] = useState({
    submitterType: 'student' as 'teacher' | 'student' | 'admin',
    submitterName: '',
    category: COMPLAINT_CATEGORIES[0] as string,
    priority: 'normal' as ComplaintPriority,
    subject: '',
    description: '',
  });

  const loadComplaints = useCallback(async () => {
    try {
      const res = await fetch('/api/complaints', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const list = (data.complaints ?? []) as ComplaintItem[];
      setComplaints(list);
      if (data.summary) setSummary(data.summary);
      setSelectedId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0]?.id ?? null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadComplaints();
    });
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const ch = supabase
      .channel(`school-complaints-${school.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'complaints', filter: `school_id=eq.${school.id}` },
        () => void loadComplaints()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'complaint_replies', filter: `school_id=eq.${school.id}` },
        () => void loadComplaints()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_tickets', filter: `school_id=eq.${school.id}` },
        () => void loadComplaints()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_ticket_messages', filter: `school_id=eq.${school.id}` },
        () => void loadComplaints()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadComplaints, school.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return complaints.filter((c) => {
      if (roleFilter !== 'all' && c.submitterType !== roleFilter) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      // FIX: agar koi field khaali / null ho to crash na ho
      return (
        (c.subject || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q) ||
        (c.submitterName || '').toLowerCase().includes(q) ||
        (c.submitterCode || '').toLowerCase().includes(q) ||
        (c.category || '').toLowerCase().includes(q)
      );
    });
  }, [complaints, roleFilter, statusFilter, query]);

  const selected = useMemo(
    () => filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId]
  );

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !replyText.trim()) return;
    setBusyAction(true);
    try {
      const res = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reply',
          complaintId: selected.id,
          message: replyText.trim(),
          status: replyStatus || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to send reply', description: data.error, variant: 'error' });
        return;
      }
      toast({ title: 'Reply sent & submitter notified', variant: 'success' });
      setReplyText('');
      setReplyStatus('');
      await loadComplaints();
    } finally {
      setBusyAction(false);
    }
  };

  const handleStatusChange = async (complaintId: string, nextStatus: ComplaintStatus) => {
    setBusyAction(true);
    try {
      const res = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_status',
          complaintId,
          status: nextStatus,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to update status', description: data.error, variant: 'error' });
        return;
      }
      toast({ title: `Status updated to ${nextStatus.replace('_', ' ')}`, variant: 'success' });
      await loadComplaints();
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateInternal = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction(true);
    try {
      const res = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          ...newForm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to log complaint', description: data.error, variant: 'error' });
        return;
      }
      toast({ title: 'Complaint logged', variant: 'success' });
      setOpenNewModal(false);
      setNewForm({
        submitterType: 'student',
        submitterName: '',
        category: COMPLAINT_CATEGORIES[0],
        priority: 'normal',
        subject: '',
        description: '',
      });
      await loadComplaints();
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Teacher & Student Complaints
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Receive, review, reply, and resolve complaints filed by Teachers and Students in real time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpenNewModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-2 text-xs font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Log Walk-in Complaint
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-medium">Total Complaints</span>
            <MessageSquareWarning className="h-4 w-4 text-teal-700 dark:text-teal-400" />
          </div>
          <p className="mt-1 font-mono-tabular text-xl font-bold">{summary.total}</p>
          <p className="text-[10px] text-slate-400">
            {summary.teacherCount} teacher · {summary.studentCount} student
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-amber-700 dark:text-amber-400">
            <span className="text-[11px] font-medium">Open</span>
            <Clock className="h-4 w-4" />
          </div>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-amber-700 dark:text-amber-300">
            {summary.open}
          </p>
          <p className="text-[10px] text-slate-400">Awaiting admin action</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-sky-700 dark:text-sky-400">
            <span className="text-[11px] font-medium">In Progress</span>
            <MessageSquare className="h-4 w-4" />
          </div>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-sky-700 dark:text-sky-300">
            {summary.inProgress}
          </p>
          <p className="text-[10px] text-slate-400">Under review / replied</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
            <span className="text-[11px] font-medium">Resolved / Closed</span>
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-emerald-700 dark:text-emerald-300">
            {summary.resolved}
          </p>
          <p className="text-[10px] text-slate-400">Completed cases</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'all', label: `All (${summary.total})`, icon: Users },
            { id: 'teacher', label: `Teachers (${summary.teacherCount})`, icon: UserCheck },
            { id: 'student', label: `Students (${summary.studentCount})`, icon: Users },
          ].map((item) => {
            const Icon = item.icon;
            const active = roleFilter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setRoleFilter(item.id as typeof roleFilter)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  active
                    ? 'bg-teal-700 text-white'
                    : 'border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search complaints..."
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 py-1.5 pl-8 pr-3 text-xs"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-500">
          Loading complaints...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-500">
          No complaints match the current filter. Complaints submitted by Teachers or Students from their portals appear here automatically.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800 max-h-[640px] overflow-y-auto">
            {filtered.map((item) => {
              const isSelected = selected?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left p-4 transition-colors space-y-1.5 ${
                    isSelected
                      ? 'bg-teal-50/70 dark:bg-teal-950/30 border-l-4 border-l-teal-700'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-bold text-slate-900 dark:text-white line-clamp-1">
                      {item.subject}
                    </p>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span
                      className={`rounded px-1.5 py-0.5 font-semibold capitalize ${
                        item.submitterType === 'teacher'
                          ? 'bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300'
                          : 'bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300'
                      }`}
                    >
                      {item.submitterType}
                    </span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {item.submitterName}
                    </span>
                    <span className="text-slate-400">({item.submitterCode})</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
                    <span>{item.category}</span>
                    <div className="flex items-center gap-2">
                      <PriorityBadge priority={item.priority} />
                      <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-5">
            {selected && (
              <>
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                          {selected.subject}
                        </h3>
                        <PriorityBadge priority={selected.priority} />
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Submitted by <strong>{selected.submitterName}</strong> ({selected.submitterCode} ·{' '}
                        {selected.submitterSubtext}) · {selected.category}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Filed on {new Date(selected.createdAt).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-semibold text-slate-500">Status:</label>
                      <select
                        disabled={busyAction}
                        value={selected.status}
                        onChange={(e) =>
                          void handleStatusChange(selected.id, e.target.value as ComplaintStatus)
                        }
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-semibold"
                      >
                        {COMPLAINT_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st === 'in_progress'
                              ? 'In Progress'
                              : st.charAt(0).toUpperCase() + st.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-xs leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                    {selected.description}
                  </div>

                  <div className="space-y-2.5">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Responses & Conversation ({selected.replies.length})
                    </p>
                    {selected.replies.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No replies yet. Send a response below to notify the {selected.submitterType}.
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {selected.replies.map((rep) => (
                          <div
                            key={rep.id}
                            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-teal-700 dark:text-teal-400">
                                {rep.senderName}
                              </span>
                              <span className="text-slate-400">
                                {new Date(rep.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                              {rep.message}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <form
                  onSubmit={handleReply}
                  className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3"
                >
                  <textarea
                    rows={3}
                    required
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write an official response or resolution note..."
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <select
                      value={replyStatus}
                      onChange={(e) => setReplyStatus(e.target.value as ComplaintStatus | '')}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                    >
                      <option value="">Keep / Auto-update Status</option>
                      <option value="in_progress">Mark In Progress</option>
                      <option value="resolved">Mark Resolved</option>
                      <option value="closed">Mark Closed</option>
                    </select>
                    <button
                      type="submit"
                      disabled={busyAction || !replyText.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Send Reply
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      <ModalDialog
        open={openNewModal}
        onClose={() => setOpenNewModal(false)}
        title="Log Walk-in Teacher / Student Complaint"
      >
        <form onSubmit={handleCreateInternal} className="space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Complainant Type *</label>
              <select
                value={newForm.submitterType}
                onChange={(e) =>
                  setNewForm({ ...newForm, submitterType: e.target.value as 'teacher' | 'student' | 'admin' })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="student">Student / Guardian</option>
                <option value="teacher">Teacher / Staff</option>
                <option value="admin">School Admin Note</option>
              </select>
            </div>
            <div>
              <label className="block font-medium">Complainant Name *</label>
              <input
                required
                value={newForm.submitterName}
                onChange={(e) => setNewForm({ ...newForm, submitterName: e.target.value })}
                placeholder="Full name"
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Category *</label>
              <select
                value={newForm.category}
                onChange={(e) => setNewForm({ ...newForm, category: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                {COMPLAINT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium">Priority *</label>
              <select
                value={newForm.priority}
                onChange={(e) =>
                  setNewForm({ ...newForm, priority: e.target.value as ComplaintPriority })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                {COMPLAINT_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block font-medium">Subject *</label>
            <input
              required
              value={newForm.subject}
              onChange={(e) => setNewForm({ ...newForm, subject: e.target.value })}
              placeholder="Brief complaint title"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">Details *</label>
            <textarea
              required
              rows={4}
              value={newForm.description}
              onChange={(e) => setNewForm({ ...newForm, description: e.target.value })}
              placeholder="Describe the issue in detail..."
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpenNewModal(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busyAction}
              className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              Save Complaint
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}