'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { Plus, Pencil, Trash2 } from 'lucide-react';

interface SubjectRow { id: string; name: string; code: string | null; created_at: string; }
interface ClassRow { id: string; name: string; level_order: number; }
interface MappingRow { id: string; class_id: string; subject_id: string; }
type DisplayRow = SubjectRow & { mappingId: string; classId: string; className: string };

const selectClass = 'rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white [color-scheme:light] dark:[color-scheme:dark]';
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400';

export default function SubjectsPage() {
  const { school } = useSchool();
  const { toast } = useToast();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  const [openAdd, setOpenAdd] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', class_id: '' });
  const [openEdit, setOpenEdit] = useState(false);
  const [editRow, setEditRow] = useState<DisplayRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', code: '', class_id: '' });
  const [openDelete, setOpenDelete] = useState(false);
  const [deleteRow, setDeleteRow] = useState<DisplayRow | null>(null);

  const schoolId = school?.id;

  const loadData = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !schoolId) { setLoading(false); return; }
    setLoading(true);

    const { data: classData } = await supabase.from('classes').select('id, name, level_order').eq('school_id', schoolId).order('level_order');
    setClasses(classData ?? []);

    const { data: subjData } = await supabase.from('subjects').select('*').eq('school_id', schoolId).order('name');
    setSubjects(subjData ?? []);

    // FIX: created_at hataya - class_subjects me ye column hai hi nahi
    const { data: mapData } = await supabase.from('class_subjects').select('id, class_id, subject_id').eq('school_id', schoolId);
    setMappings(mapData ?? []);

    setLoading(false);
  }, [schoolId]);

  useEffect(() => { queueMicrotask(() => { void loadData(); }); }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    if (!form.class_id) { toast({ title: 'Class select karein', variant: 'error' }); return; }
    const cleanName = form.name.trim();
    const cleanCode = form.code.trim() || null;
    const savedClassId = form.class_id;

    let { data: existing } = await supabase.from('subjects').select('*').eq('school_id', school.id).ilike('name', cleanName).maybeSingle();
    let subjectId = existing?.id;
    if (!subjectId) {
      const { data: created, error: createErr } = await supabase.from('subjects').insert({ school_id: school.id, name: cleanName, code: cleanCode }).select().single();
      if (createErr) { toast({ title: 'Error', description: createErr.message, variant: 'error' }); return; }
      subjectId = created.id;
    }
    const { error: linkErr } = await supabase.from('class_subjects').insert({ school_id: school.id, class_id: savedClassId, subject_id: subjectId });
    if (linkErr) {
      if (linkErr.code === '23505') { toast({ title: 'Already added', description: 'Ye subject is class me pehle se hai.', variant: 'error' }); return; }
      toast({ title: 'Error', description: linkErr.message, variant: 'error' }); return;
    }
    toast({ title: 'Subject added', variant: 'success' });
    setOpenAdd(false);
    setForm({ name: '', code: '', class_id: '' });
    setSelectedClassId(savedClassId);
    await loadData();
  };

  const openEditModal = (row: DisplayRow) => { setEditRow(row); setEditForm({ name: row.name, code: row.code || '', class_id: row.classId }); setOpenEdit(true); };
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !editRow) return;
    const { error: subErr } = await supabase.from('subjects').update({ name: editForm.name.trim(), code: editForm.code.trim() || null }).eq('id', editRow.id).eq('school_id', school.id);
    if (subErr) { toast({ title: 'Error', description: subErr.message, variant: 'error' }); return; }
    if (editForm.class_id !== editRow.classId) {
      const { error: mapErr } = await supabase.from('class_subjects').update({ class_id: editForm.class_id }).eq('id', editRow.mappingId).eq('school_id', school.id);
      if (mapErr) { toast({ title: 'Error', description: mapErr.message, variant: 'error' }); return; }
    }
    toast({ title: 'Updated', variant: 'success' }); setOpenEdit(false); setEditRow(null); loadData();
  };
  const handleDeleteFromClass = async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !deleteRow) return;
    const { error } = await supabase.from('class_subjects').delete().eq('id', deleteRow.mappingId).eq('school_id', school.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'error' }); return; }
    toast({ title: 'Removed', variant: 'success' }); setOpenDelete(false); setDeleteRow(null); loadData();
  };

  const filteredRows: DisplayRow[] = (() => {
    const all = mappings.map((m) => {
      const subj = subjects.find((s) => s.id === m.subject_id);
      if (!subj) return null;
      const cls = classes.find((c) => c.id === m.class_id);
      return { ...subj, mappingId: m.id, classId: m.class_id, className: cls ? cls.name : '—' };
    }).filter(Boolean) as DisplayRow[];
    if (selectedClassId === 'all') return all;
    return all.filter((r) => r.classId === selectedClassId);
  })();

  const columns: TableColumn<DisplayRow>[] = [
    { key: 'className', header: 'Class', render: (r) => <span className="font-semibold text-teal-700 dark:text-teal-400">{r.className}</span>, exportValue: (r) => r.className },
    { key: 'code', header: 'Code', render: (r) => <span className="font-mono-tabular">{r.code || '—'}</span>, exportValue: (r) => r.code || '' },
    { key: 'name', header: 'Subject Name', render: (r) => <span className="font-semibold">{r.name}</span>, exportValue: (r) => r.name },
    { key: 'created', header: 'Added On', render: (r) => <span className="font-mono-tabular">{new Date(r.created_at).toLocaleDateString()}</span> },
    {
      key: 'actions', header: 'Actions',
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <button onClick={() => openEditModal(r)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"><Pencil className="h-3 w-3" /> Edit</button>
          <button onClick={() => { setDeleteRow(r); setOpenDelete(true); }} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100"><Trash2 className="h-3 w-3" /> Delete</button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="font-semibold">Class Select Karein:</label>
        <select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)} className={selectClass}>
          <option value="all">All Classes</option>
          {classes.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        <span className="text-slate-500">{selectedClassId === 'all' ? `Total: ${filteredRows.length} entries` : `Is class me: ${filteredRows.length} subjects`}</span>
      </div>
      <DataTable title="Subjects & Curriculum" subtitle="Har class ke apne subjects hain." rows={filteredRows} columns={columns} loading={loading} getRowKey={(r) => r.mappingId} getSearchText={(r) => `${r.name} ${r.code || ''} ${r.className}`} exportFileName="subjects-curriculum"
        primaryAction={<button type="button" onClick={() => { setForm({ name: '', code: '', class_id: selectedClassId !== 'all' ? selectedClassId : '' }); setOpenAdd(true); }} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" /> Add Subject</button>} />
      <ModalDialog open={openAdd} onClose={() => setOpenAdd(false)} title="Add Subject - Class Wise">
        <form onSubmit={handleCreate} className="space-y-3 text-xs">
          <div><label className="block font-medium">Select Class *</label><select required value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} className={selectClass + ' mt-1 w-full'}><option value="">-- Class Select Karein --</option>{classes.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="block font-medium">Subject Name *</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="English / Urdu / Math" className={inputClass} /></div><div><label className="block font-medium">Subject Code</label><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="ENG-01" className={inputClass} /></div></div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setOpenAdd(false)} className="rounded-lg border px-4 py-2 font-semibold">Cancel</button><button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Subject</button></div>
        </form>
      </ModalDialog>
      <ModalDialog open={openEdit} onClose={() => setOpenEdit(false)} title={`Edit Subject - ${editRow?.name || ''}`}>
        <form onSubmit={handleUpdate} className="space-y-3 text-xs">
          <div><label className="block font-medium">Class *</label><select required value={editForm.class_id} onChange={(e) => setEditForm({ ...editForm, class_id: e.target.value })} className={selectClass + ' mt-1 w-full'}>{classes.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="block font-medium">Subject Name *</label><input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inputClass} /></div><div><label className="block font-medium">Subject Code</label><input value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} className={inputClass} /></div></div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setOpenEdit(false)} className="rounded-lg border px-4 py-2 font-semibold">Cancel</button><button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Update</button></div>
        </form>
      </ModalDialog>
      <ModalDialog open={openDelete} onClose={() => setOpenDelete(false)} title="Delete Subject">
        <div className="space-y-3 text-xs"><p>Kya aap <b>{deleteRow?.name}</b> ko <b>{deleteRow?.className}</b> se hatana chahte hain?</p><div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setOpenDelete(false)} className="rounded-lg border px-4 py-2 font-semibold">Cancel</button><button type="button" onClick={handleDeleteFromClass} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white">Yes, Remove</button></div></div>
      </ModalDialog>
    </div>
  );
}