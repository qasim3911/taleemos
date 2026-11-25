'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { Plus } from 'lucide-react';

interface SessionRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
}

export default function AcademicSessionsPage() {
  const { school } = useSchool();
  const { toast } = useToast();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openAdd, setOpenAdd] = useState(false);
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '', is_current: true });

  const loadData = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { data } = await supabase
      .from('academic_sessions')
      .select('*')
      .eq('school_id', school.id)
      .order('start_date', { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  }, [school.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    if (form.is_current) {
      await supabase.from('academic_sessions').update({ is_current: false }).eq('school_id', school.id);
    }
    const { error } = await supabase.from('academic_sessions').insert({
      school_id: school.id,
      ...form,
    });
    if (error) {
      toast({ title: 'Unable to add session', description: error.message, variant: 'error' });
      return;
    }
    toast({ title: 'Academic session saved', variant: 'success' });
    setOpenAdd(false);
    loadData();
  };

  const setAsCurrent = async (id: string) => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.from('academic_sessions').update({ is_current: false }).eq('school_id', school.id);
    await supabase.from('academic_sessions').update({ is_current: true }).eq('id', id).eq('school_id', school.id);
    toast({ title: 'Active session updated', variant: 'success' });
    loadData();
  };

  const columns: TableColumn<SessionRow>[] = [
    { key: 'name', header: 'Session Name', render: (r) => <span className="font-semibold">{r.name}</span>, exportValue: (r) => r.name },
    { key: 'start', header: 'Start Date', render: (r) => <span className="font-mono-tabular">{r.start_date}</span>, exportValue: (r) => r.start_date },
    { key: 'end', header: 'End Date', render: (r) => <span className="font-mono-tabular">{r.end_date}</span>, exportValue: (r) => r.end_date },
    { key: 'curr', header: 'Status', render: (r) => (r.is_current ? 'Current Active Session' : 'Archived / Inactive'), exportValue: (r) => (r.is_current ? 'Active' : 'Inactive') },
    {
      key: 'act',
      header: 'Action',
      align: 'right',
      render: (r) =>
        !r.is_current ? (
          <button type="button" onClick={() => setAsCurrent(r.id)} className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium">
            Set Active
          </button>
        ) : (
          <span className="text-[11px] font-semibold text-teal-700 dark:text-teal-400">Active</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Academic Sessions"
        subtitle="Manage annual academic terms (e.g. 2026-2027) for enrollments, promotions, and exams."
        rows={rows}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => r.name}
        primaryAction={
          <button type="button" onClick={() => setOpenAdd(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white">
            <Plus className="h-3.5 w-3.5" />
            New Session
          </button>
        }
      />

      <ModalDialog open={openAdd} onClose={() => setOpenAdd(false)} title="Create Academic Session">
        <form onSubmit={handleCreate} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Session Title *</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="2026-2027" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Start Date *</label>
              <input type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">End Date *</label>
              <input type="date" required value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 pt-1">
            <input type="checkbox" checked={form.is_current} onChange={(e) => setForm({ ...form, is_current: e.target.checked })} />
            <span>Mark as Current Active Session</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenAdd(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Session</button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
