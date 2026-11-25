'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { Plus } from 'lucide-react';

interface AnnouncementRow {
  id: string;
  title: string;
  message: string;
  audience: string;
  created_at: string;
}

export default function AnnouncementsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openAdd, setOpenAdd] = useState(false);
  const [form, setForm] = useState({ title: '', message: '', audience: 'All' });

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/announcements');
      const data = await res.json();
      if (res.ok) {
        setRows(data.announcements ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ title: 'Error posting announcement', description: data.error, variant: 'error' });
      return;
    }
    toast({ title: 'Announcement published', variant: 'success' });
    setOpenAdd(false);
    setForm({ title: '', message: '', audience: 'All' });
    void loadData();
  };

  const columns: TableColumn<AnnouncementRow>[] = [
    { key: 'title', header: 'Announcement', render: (r) => <span className="font-semibold">{r.title}</span>, exportValue: (r) => r.title },
    { key: 'aud', header: 'Audience', render: (r) => r.audience, exportValue: (r) => r.audience },
    { key: 'msg', header: 'Message', render: (r) => r.message, exportValue: (r) => r.message },
    { key: 'date', header: 'Published', render: (r) => <span className="font-mono-tabular">{new Date(r.created_at).toLocaleString()}</span> },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="School Announcements"
        subtitle="Publish school notices synced to Teacher App, Student App, and notifications feed."
        rows={rows}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.title} ${r.message} ${r.audience}`}
        primaryAction={
          <button type="button" onClick={() => setOpenAdd(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white">
            <Plus className="h-3.5 w-3.5" />
            New Announcement
          </button>
        }
      />

      <ModalDialog open={openAdd} onClose={() => setOpenAdd(false)} title="Publish Announcement">
        <form onSubmit={handleCreate} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Title *</label>
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block font-medium">Target Audience</label>
            <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              <option value="All">All (Teachers & Students)</option>
              <option value="Teachers">Teachers Only</option>
              <option value="Students">Students Only</option>
            </select>
          </div>
          <div>
            <label className="block font-medium">Message *</label>
            <textarea required rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenAdd(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Publish</button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
