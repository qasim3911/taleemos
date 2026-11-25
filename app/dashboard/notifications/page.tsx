'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { Plus } from 'lucide-react';

interface NotificationRow {
  id: string;
  category: string;
  target_audience: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

const CATEGORY_OPTIONS = [
  { value: 'attendance', label: 'Attendance Alert' },
  { value: 'fees', label: 'Fee Reminder' },
  { value: 'homework', label: 'Homework Notification' },
  { value: 'results', label: 'Exam & Results Alert' },
  { value: 'timetable', label: 'Timetable Update' },
  { value: 'online_classes', label: 'Online Class' },
  { value: 'announcements', label: 'Announcement' },
];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label])
);

export default function NotificationsPage() {
  const { school } = useSchool();
  const { toast } = useToast();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSend, setOpenSend] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    category: 'fees',
    target_audience: 'Students',
    title: '',
    body: '',
  });

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      const data = await res.json();
      if (res.ok) {
        setRows(data.notifications ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const ch = supabase
      .channel(`notif-feed-${school.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `school_id=eq.${school.id}` },
        () => {
          void loadData();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadData, school.id]);

  const markRead = async (id: string) => {
    const res = await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_read: true }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({ title: 'Update failed', description: err.error, variant: 'error' });
      return;
    }
    void loadData();
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Error sending notification', description: data.error, variant: 'error' });
        return;
      }
      toast({ title: 'Notification dispatched via Realtime', variant: 'success' });
      setOpenSend(false);
      setForm({ category: 'fees', target_audience: 'Students', title: '', body: '' });
      void loadData();
    } finally {
      setSubmitting(false);
    }
  };

  const columns: TableColumn<NotificationRow>[] = [
    {
      key: 'cat',
      header: 'Category',
      render: (r) => <span className="font-semibold">{CATEGORY_LABELS[r.category] || r.category}</span>,
    },
    { key: 'role', header: 'Audience', render: (r) => r.target_audience },
    {
      key: 'title',
      header: 'Alert',
      render: (r) => (
        <div>
          <p className="font-semibold">{r.title}</p>
          <p className="text-slate-500">{r.body}</p>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'Time',
      render: (r) => <span className="font-mono-tabular">{new Date(r.created_at).toLocaleString()}</span>,
    },
    {
      key: 'act',
      header: 'Status',
      align: 'right',
      render: (r) =>
        r.is_read ? (
          <span className="text-slate-400">Read</span>
        ) : (
          <button
            type="button"
            onClick={() => markRead(r.id)}
            className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium"
          >
            Mark Read
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Notifications Center"
        subtitle="Real-time attendance alerts, fee reminders, homework alerts, and examination notices."
        rows={rows}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.category} ${r.title} ${r.body}`}
        primaryAction={
          <button
            type="button"
            onClick={() => setOpenSend(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Send Alert
          </button>
        }
      />

      <ModalDialog open={openSend} onClose={() => setOpenSend(false)} title="Send School Notification">
        <form onSubmit={handleSend} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium">Target Audience</label>
              <select
                value={form.target_audience}
                onChange={(e) => setForm({ ...form, target_audience: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="All">All</option>
                <option value="Teachers">Teachers</option>
                <option value="Students">Students</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block font-medium">Title *</label>
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">Body *</label>
            <textarea
              required
              rows={3}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpenSend(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {submitting ? 'Dispatching...' : 'Dispatch Alert'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
