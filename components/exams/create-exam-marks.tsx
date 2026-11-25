'use client';

import React, { useMemo, useState } from 'react';
import { useToast } from '@/components/providers/toast-provider';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { computeExamGrade } from '@/lib/exams/grading';
import {
  CheckCircle2,
  ClipboardEdit,
  Plus,
  Save,
  Search,
  Trash2,
  Users,
} from 'lucide-react';

interface ExamItem {
  id: string;
  title: string;
  exam_type: string;
  start_date: string;
  end_date: string;
  is_published: boolean;
}

interface StudentItem {
  id: string;
  admission_number: string;
  roll_number?: string | null;
  student_id?: string | null;
  name_en: string;
  class_id: string | null;
  section_id?: string | null;
}

interface SubjectItem {
  id: string;
  name: string;
  code?: string | null;
}

interface ClassItem {
  id: string;
  name: string;
}

interface SectionItem {
  id: string;
  name: string;
  class_id: string;
}

interface MarkItem {
  id: string;
  exam_id: string;
  student_id: string;
  subject_id: string;
  total_marks: number;
  obtained_marks: number;
  passing_marks: number;
  attendance_status: string;
  grade: string | null;
  remarks: string | null;
}

interface BulkRowDraft {
  obtained_marks: string;
  attendance_status: 'present' | 'absent';
  remarks: string;
}

interface CreateExamMarksProps {
  exams: ExamItem[];
  students: StudentItem[];
  subjects: SubjectItem[];
  classes: ClassItem[];
  sections: SectionItem[];
  marks: MarkItem[];
  selectedExamId: string;
  onSelectExamId: (examId: string) => void;
  onRefresh: () => void | Promise<void>;
  onOpenNewExam: () => void;
  onSubjectCreated: (sub: SubjectItem) => void;
}

export function CreateExamMarks({
  exams,
  students,
  subjects,
  classes,
  sections,
  marks,
  selectedExamId,
  onSelectExamId,
  onRefresh,
  onOpenNewExam,
  onSubjectCreated,
}: CreateExamMarksProps) {
  const { toast } = useToast();

  const [entryMode, setEntryMode] = useState<'bulk' | 'single'>('bulk');
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(() => subjects[0]?.id || '');
  const [totalMarksOverride, setTotalMarksOverride] = useState<string | null>(null);
  const [passingMarksOverride, setPassingMarksOverride] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  const [draftOverrides, setDraftOverrides] = useState<Record<string, BulkRowDraft>>({});

  const [singleForm, setSingleForm] = useState({
    student_id: students[0]?.id || '',
    subject_id: subjects[0]?.id || '',
    total_marks: '100',
    passing_marks: '33',
    obtained_marks: '',
    attendance_status: 'present' as 'present' | 'absent',
    remarks: '',
  });

  const [openAddSubject, setOpenAddSubject] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubCode, setNewSubCode] = useState('');
  const [addingSubject, setAddingSubject] = useState(false);

  const effectiveSubjectId = selectedSubjectId || subjects[0]?.id || '';
  const effectiveSingleSubjectId = singleForm.subject_id || subjects[0]?.id || '';
  const effectiveSingleStudentId = singleForm.student_id || students[0]?.id || '';

  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);
  const sectionMap = useMemo(() => new Map(sections.map((s) => [s.id, s.name])), [sections]);
  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);
  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const classSections = useMemo(
    () => sections.filter((s) => !selectedClassId || s.class_id === selectedClassId),
    [sections, selectedClassId]
  );

  const filteredStudents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return students.filter((s) => {
      if (selectedClassId && s.class_id !== selectedClassId) return false;
      if (selectedSectionId && s.section_id !== selectedSectionId) return false;
      if (!q) return true;
      return `${s.name_en} ${s.admission_number} ${s.roll_number || ''} ${s.student_id || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [students, selectedClassId, selectedSectionId, searchTerm]);

  const existingSubjectMarksMap = useMemo(() => {
    const map = new Map<string, MarkItem>();
    for (const m of marks) {
      if (m.exam_id === selectedExamId && m.subject_id === effectiveSubjectId) {
        map.set(m.student_id, m);
      }
    }
    return map;
  }, [marks, selectedExamId, effectiveSubjectId]);

  const detectedExistingTotals = useMemo(() => {
    const firstExisting = marks.find(
      (m) => m.exam_id === selectedExamId && m.subject_id === effectiveSubjectId
    );
    if (firstExisting) {
      const total = Number(firstExisting.total_marks) || 100;
      const passing =
        firstExisting.passing_marks !== null && firstExisting.passing_marks !== undefined
          ? Number(firstExisting.passing_marks)
          : Math.round(total * 0.33);
      return { total: String(total), passing: String(passing) };
    }
    return { total: '100', passing: '33' };
  }, [marks, selectedExamId, effectiveSubjectId]);

  const totalMarks = totalMarksOverride ?? detectedExistingTotals.total;
  const passingMarks = passingMarksOverride ?? detectedExistingTotals.passing;

  const drafts = useMemo(() => {
    const result: Record<string, BulkRowDraft> = {};
    for (const stu of students) {
      const key = `${selectedExamId}::${effectiveSubjectId}::${stu.id}`;
      const override = draftOverrides[key];
      if (override) {
        result[stu.id] = override;
      } else {
        const existing = existingSubjectMarksMap.get(stu.id);
        result[stu.id] = existing
          ? {
              obtained_marks:
                existing.attendance_status === 'absent' ? '0' : String(existing.obtained_marks),
              attendance_status: existing.attendance_status === 'absent' ? 'absent' : 'present',
              remarks: existing.remarks || '',
            }
          : {
              obtained_marks: '',
              attendance_status: 'present',
              remarks: '',
            };
      }
    }
    return result;
  }, [students, selectedExamId, effectiveSubjectId, draftOverrides, existingSubjectMarksMap]);

  const numericTotal = Math.max(1, Number(totalMarks) || 100);
  const numericPassing =
    passingMarks.trim() === ''
      ? Math.round(numericTotal * 0.33)
      : Math.min(numericTotal, Math.max(0, Number(passingMarks) || 0));

  const sheetSummary = useMemo(() => {
    let entered = 0;
    let passed = 0;
    let failed = 0;
    let absent = 0;
    let sumPct = 0;

    for (const stu of filteredStudents) {
      const d = drafts[stu.id];
      if (!d) continue;
      if (d.attendance_status === 'absent') {
        entered++;
        absent++;
        failed++;
        continue;
      }
      if (d.obtained_marks.trim() !== '') {
        const obt = Number(d.obtained_marks);
        if (Number.isFinite(obt)) {
          entered++;
          sumPct += (obt / numericTotal) * 100;
          if (obt >= numericPassing) passed++;
          else failed++;
        }
      }
    }

    return {
      totalStudents: filteredStudents.length,
      entered,
      passed,
      failed,
      absent,
      avgPct: entered > 0 ? (sumPct / entered).toFixed(1) : '0.0',
    };
  }, [filteredStudents, drafts, numericTotal, numericPassing]);

  const updateDraft = (studentId: string, patch: Partial<BulkRowDraft>) => {
    const key = `${selectedExamId}::${effectiveSubjectId}::${studentId}`;
    setDraftOverrides((prev) => ({
      ...prev,
      [key]: {
        ...(drafts[studentId] ?? { obtained_marks: '', attendance_status: 'present', remarks: '' }),
        ...patch,
      },
    }));
  };

  const handleBulkSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExamId) {
      toast({ title: 'Select an Exam first', variant: 'error' });
      return;
    }
    if (!effectiveSubjectId) {
      toast({ title: 'Select a Subject first', variant: 'error' });
      return;
    }

    const rowsToSave: Array<{
      student_id: string;
      obtained_marks: number;
      attendance_status: 'present' | 'absent';
      remarks: string | null;
    }> = [];

    for (const stu of filteredStudents) {
      const d = drafts[stu.id];
      if (!d) continue;
      if (d.attendance_status === 'absent') {
        rowsToSave.push({
          student_id: stu.id,
          obtained_marks: 0,
          attendance_status: 'absent',
          remarks: d.remarks.trim() || null,
        });
      } else if (d.obtained_marks.trim() !== '') {
        const obt = Number(d.obtained_marks);
        if (!Number.isFinite(obt) || obt < 0) {
          toast({
            title: 'Invalid marks',
            description: `Check obtained marks for ${stu.name_en}.`,
            variant: 'error',
          });
          return;
        }
        if (obt > numericTotal) {
          toast({
            title: 'Marks exceed Total Marks',
            description: `${stu.name_en}: ${obt} cannot be greater than ${numericTotal}.`,
            variant: 'error',
          });
          return;
        }
        rowsToSave.push({
          student_id: stu.id,
          obtained_marks: obt,
          attendance_status: 'present',
          remarks: d.remarks.trim() || null,
        });
      }
    }

    if (rowsToSave.length === 0) {
      toast({
        title: 'No marks entered',
        description: 'Enter obtained marks (or mark Absent) for at least one student.',
        variant: 'error',
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_save_marks',
          exam_id: selectedExamId,
          subject_id: effectiveSubjectId,
          total_marks: numericTotal,
          passing_marks: numericPassing,
          rows: rowsToSave,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to save exam marks', description: data.error, variant: 'error' });
        return;
      }
      toast({
        title: `Saved marks for ${data.savedCount ?? rowsToSave.length} student(s)`,
        description: 'Report cards and exam results updated.',
        variant: 'success',
      });
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleSingleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExamId) {
      toast({ title: 'Select an Exam first', variant: 'error' });
      return;
    }
    const maxM = Math.max(1, Number(singleForm.total_marks) || 100);
    const passM =
      singleForm.passing_marks.trim() === ''
        ? Math.round(maxM * 0.33)
        : Math.min(maxM, Math.max(0, Number(singleForm.passing_marks) || 0));
    const obtM =
      singleForm.attendance_status === 'absent' ? 0 : Number(singleForm.obtained_marks);

    if (singleForm.attendance_status === 'present' && obtM > maxM) {
      toast({
        title: 'Invalid marks',
        description: `Obtained marks (${obtM}) cannot exceed total marks (${maxM}).`,
        variant: 'error',
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_marks',
          exam_id: selectedExamId,
          student_id: effectiveSingleStudentId,
          subject_id: effectiveSingleSubjectId,
          total_marks: maxM,
          passing_marks: passM,
          obtained_marks: obtM,
          attendance_status: singleForm.attendance_status,
          remarks: singleForm.remarks.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to save mark', description: data.error, variant: 'error' });
        return;
      }
      toast({ title: 'Exam marks saved', variant: 'success' });
      setSingleForm((prev) => ({ ...prev, obtained_marks: '', remarks: '' }));
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMark = async (markId: string) => {
    const res = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_mark', mark_id: markId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: 'Delete failed', description: data.error, variant: 'error' });
      return;
    }
    toast({ title: 'Mark record removed', variant: 'success' });
    await onRefresh();
  };

  const handleQuickAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName.trim()) return;
    setAddingSubject(true);
    try {
      const res = await fetch('/api/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'quick_create_subject',
          name: newSubName.trim(),
          code: newSubCode.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.subject) {
        toast({ title: 'Unable to create subject', description: data.error, variant: 'error' });
        return;
      }
      onSubjectCreated(data.subject);
      setSelectedSubjectId(data.subject.id);
      setSingleForm((prev) => ({ ...prev, subject_id: data.subject.id }));
      setNewSubName('');
      setNewSubCode('');
      setOpenAddSubject(false);
      toast({ title: `Subject "${data.subject.name}" added`, variant: 'success' });
    } finally {
      setAddingSubject(false);
    }
  };

  const examMarksLedger = useMemo(() => {
    return marks.filter((m) => {
      if (selectedExamId && m.exam_id !== selectedExamId) return false;
      const stu = studentMap.get(m.student_id);
      if (selectedClassId && stu?.class_id !== selectedClassId) return false;
      if (selectedSectionId && stu?.section_id !== selectedSectionId) return false;
      return true;
    });
  }, [marks, selectedExamId, selectedClassId, selectedSectionId, studentMap]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ClipboardEdit className="h-4 w-4 text-teal-700 dark:text-teal-400" />
            Create Exam Marks & Result Entry
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Enter marks for an entire class at once or record individual student subject marks with auto-grade & Pass/Fail calculation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 p-0.5">
            <button
              type="button"
              onClick={() => setEntryMode('bulk')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                entryMode === 'bulk'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Class Marks Sheet
            </button>
            <button
              type="button"
              onClick={() => setEntryMode('single')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                entryMode === 'single'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              Single Student Entry
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 text-xs">
          <div>
            <div className="flex items-center justify-between">
              <label className="block font-medium">Exam / Test *</label>
              <button
                type="button"
                onClick={onOpenNewExam}
                className="text-[11px] font-semibold text-teal-700 hover:underline dark:text-teal-400"
              >
                + New Exam
              </button>
            </div>
            <select
              value={selectedExamId}
              onChange={(e) => {
                setTotalMarksOverride(null);
                setPassingMarksOverride(null);
                onSelectExamId(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              {exams.length === 0 && <option value="">No exams created yet</option>}
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title} ({ex.exam_type})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium">Filter Class</label>
            <select
              value={selectedClassId}
              onChange={(e) => {
                setSelectedClassId(e.target.value);
                setSelectedSectionId('');
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="">All Classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium">Filter Section</label>
            <select
              value={selectedSectionId}
              onChange={(e) => setSelectedSectionId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="">All Sections</option>
              {classSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {entryMode === 'bulk' && (
            <>
              <div>
                <div className="flex items-center justify-between">
                  <label className="block font-medium">Subject *</label>
                  <button
                    type="button"
                    onClick={() => setOpenAddSubject(true)}
                    className="text-[11px] font-semibold text-teal-700 hover:underline dark:text-teal-400"
                  >
                    + Add Subject
                  </button>
                </div>
                <select
                  value={effectiveSubjectId}
                  onChange={(e) => {
                    setTotalMarksOverride(null);
                    setPassingMarksOverride(null);
                    setSelectedSubjectId(e.target.value);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  {subjects.length === 0 && <option value="">No subjects yet</option>}
                  {subjects.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium">Total *</label>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={totalMarks}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTotalMarksOverride(val);
                      const num = Number(val);
                      if (Number.isFinite(num) && num > 0) {
                        setPassingMarksOverride(String(Math.round(num * 0.33)));
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-sm font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block font-medium">Passing</label>
                  <input
                    type="number"
                    min={0}
                    max={numericTotal}
                    value={passingMarks}
                    onChange={(e) => setPassingMarksOverride(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-sm font-mono-tabular"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {exams.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs space-y-2">
            <p className="text-slate-600 dark:text-slate-300">
              Create an Exam or Test first before entering student marks.
            </p>
            <button
              type="button"
              onClick={onOpenNewExam}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Create First Exam
            </button>
          </div>
        ) : subjects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs space-y-2">
            <p className="text-slate-600 dark:text-slate-300">
              No subjects found for this school. Add a subject to start entering marks.
            </p>
            <button
              type="button"
              onClick={() => setOpenAddSubject(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Subject
            </button>
          </div>
        ) : entryMode === 'bulk' ? (
          <form onSubmit={handleBulkSave} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search student name, Adm No, Roll No..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 py-1.5 pl-9 pr-3 text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2.5 py-1 font-mono-tabular">
                  Entered: <strong>{sheetSummary.entered}</strong> / {sheetSummary.totalStudents}
                </span>
                <span className="rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 font-mono-tabular">
                  Pass: <strong>{sheetSummary.passed}</strong>
                </span>
                <span className="rounded-md bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 px-2.5 py-1 font-mono-tabular">
                  Fail: <strong>{sheetSummary.failed}</strong>
                </span>
                <span className="rounded-md bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 px-2.5 py-1 font-mono-tabular">
                  Avg: <strong>{sheetSummary.avgPct}%</strong>
                </span>
              </div>
            </div>

            {filteredStudents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-500">
                No active students match the selected class/section filter.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Adm / Roll</th>
                      <th className="px-3 py-2.5 font-semibold">Student Name</th>
                      <th className="px-3 py-2.5 font-semibold">Class</th>
                      <th className="px-3 py-2.5 font-semibold">Attendance</th>
                      <th className="px-3 py-2.5 font-semibold">Obtained / {numericTotal}</th>
                      <th className="px-3 py-2.5 font-semibold">% & Grade</th>
                      <th className="px-3 py-2.5 font-semibold">Status</th>
                      <th className="px-3 py-2.5 font-semibold">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredStudents.map((stu) => {
                      const d = drafts[stu.id] ?? {
                        obtained_marks: '',
                        attendance_status: 'present' as const,
                        remarks: '',
                      };
                      const isAbsent = d.attendance_status === 'absent';
                      const hasNum = !isAbsent && d.obtained_marks.trim() !== '';
                      const obtVal = hasNum ? Number(d.obtained_marks) : 0;
                      const pct = hasNum ? (obtVal / numericTotal) * 100 : 0;
                      const grade = isAbsent
                        ? 'F'
                        : hasNum
                          ? computeExamGrade(obtVal, numericTotal)
                          : '—';
                      const isPass = !isAbsent && hasNum && obtVal >= numericPassing;
                      const isExisting = existingSubjectMarksMap.has(stu.id);

                      return (
                        <tr
                          key={stu.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                        >
                          <td className="px-3 py-2 font-mono-tabular whitespace-nowrap">
                            <p className="font-semibold text-slate-900 dark:text-white">
                              {stu.admission_number}
                            </p>
                            {stu.roll_number && (
                              <p className="text-[10px] text-slate-500">Roll: {stu.roll_number}</p>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-900 dark:text-white">
                                {stu.name_en}
                              </span>
                              {isExisting && (
                                <span className="rounded bg-teal-50 dark:bg-teal-950/60 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-300">
                                  Saved
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {(stu.class_id && classMap.get(stu.class_id)) || '—'}
                            {stu.section_id && sectionMap.get(stu.section_id)
                              ? ` (${sectionMap.get(stu.section_id)})`
                              : ''}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={d.attendance_status}
                              onChange={(e) => {
                                const nextStatus = e.target.value as 'present' | 'absent';
                                updateDraft(stu.id, {
                                  attendance_status: nextStatus,
                                  obtained_marks: nextStatus === 'absent' ? '0' : d.obtained_marks,
                                });
                              }}
                              className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs"
                            >
                              <option value="present">Present</option>
                              <option value="absent">Absent</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              max={numericTotal}
                              step={0.5}
                              disabled={isAbsent}
                              value={isAbsent ? '0' : d.obtained_marks}
                              onChange={(e) =>
                                updateDraft(stu.id, { obtained_marks: e.target.value })
                              }
                              placeholder={`0 - ${numericTotal}`}
                              className="w-24 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono-tabular disabled:opacity-50"
                            />
                          </td>
                          <td className="px-3 py-2 font-mono-tabular whitespace-nowrap">
                            {isAbsent ? (
                              <span className="text-red-600 font-semibold">0.0% · F</span>
                            ) : hasNum ? (
                              <span>
                                {pct.toFixed(1)}% · <strong>{grade}</strong>
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {isAbsent ? (
                              <span className="inline-block rounded bg-red-50 dark:bg-red-950/60 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                                Absent (Fail)
                              </span>
                            ) : !hasNum ? (
                              <span className="text-[11px] text-slate-400">Pending</span>
                            ) : isPass ? (
                              <span className="inline-block rounded bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                Pass
                              </span>
                            ) : (
                              <span className="inline-block rounded bg-red-50 dark:bg-red-950/60 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                                Fail
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={d.remarks}
                              onChange={(e) => updateDraft(stu.id, { remarks: e.target.value })}
                              placeholder="Optional note"
                              className="w-36 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-slate-500">
                Leave a student&apos;s marks blank to skip them, or type marks and click Save All Marks.
              </p>
              <button
                type="submit"
                disabled={saving || filteredStudents.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving Marks...' : 'Save All Class Marks'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSingleSave} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs pt-2">
            <div>
              <label className="block font-medium">Student *</label>
              <select
                required
                value={effectiveSingleStudentId}
                onChange={(e) => setSingleForm({ ...singleForm, student_id: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                {filteredStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name_en} ({s.admission_number})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="block font-medium">Subject *</label>
                <button
                  type="button"
                  onClick={() => setOpenAddSubject(true)}
                  className="text-[11px] font-semibold text-teal-700 hover:underline dark:text-teal-400"
                >
                  + Add Subject
                </button>
              </div>
              <select
                required
                value={effectiveSingleSubjectId}
                onChange={(e) => setSingleForm({ ...singleForm, subject_id: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                {subjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium">Attendance</label>
              <select
                value={singleForm.attendance_status}
                onChange={(e) =>
                  setSingleForm({
                    ...singleForm,
                    attendance_status: e.target.value as 'present' | 'absent',
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="present">Present</option>
                <option value="absent">Absent</option>
              </select>
            </div>
            <div>
              <label className="block font-medium">Total Marks *</label>
              <input
                type="number"
                min={1}
                required
                value={singleForm.total_marks}
                onChange={(e) => {
                  const val = e.target.value;
                  const num = Number(val);
                  setSingleForm({
                    ...singleForm,
                    total_marks: val,
                    passing_marks:
                      Number.isFinite(num) && num > 0
                        ? String(Math.round(num * 0.33))
                        : singleForm.passing_marks,
                  });
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block font-medium">Passing Marks</label>
              <input
                type="number"
                min={0}
                value={singleForm.passing_marks}
                onChange={(e) => setSingleForm({ ...singleForm, passing_marks: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block font-medium">Obtained Marks *</label>
              <input
                type="number"
                min={0}
                step={0.5}
                max={Number(singleForm.total_marks) || undefined}
                required={singleForm.attendance_status === 'present'}
                disabled={singleForm.attendance_status === 'absent'}
                value={singleForm.attendance_status === 'absent' ? '0' : singleForm.obtained_marks}
                onChange={(e) => setSingleForm({ ...singleForm, obtained_marks: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular disabled:opacity-60"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium">Remarks</label>
              <input
                value={singleForm.remarks}
                onChange={(e) => setSingleForm({ ...singleForm, remarks: e.target.value })}
                placeholder="e.g. Good handwriting / Needs improvement"
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save Student Mark'}
              </button>
            </div>
          </form>
        )}
      </div>

      {examMarksLedger.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-bold">
              Recorded Marks Ledger ({examMarksLedger.length})
            </h3>
            <span className="text-[11px] text-slate-500">
              Remove an erroneous mark entry if needed
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Student</th>
                  <th className="px-3 py-2 font-semibold">Subject</th>
                  <th className="px-3 py-2 font-semibold">Marks</th>
                  <th className="px-3 py-2 font-semibold">Grade</th>
                  <th className="px-3 py-2 font-semibold">Remarks</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {examMarksLedger.map((m) => {
                  const stu = studentMap.get(m.student_id);
                  const subName = subjectMap.get(m.subject_id) || 'Subject';
                  const isPass =
                    m.attendance_status !== 'absent' &&
                    Number(m.obtained_marks) >= Number(m.passing_marks);
                  return (
                    <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2">
                        <span className="font-semibold">{stu?.name_en || 'Student'}</span>{' '}
                        <span className="font-mono-tabular text-[11px] text-slate-500">
                          ({stu?.admission_number || '—'})
                        </span>
                      </td>
                      <td className="px-3 py-2 font-medium">{subName}</td>
                      <td className="px-3 py-2 font-mono-tabular">
                        {m.attendance_status === 'absent' ? (
                          <span className="text-red-600 font-semibold">Absent</span>
                        ) : (
                          `${m.obtained_marks} / ${m.total_marks}`
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${
                            isPass
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                          }`}
                        >
                          {m.grade || '—'} · {isPass ? 'Pass' : 'Fail'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{m.remarks || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void handleDeleteMark(m.id)}
                          title="Delete mark"
                          className="rounded border border-red-200 dark:border-red-900/50 p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ModalDialog
        open={openAddSubject}
        onClose={() => setOpenAddSubject(false)}
        title="Add New Subject"
      >
        <form onSubmit={handleQuickAddSubject} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Subject Name *</label>
            <input
              required
              value={newSubName}
              onChange={(e) => setNewSubName(e.target.value)}
              placeholder="e.g. English, Mathematics, Science, Islamiat"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">Subject Code (Optional)</label>
            <input
              value={newSubCode}
              onChange={(e) => setNewSubCode(e.target.value)}
              placeholder="e.g. ENG-101"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpenAddSubject(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addingSubject}
              className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {addingSubject ? 'Adding...' : 'Add Subject'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
