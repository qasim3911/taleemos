'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { Plus } from 'lucide-react';

interface ClassRow {
  id: string;
  name: string;
  level_order: number;
  tuition_fee_pkr: number;
  is_custom: boolean;
}

interface SectionRow {
  id: string;
  class_id: string;
  name: string;
  capacity: number | null;
}

export default function ClassesSectionsPage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openClassModal, setOpenClassModal] = useState(false);
  const [openSectionModal, setOpenSectionModal] = useState(false);

  const [classForm, setClassForm] = useState({ name: '', tuition_fee_pkr: '3000', level_order: '1' });
  const [sectionForm, setSectionForm] = useState({ class_id: '', name: '', capacity: '40' });

  const loadData = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const [{ data: cls }, { data: sec }] = await Promise.all([
      supabase.from('classes').select('*').eq('school_id', school.id).order('level_order'),
      supabase.from('sections').select('*').eq('school_id', school.id).order('name'),
    ]);
    setClasses(cls ?? []);
    setSections(sec ?? []);
    setLoading(false);
  }, [school.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const handleAddClass = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.from('classes').insert({
      school_id: school.id,
      name: classForm.name,
      level_order: Number(classForm.level_order) || 1,
      tuition_fee_pkr: Number(classForm.tuition_fee_pkr) || 0,
      is_custom: true,
    });
    if (error) {
      toast({ title: 'Error adding class', description: error.message, variant: 'error' });
      return;
    }
    toast({ title: 'Class created', variant: 'success' });
    setOpenClassModal(false);
    setClassForm({ name: '', tuition_fee_pkr: '3000', level_order: '1' });
    loadData();
  };

  const handleAddSection = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.from('sections').insert({
      school_id: school.id,
      class_id: sectionForm.class_id,
      name: sectionForm.name,
      capacity: Number(sectionForm.capacity) || 40,
    });
    if (error) {
      toast({ title: 'Error adding section', description: error.message, variant: 'error' });
      return;
    }
    toast({ title: 'Section added', variant: 'success' });
    setOpenSectionModal(false);
    loadData();
  };

  const columns: TableColumn<ClassRow>[] = [
    { key: 'order', header: 'Level', render: (r) => <span className="font-mono-tabular">{r.level_order}</span> },
    { key: 'name', header: 'Class Name', render: (r) => <span className="font-semibold">{r.name}</span>, exportValue: (r) => r.name },
    {
      key: 'fee',
      header: 'Default Tuition (PKR)',
      align: 'right',
      render: (r) => <span className="font-mono-tabular">PKR {Number(r.tuition_fee_pkr || 0).toLocaleString()}</span>,
      exportValue: (r) => Number(r.tuition_fee_pkr || 0),
    },
    {
      key: 'sections',
      header: 'Sections',
      render: (r) => {
        const list = sections.filter((s) => s.class_id === r.id);
        return list.length > 0 ? list.map((s) => `${s.name}${s.capacity ? ` (${s.capacity})` : ''}`).join(', ') : 'No sections yet';
      },
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Classes & Sections"
        subtitle="Configure Pakistani Playgroup / Nursery to Matric / Intermediate classes and default monthly tuition fees."
        rows={classes}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.name} ${r.level_order}`}
        exportFileName="classes-sections"
        primaryAction={
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpenClassModal(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white">
              <Plus className="h-3.5 w-3.5" />
              Add Class
            </button>
            <button
              type="button"
              onClick={() => {
                setSectionForm({ class_id: classes[0]?.id || '', name: '', capacity: '40' });
                setOpenSectionModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-1.5 text-xs font-semibold"
            >
              Add Section
            </button>
          </div>
        }
      />

      <ModalDialog open={openClassModal} onClose={() => setOpenClassModal(false)} title="Create Class">
        <form onSubmit={handleAddClass} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Class Name *</label>
            <input required value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} placeholder="e.g. Grade 9 (Science)" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Default Monthly Tuition (PKR)</label>
              <input type="number" min="0" value={classForm.tuition_fee_pkr} onChange={(e) => setClassForm({ ...classForm, tuition_fee_pkr: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Level Order</label>
              <input type="number" value={classForm.level_order} onChange={(e) => setClassForm({ ...classForm, level_order: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenClassModal(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Class</button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog open={openSectionModal} onClose={() => setOpenSectionModal(false)} title="Add Class Section">
        <form onSubmit={handleAddSection} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Class *</label>
            <select required value={sectionForm.class_id} onChange={(e) => setSectionForm({ ...sectionForm, class_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              <option value="">Select Class</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Section Name *</label>
              <input required value={sectionForm.name} onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })} placeholder="Iqbal / Red / A" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Capacity</label>
              <input type="number" value={sectionForm.capacity} onChange={(e) => setSectionForm({ ...sectionForm, capacity: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenSectionModal(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Section</button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
