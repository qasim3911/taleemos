'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { QuestionPaperBuilder } from '@/components/exams/question-paper-builder';
import { CreateExamMarks } from '@/components/exams/create-exam-marks';
import { computeExamGrade, computeExamPositions } from '@/lib/exams/grading';
import {
  generateClassResultSheetPdf,
  generateReportCardPdf,
} from '@/lib/pdf/generators';
import {
  Award,
  ClipboardEdit,
  Download,
  FileText,
  GraduationCap,
  Plus,
  Trash2,
} from 'lucide-react';

interface ExamRow {
  id: string;
  title: string;
  exam_type: string;
  start_date: string;
  end_date: string;
  is_published: boolean;
}

interface StudentRow {
  id: string;
  admission_number: string;
  roll_number?: string | null;
  student_id?: string | null;
  name_en: string;
  class_id: string | null;
  section_id?: string | null;
}

interface SubjectRow {
  id: string;
  name: string;
  code?: string | null;
}

interface ClassRow {
  id: string;
  name: string;
}

interface SectionRow {
  id: string;
  name: string;
  class_id: string;
}

interface MarkRow {
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

const EXAM_TYPE_OPTIONS = [
  { value: 'Monthly', label: 'Monthly Test' },
  { value: 'Midterm', label: 'Midterm / Term Exam' },
  { value: 'Final', label: 'Final Exam' },
  { value: 'Test', label: 'Class Test / Send-Up' },
];

type ActiveTab = 'papers' | 'marks' | 'exams' | 'results';

export default function ExamsResultsPage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<ActiveTab>('papers');
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [resultClassFilter, setResultClassFilter] = useState<string>('');

  const todayStr = new Date().toISOString().slice(0, 10);
  const [openExamModal, setOpenExamModal] = useState(false);
  const [examForm, setExamForm] = useState({
    title: '',
    exam_type: 'Midterm',
    start_date: todayStr,
    end_date: todayStr,
  });

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/exams', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        const loadedExams: ExamRow[] = data.exams ?? [];
        setExams(loadedExams);
        setStudents(data.students ?? []);
        setSubjects(data.subjects ?? []);
        setClasses(data.classes ?? []);
        setSections(data.sections ?? []);
        setMarks(data.marks ?? []);
        setSelectedExamId((prev) => {
          if (prev && loadedExams.some((e) => e.id === prev)) return prev;
          return loadedExams[0]?.id || '';
        });
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

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const start = examForm.start_date || todayStr;
      const end = examForm.end_date || start;
      const res = await fetch('/api/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_exam',
          title: examForm.title,
          exam_type: examForm.exam_type,
          start_date: start,
          end_date: end,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Error creating exam', description: data.error, variant: 'error' });
        return;
      }
      toast({ title: 'Exam created', variant: 'success' });
      if (data.exam?.id) {
        setSelectedExamId(data.exam.id);
      }
      setOpenExamModal(false);
      setExamForm({ title: '', exam_type: 'Midterm', start_date: todayStr, end_date: todayStr });
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExam = async (exam: ExamRow) => {
    const res = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_exam', exam_id: exam.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: 'Unable to delete exam', description: data.error, variant: 'error' });
      return;
    }
    toast({ title: `Deleted "${exam.title}"`, variant: 'success' });
    await loadData();
  };

  const togglePublish = async (exam: ExamRow) => {
    const next = !exam.is_published;
    const res = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'toggle_publish',
        exam_id: exam.id,
        is_published: next,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ title: 'Update failed', description: data.error, variant: 'error' });
      return;
    }
    toast({
      title: next ? 'Results published to Student App' : 'Results unpublished',
      variant: 'success',
    });
    await loadData();
  };

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);
  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const studentClassMap = useMemo(
    () => new Map(students.map((s) => [s.id, s.class_id ?? null])),
    [students]
  );

  const positionsByExam = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const ex of exams) {
      const exMarks = marks.filter((m) => m.exam_id === ex.id);
      map.set(ex.id, computeExamPositions(exMarks, studentClassMap));
    }
    return map;
  }, [exams, marks, studentClassMap]);

  const activeExam = useMemo(
    () => exams.find((e) => e.id === selectedExamId) || exams[0] || null,
    [exams, selectedExamId]
  );

  const resultRows = useMemo(() => {
    if (!activeExam) return [];
    const examMarks = marks.filter((m) => m.exam_id === activeExam.id);
    const posMap = positionsByExam.get(activeExam.id) ?? new Map<string, string>();

    const byStudent = new Map<string, MarkRow[]>();
    for (const m of examMarks) {
      const stu = studentMap.get(m.student_id);
      if (!stu) continue;
      if (resultClassFilter && stu.class_id !== resultClassFilter) continue;
      const list = byStudent.get(m.student_id) ?? [];
      list.push(m);
      byStudent.set(m.student_id, list);
    }

    return Array.from(byStudent.entries())
      .map(([studentId, stuMarks]) => {
        const stu = studentMap.get(studentId)!;
        const totalMax = stuMarks.reduce((acc, m) => acc + Number(m.total_marks || 0), 0);
        const totalObt = stuMarks.reduce(
          (acc, m) => acc + (m.attendance_status === 'absent' ? 0 : Number(m.obtained_marks || 0)),
          0
        );
        const pct = totalMax > 0 ? (totalObt / totalMax) * 100 : 0;
        const hasFailedSubject = stuMarks.some(
          (m) =>
            m.attendance_status === 'absent' ||
            Number(m.obtained_marks) < Number(m.passing_marks)
        );
        const grade = computeExamGrade(totalObt, totalMax);
        const subjectsSummary = stuMarks
          .map(
            (m) =>
              `${subjectMap.get(m.subject_id) || 'Sub'}: ${
                m.attendance_status === 'absent' ? 'AB' : m.obtained_marks
              }/${m.total_marks}`
          )
          .join(' · ');

        return {
          student: stu,
          stuMarks,
          className: (stu.class_id && classMap.get(stu.class_id)) || '—',
          position: posMap.get(studentId) || '—',
          totalMax,
          totalObt,
          percentage: pct,
          grade: hasFailedSubject && grade !== 'F' ? `${grade} (Supp)` : grade,
          status: (hasFailedSubject ? 'Fail' : 'Pass') as 'Pass' | 'Fail',
          subjectsSummary,
        };
      })
      .sort((a, b) => b.percentage - a.percentage);
  }, [activeExam, marks, positionsByExam, studentMap, resultClassFilter, subjectMap, classMap]);

  const downloadStudentReport = (exam: ExamRow, studentId: string) => {
    const stu = studentMap.get(studentId);
    if (!stu) return;
    const stuMarks = marks.filter((m) => m.exam_id === exam.id && m.student_id === studentId);
    const pos = positionsByExam.get(exam.id)?.get(studentId);
    generateReportCardPdf(
      { nameEn: school.name_en, address: school.address, city: school.city, phone: school.phone },
      {
        examName: exam.title,
        studentName: stu.name_en,
        admissionNo: stu.admission_number,
        className: (stu.class_id && classMap.get(stu.class_id)) || '—',
        position: pos,
        subjects: stuMarks.map((m) => ({
          subjectName: subjectMap.get(m.subject_id) || 'Subject',
          totalMarks: Number(m.total_marks),
          obtainedMarks: m.attendance_status === 'absent' ? 0 : Number(m.obtained_marks),
          grade: m.grade || '—',
          remarks: m.attendance_status === 'absent' ? 'Absent' : m.remarks,
        })),
      }
    );
  };

  const downloadClassGazette = () => {
    if (!activeExam || resultRows.length === 0) return;
    generateClassResultSheetPdf(
      { nameEn: school.name_en, address: school.address, city: school.city, phone: school.phone },
      {
        examTitle: activeExam.title,
        className: resultClassFilter ? classMap.get(resultClassFilter) || 'Class' : 'All Classes',
        rows: resultRows.map((r) => ({
          position: r.position,
          admissionNo: r.student.admission_number,
          studentName: r.student.name_en,
          subjectsSummary: r.subjectsSummary,
          totalMarks: r.totalMax,
          obtainedMarks: r.totalObt,
          percentage: r.percentage,
          grade: r.grade,
          status: r.status,
        })),
      }
    );
  };

  const examColumns: TableColumn<ExamRow>[] = [
    {
      key: 'title',
      header: 'Examination',
      render: (r) => <span className="font-semibold">{r.title}</span>,
      exportValue: (r) => r.title,
    },
    {
      key: 'type',
      header: 'Type',
      render: (r) => r.exam_type,
      exportValue: (r) => r.exam_type,
    },
    {
      key: 'dates',
      header: 'Schedule',
      render: (r) => (
        <span className="font-mono-tabular">
          {r.start_date || 'TBD'} → {r.end_date || 'TBD'}
        </span>
      ),
    },
    {
      key: 'marks_count',
      header: 'Marks Entries',
      render: (r) => (
        <span className="font-mono-tabular">
          {marks.filter((m) => m.exam_id === r.id).length}
        </span>
      ),
    },
    {
      key: 'pub',
      header: 'Student App Visibility',
      render: (r) =>
        r.is_published ? (
          <span className="rounded bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            Published
          </span>
        ) : (
          <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-300">
            Draft
          </span>
        ),
      exportValue: (r) => (r.is_published ? 'Published' : 'Draft'),
    },
    {
      key: 'act',
      header: 'Actions',
      align: 'right',
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <button
            type="button"
            onClick={() => {
              setSelectedExamId(r.id);
              setActiveTab('papers');
            }}
            className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Question Paper
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedExamId(r.id);
              setActiveTab('marks');
            }}
            className="rounded border border-teal-700 px-2.5 py-1 text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/30"
          >
            Create Marks
          </button>
          <button
            type="button"
            onClick={() => togglePublish(r)}
            className={`rounded px-2.5 py-1 text-[11px] font-semibold text-white ${
              r.is_published ? 'bg-amber-600' : 'bg-teal-700'
            }`}
          >
            {r.is_published ? 'Unpublish' : 'Publish'}
          </button>
          <button
            type="button"
            onClick={() => void handleDeleteExam(r)}
            title="Delete exam"
            className="rounded border border-red-200 dark:border-red-900/50 p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ];

  const handleSubjectCreated = (newSub: SubjectRow) => {
    setSubjects((prev) => {
      if (prev.some((s) => s.id === newSub.id)) return prev;
      return [...prev, newSub].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 p-1 border border-slate-200 dark:border-slate-800">
          {[
            { id: 'papers', label: 'Question Paper Builder', icon: FileText },
            { id: 'marks', label: 'Create Exam Marks', icon: ClipboardEdit },
            { id: 'results', label: 'Results & Report Cards', icon: Award },
            { id: 'exams', label: `Exams & Tests (${exams.length})`, icon: GraduationCap },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-teal-700 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setOpenExamModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-2 text-xs font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          New Exam / Test
        </button>
      </div>

      {activeTab === 'papers' && (
        <QuestionPaperBuilder
          exams={exams}
          classes={classes}
          sections={sections}
          subjects={subjects}
          onSubjectCreated={handleSubjectCreated}
          defaultExamId={selectedExamId}
        />
      )}

      {activeTab === 'marks' && (
        <CreateExamMarks
          exams={exams}
          students={students}
          subjects={subjects}
          classes={classes}
          sections={sections}
          marks={marks}
          selectedExamId={selectedExamId}
          onSelectExamId={setSelectedExamId}
          onRefresh={loadData}
          onOpenNewExam={() => setOpenExamModal(true)}
          onSubjectCreated={handleSubjectCreated}
        />
      )}

      {activeTab === 'exams' && (
        <DataTable
          title="Examinations & Tests"
          subtitle="Create tests or term exams, jump directly to Question Paper Builder or Create Marks, and publish results to Student Portal."
          rows={exams}
          columns={examColumns}
          loading={loading}
          getRowKey={(r) => r.id}
          getSearchText={(r) => `${r.title} ${r.exam_type}`}
          exportFileName="examinations"
          primaryAction={
            <button
              type="button"
              onClick={() => setOpenExamModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              New Exam
            </button>
          }
        />
      )}

      {activeTab === 'results' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3 text-xs">
              <div>
                <label className="block font-medium">Select Exam / Test</label>
                <select
                  value={activeExam?.id || ''}
                  onChange={(e) => setSelectedExamId(e.target.value)}
                  className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  {exams.length === 0 && <option value="">No exams available</option>}
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
                  value={resultClassFilter}
                  onChange={(e) => setResultClassFilter(e.target.value)}
                  className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="">All Classes</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeExam && (
                <button
                  type="button"
                  onClick={() => togglePublish(activeExam)}
                  className={`rounded-lg px-3.5 py-2 text-xs font-semibold text-white ${
                    activeExam.is_published ? 'bg-amber-600' : 'bg-teal-700'
                  }`}
                >
                  {activeExam.is_published ? 'Unpublish from Student App' : 'Publish Results to Student App'}
                </button>
              )}
              <button
                type="button"
                disabled={resultRows.length === 0}
                onClick={downloadClassGazette}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Class Result Sheet PDF
              </button>
            </div>
          </div>

          {resultRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center space-y-3 text-xs">
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                No exam marks recorded for this selection yet
              </p>
              <p className="text-slate-500">
                Go to &ldquo;Create Exam Marks&rdquo; to enter marks for students and generate report cards automatically.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('marks')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white"
              >
                <ClipboardEdit className="h-3.5 w-3.5" />
                Go to Create Exam Marks
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Position</th>
                      <th className="px-4 py-3 font-semibold">Student</th>
                      <th className="px-4 py-3 font-semibold">Class</th>
                      <th className="px-4 py-3 font-semibold">Subject Marks</th>
                      <th className="px-4 py-3 font-semibold">Total</th>
                      <th className="px-4 py-3 font-semibold">% / Grade</th>
                      <th className="px-4 py-3 font-semibold">Result</th>
                      <th className="px-4 py-3 text-right font-semibold">Report Card</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {resultRows.map((row) => (
                      <tr
                        key={row.student.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                      >
                        <td className="px-4 py-3 font-mono-tabular font-bold text-teal-700 dark:text-teal-400">
                          {row.position}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {row.student.name_en}
                          </p>
                          <p className="font-mono-tabular text-[11px] text-slate-500">
                            {row.student.admission_number}
                          </p>
                        </td>
                        <td className="px-4 py-3">{row.className}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-md">
                          {row.subjectsSummary}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular whitespace-nowrap">
                          <strong>{row.totalObt}</strong> / {row.totalMax}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular whitespace-nowrap">
                          {row.percentage.toFixed(1)}% · <strong>{row.grade}</strong>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${
                              row.status === 'Pass'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {activeExam && (
                            <button
                              type="button"
                              onClick={() => downloadStudentReport(activeExam, row.student.id)}
                              className="inline-flex items-center gap-1 rounded bg-slate-900 dark:bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-white"
                            >
                              <Download className="h-3 w-3" />
                              Report PDF
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <ModalDialog
        open={openExamModal}
        onClose={() => setOpenExamModal(false)}
        title="Create Examination / Test"
      >
        <form onSubmit={handleCreateExam} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Exam / Test Title *</label>
            <input
              required
              value={examForm.title}
              onChange={(e) => setExamForm({ ...examForm, title: e.target.value })}
              placeholder="First Term Examination 2026"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">Exam Type</label>
            <select
              value={examForm.exam_type}
              onChange={(e) => setExamForm({ ...examForm, exam_type: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              {EXAM_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
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
                value={examForm.start_date}
                onChange={(e) => setExamForm({ ...examForm, start_date: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium">End Date *</label>
              <input
                type="date"
                required
                value={examForm.end_date}
                onChange={(e) => setExamForm({ ...examForm, end_date: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpenExamModal(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Exam'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
