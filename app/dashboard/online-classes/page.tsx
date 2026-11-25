'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { Plus } from 'lucide-react';

interface OnlineClassRow {
  id: string;
  title: string;
  provider: string;
  room_name: string;
  notes_url: string | null;
  recording_url: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  class_id: string;
}

export default function OnlineClassesPage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [rows, setRows] = useState<OnlineClassRow[]>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [teachers, setTeachers] = useState<Array<{ id: string; full_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [openAdd, setOpenAdd] = useState(false);

  const [form, setForm] = useState({
    class_id: '',
    teacher_id: '',
    title: '',
    provider: 'LiveKit',
    room_name: '',
    notes_url: '',
    scheduled_at: '',
    duration_minutes: '45',
  });

  const loadData = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const [{ data: oc }, { data: cls }, { data: tch }] = await Promise.all([
      supabase.from('online_classes').select('*').eq('school_id', school.id).order('scheduled_at', { ascending: false }),
      supabase.from('classes').select('id, name').eq('school_id', school.id),
      supabase.from('teachers').select('id, full_name').eq('school_id', school.id),
    ]);
    setRows(oc ?? []);
    setClasses(cls ?? []);
    setTeachers(tch ?? []);
    setLoading(false);
  }, [school.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const classMap = new Map(classes.map((c) => [c.id, c.name]));

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    if (!form.teacher_id) {
      toast({ title: 'Please select a conducting teacher', variant: 'error' });
      return;
    }
    const room = form.room_name || `class-${Date.now().toString().slice(-6)}`;
    const { error } = await supabase.from('online_classes').insert({
      school_id: school.id,
      class_id: form.class_id,
      teacher_id: form.teacher_id,
      title: form.title,
      provider: form.provider,
      room_name: room,
      notes_url: form.notes_url || `https://meet.livekit.io/rooms/${room}`,
      scheduled_at: form.scheduled_at,
      duration_minutes: Number(form.duration_minutes) || 45,
      status: 'scheduled',
      student_access_enabled: true,
    });
    if (error) {
      toast({ title: 'Unable to schedule class', description: error.message, variant: 'error' });
      return;
    }
    toast({ title: 'Online class scheduled for Teacher & Student Apps', variant: 'success' });
    setOpenAdd(false);
    loadData();
  };

  const columns: TableColumn<OnlineClassRow>[] = [
    { key: 'title', header: 'Session Title', render: (r) => <span className="font-semibold">{r.title}</span>, exportValue: (r) => r.title },
    { key: 'cls', header: 'Class', render: (r) => classMap.get(r.class_id) || '—', exportValue: (r) => classMap.get(r.class_id) || '' },
    { key: 'prov', header: 'Video Provider', render: (r) => `${r.provider} · ${r.room_name}`, exportValue: (r) => r.provider },
    { key: 'when', header: 'Scheduled Time', render: (r) => <span className="font-mono-tabular">{new Date(r.scheduled_at).toLocaleString()}</span> },
    { key: 'status', header: 'Status', render: (r) => r.status },
    {
      key: 'join',
      header: 'Meeting Link',
      align: 'right',
      render: (r) =>
        r.notes_url ? (
          <a href={r.notes_url} target="_blank" rel="noreferrer" className="rounded bg-teal-700 px-2.5 py-1 text-[11px] font-semibold text-white">
            Open Room
          </a>
        ) : (
          <span className="text-xs text-slate-400">{r.room_name}</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Online Classes"
        subtitle="Schedule live classes using dedicated video providers (LiveKit, Agora, Meet). Supabase stores schedules & access metadata only."
        rows={rows}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.title} ${r.provider} ${r.room_name}`}
        primaryAction={
          <button
            type="button"
            onClick={() => {
              setForm({
                class_id: classes[0]?.id || '',
                teacher_id: teachers[0]?.id || '',
                title: '',
                provider: 'LiveKit',
                room_name: '',
                notes_url: '',
                scheduled_at: '',
                duration_minutes: '45',
              });
              setOpenAdd(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Schedule Online Class
          </button>
        }
      />

      <ModalDialog open={openAdd} onClose={() => setOpenAdd(false)} title="Schedule Online Class">
        <form onSubmit={handleSchedule} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Topic / Title *</label>
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Grade 10 Mathematics — Quadratic Equations" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Class *</label>
              <select required value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-medium">Conducting Teacher *</label>
              <select required value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                <option value="">Select Teacher</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-medium">Video Provider</label>
              <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                <option value="LiveKit">LiveKit</option>
                <option value="Agora">Agora</option>
                <option value="Google Meet">Google Meet</option>
                <option value="Zoom">Zoom</option>
                <option value="Custom">Custom Provider</option>
              </select>
            </div>
            <div>
              <label className="block font-medium">Duration (Minutes)</label>
              <input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block font-medium">Scheduled Date & Time *</label>
            <input type="datetime-local" required value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block font-medium">Provider Meeting URL</label>
            <input type="url" value={form.notes_url} onChange={(e) => setForm({ ...form, notes_url: e.target.value })} placeholder="https://..." className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenAdd(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Schedule Class</button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
