'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { Plus, Trash2 } from 'lucide-react';

interface HomeworkRow {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  class_id: string;
  section_id: string | null;
  subject_id: string;
  created_at?: string;
}

interface SectionOption {
  id: string;
  name: string;
  class_id: string;
}

function getLocalTodayDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function DailyHomeworkPage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [homework, setHomework] = useState<HomeworkRow[]>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [classSubjects, setClassSubjects] = useState<Array<{ class_id: string; subject_id: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HomeworkRow | null>(null);

  const [openHw, setOpenHw] = useState(false);
  const [hwForm, setHwForm] = useState({
    class_id: '',
    section_id: '',
    subject_id: '',
    title: '',
    description: '',
    homework_date: getLocalTodayDate(),
    due_date: getLocalTodayDate(),
  });

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/homework', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Unable to load homework',
          description: data.error || 'Failed to fetch daily homework records.',
          variant: 'error',
        });
        return;
      }
      setHomework(data.homework ?? []);
      setClasses(data.classes ?? []);
      setSections(data.sections ?? []);
      setSubjects(data.subjects ?? []);
      setClassSubjects(data.classSubjects ?? []);
    } catch {
      toast({
        title: 'Unable to load homework',
        description: 'Network error while fetching daily homework.',
        variant: 'error',
      });
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
    const ch = supabase
      .channel(`hw-sync-${school.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'homework_assignments',
          filter: `school_id=eq.${school.id}`,
        },
        () => {
          void loadData();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadData, school.id]);

  const classMap = new Map(classes.map((c) => [c.id, c.name]));
  const sectionMap = new Map(sections.map((s) => [s.id, s.name]));
  const subjectMap = new Map(subjects.map((s) => [s.id, s.name]));
  const filteredSections = sections.filter((s) => s.class_id === hwForm.class_id);

  const filteredSubjects = (() => {
    if (!hwForm.class_id) return subjects;
    const allowedIds = new Set(
      classSubjects.filter((cs) => cs.class_id === hwForm.class_id).map((cs) => cs.subject_id)
    );
    if (allowedIds.size === 0) return [];
    return subjects.filter((s) => allowedIds.has(s.id));
  })();

  const handleCreateHw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hwForm.subject_id) {
      toast({
        title: 'Subject select karein',
        description: 'Is Class ke liye koi Subject assign nahi hai. Pehle Class ko Subject assign karein.',
        variant: 'error',
      });
      return;
    }

    setSaving(true);
    try {
      const today = getLocalTodayDate();
      const hwDate = hwForm.homework_date || today;
      const res = await fetch('/api/homework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class_id: hwForm.class_id,
          section_id: hwForm.section_id || null,
          subject_id: hwForm.subject_id,
          title: hwForm.title.trim(),
          description: hwForm.description.trim() || null,
          homework_date: hwDate,
          due_date: hwForm.due_date || hwDate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Unable to save daily homework',
          description: data.error || 'Could not create homework.',
          variant: 'error',
        });
        return;
      }
      toast({ title: 'Daily homework added & synced', variant: 'success' });
      setOpenHw(false);
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDeleteHw = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeletingId(target.id);
    try {
      const res = await fetch(`/api/homework?id=${encodeURIComponent(target.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Delete nahi hua',
          description: data.error || 'Unable to delete homework record.',
          variant: 'error',
        });
        return;
      }
      toast({ title: 'Homework delete ho gaya', variant: 'success' });
      setHomework((prev) => prev.filter((h) => h.id !== target.id));
      setDeleteTarget(null);
    } catch {
      toast({
        title: 'Delete nahi hua',
        description: 'Network error while deleting homework.',
        variant: 'error',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const hwColumns: TableColumn<HomeworkRow>[] = [
    {
      key: 'hw_date',
      header: 'Homework Date',
      render: (r) => (
        <span className="font-mono-tabular text-xs font-medium text-slate-700 dark:text-slate-300">
          {r.created_at ? r.created_at.slice(0, 10) : r.due_date}
        </span>
      ),
      exportValue: (r) => (r.created_at ? r.created_at.slice(0, 10) : r.due_date),
    },
    {
      key: 'title',
      header: 'Homework Title',
      render: (r) => <span className="font-semibold">{r.title}</span>,
      exportValue: (r) => r.title,
    },
    {
      key: 'cls',
      header: 'Class & Section',
      render: (r) => {
        const clsName = classMap.get(r.class_id) || '—';
        const secName = r.section_id ? sectionMap.get(r.section_id) : null;
        return (
          <span>
            {clsName}
            <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">
              ({secName ? `Section ${secName}` : 'All Sections'})
            </span>
          </span>
        );
      },
      exportValue: (r) => {
        const clsName = classMap.get(r.class_id) || '';
        const secName = r.section_id ? sectionMap.get(r.section_id) : 'All Sections';
        return `${clsName} (${secName || 'All Sections'})`;
      },
    },
    {
      key: 'sub',
      header: 'Subject',
      render: (r) => subjectMap.get(r.subject_id) || '—',
      exportValue: (r) => subjectMap.get(r.subject_id) || '',
    },
    {
      key: 'desc',
      header: 'Instructions',
      render: (r) => r.description || '—',
      exportValue: (r) => r.description || '',
    },
    {
      key: 'due',
      header: 'Due Date',
      render: (r) => <span className="font-mono-tabular">{r.due_date}</span>,
      exportValue: (r) => r.due_date,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <button
          type="button"
          onClick={() => setDeleteTarget(r)}
          disabled={deletingId === r.id}
          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          title="Delete Homework"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {deletingId === r.id ? 'Deleting...' : 'Delete'}
        </button>
      ),
      exportValue: () => '',
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Daily Homework"
        subtitle="Synchronizes live with Teacher App uploads and Student App class feeds."
        rows={homework}
        columns={hwColumns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) =>
          `${r.title} ${r.description || ''} ${classMap.get(r.class_id) || ''} ${r.section_id ? sectionMap.get(r.section_id) || '' : 'All Sections'} ${r.created_at ? r.created_at.slice(0, 10) : ''} ${r.due_date}`
        }
        exportFileName="daily-homework"
        primaryAction={
          <button
            type="button"
            onClick={() => {
              const firstClassId = classes[0]?.id || '';
              const firstSecId =
                sections.find((s) => s.class_id === firstClassId)?.id || '';
              const firstAllowed = classSubjects.filter((cs) => cs.class_id === firstClassId).map((cs) => cs.subject_id);
              const firstSubId = subjects.find((s) => firstAllowed.includes(s.id))?.id || '';
              const today = getLocalTodayDate();
              setHwForm({
                class_id: firstClassId,
                section_id: firstSecId,
                subject_id: firstSubId,
                title: '',
                description: '',
                homework_date: today,
                due_date: today,
              });
              setOpenHw(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Daily Homework
          </button>
        }
      />

      <ModalDialog open={openHw} onClose={() => setOpenHw(false)} title="Add Daily Homework">
        <form onSubmit={handleCreateHw} className="space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Class *</label>
              <select
                required
                value={hwForm.class_id}
                onChange={(e) => {
                  const nextClassId = e.target.value;
                  const firstSec =
                    sections.find((s) => s.class_id === nextClassId)?.id || '';
                  const allowed = classSubjects.filter((cs) => cs.class_id === nextClassId).map((cs) => cs.subject_id);
                  const firstSub = subjects.find((s) => allowed.includes(s.id))?.id || '';
                  setHwForm({
                    ...hwForm,
                    class_id: nextClassId,
                    section_id: firstSec,
                    subject_id: firstSub,
                  });
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium">Section</label>
              <select
                value={hwForm.section_id}
                onChange={(e) => setHwForm({ ...hwForm, section_id: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="">All Sections</option>
                {filteredSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    Section {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block font-medium">Subject *</label>
            <select
              required
              value={hwForm.subject_id}
              onChange={(e) => setHwForm({ ...hwForm, subject_id: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              {filteredSubjects.length === 0 ? (
                <option value="">Is Class ke liye koi Subject assign nahi hai</option>
              ) : (
                filteredSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
            {filteredSubjects.length === 0 && hwForm.class_id && (
              <p className="mt-1 text-[11px] text-amber-600">Pehle is Class ko Subject assign karein, phir yahan Subject aayega.</p>
            )}
          </div>
          <div>
            <label className="block font-medium">Homework Title *</label>
            <input
              required
              value={hwForm.title}
              onChange={(e) => setHwForm({ ...hwForm, title: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Homework Date *</label>
              <input
                type="date"
                required
                value={hwForm.homework_date}
                onChange={(e) =>
                  setHwForm((prev) => ({
                    ...prev,
                    homework_date: e.target.value,
                    due_date:
                      prev.due_date < e.target.value ? e.target.value : prev.due_date,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium">Due Date *</label>
              <input
                type="date"
                required
                value={hwForm.due_date}
                onChange={(e) => setHwForm({ ...hwForm, due_date: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block font-medium">Instructions</label>
            <textarea
              rows={3}
              value={hwForm.description}
              onChange={(e) => setHwForm({ ...hwForm, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpenHw(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Daily Homework'}
            </button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deletingId) setDeleteTarget(null);
        }}
        title="Delete Daily Homework"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4 text-xs">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Kya aap is Homework ko delete karna chahte hain?
          </p>
          {deleteTarget && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 space-y-1">
              <p className="font-semibold text-sm text-slate-900 dark:text-white">
                {deleteTarget.title}
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                Class: {classMap.get(deleteTarget.class_id) || '—'} · Subject:{' '}
                {subjectMap.get(deleteTarget.subject_id) || '—'} · Due: {deleteTarget.due_date}
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={Boolean(deletingId)}
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={Boolean(deletingId)}
              onClick={handleConfirmDeleteHw}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deletingId ? 'Deleting...' : 'Delete Homework'}
            </button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}