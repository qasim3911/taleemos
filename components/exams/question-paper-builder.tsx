'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { useToast } from '@/components/providers/toast-provider';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { generateQuestionPaperPdf } from '@/lib/pdf/generators';
import type {
  PaperQuestion,
  PaperSection,
  QuestionPaperRecord,
  QuestionType,
} from '@/lib/exams/question-papers';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileText,
  KeyRound,
  LayoutTemplate,
  Plus,
  Printer,
  Save,
  Search,
  Trash2,
} from 'lucide-react';

interface ExamOption {
  id: string;
  title: string;
  exam_type: string;
  start_date: string;
}

interface ClassOption {
  id: string;
  name: string;
}

interface SectionOption {
  id: string;
  name: string;
  class_id: string;
}

interface SubjectOption {
  id: string;
  name: string;
  code?: string | null;
}

interface QuestionPaperBuilderProps {
  exams: ExamOption[];
  classes: ClassOption[];
  sections: SectionOption[];
  subjects: SubjectOption[];
  onSubjectCreated: (sub: SubjectOption) => void;
  defaultExamId?: string;
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'MCQ',
  short: 'Short Q',
  long: 'Long Q',
  fill_blank: 'Fill Blank',
  true_false: 'True / False',
};

function makeLocalId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyQuestion(type: QuestionType, isRtl = false): PaperQuestion {
  const base: PaperQuestion = {
    id: makeLocalId(),
    type,
    prompt: '',
    marks: type === 'mcq' || type === 'fill_blank' || type === 'true_false' ? 1 : type === 'short' ? 2 : 5,
    isRtl,
  };
  if (type === 'mcq') {
    base.options = ['', '', '', ''];
    base.correctAnswer = 'A';
  } else if (type === 'true_false') {
    base.correctAnswer = 'True';
  } else {
    base.correctAnswer = '';
  }
  return base;
}

function createDefaultSections(isRtl = false): PaperSection[] {
  return [
    {
      id: makeLocalId(),
      title: 'Section A — Objective (Multiple Choice Questions)',
      instructions: 'Encircle or tick the correct option. Each question carries equal marks.',
      questions: [createEmptyQuestion('mcq', isRtl)],
    },
    {
      id: makeLocalId(),
      title: 'Section B — Short Answer Questions',
      instructions: 'Answer the following short questions briefly.',
      questions: [createEmptyQuestion('short', isRtl)],
    },
    {
      id: makeLocalId(),
      title: 'Section C — Long / Descriptive Questions',
      instructions: 'Attempt the detailed questions below.',
      questions: [createEmptyQuestion('long', isRtl)],
    },
  ];
}

interface DraftPaperForm {
  id?: string;
  exam_id: string;
  class_id: string;
  section_id: string;
  subject_id: string;
  title: string;
  paper_code: string;
  paper_type: 'Test' | 'Quiz' | 'Monthly' | 'Midterm' | 'Final' | 'Exam';
  exam_date: string;
  time_allowed: string;
  passing_marks: string;
  academic_session: string;
  instructions: string;
  language: 'en' | 'ur' | 'bilingual';
  show_student_info_box: boolean;
  show_answer_lines: boolean;
  status: 'draft' | 'finalized';
  sections: PaperSection[];
}

export function QuestionPaperBuilder({
  exams,
  classes,
  sections,
  subjects,
  onSubjectCreated,
  defaultExamId,
}: QuestionPaperBuilderProps) {
  const { school } = useSchool();
  const { toast } = useToast();

  const todayStr = new Date().toISOString().slice(0, 10);

  const buildFreshForm = useCallback(
    (useStarterLayout = false): DraftPaperForm => ({
      id: undefined,
      exam_id: defaultExamId || exams[0]?.id || '',
      class_id: classes[0]?.id || '',
      section_id: '',
      subject_id: subjects[0]?.id || '',
      title: '',
      paper_code: '',
      paper_type: 'Exam',
      exam_date: todayStr,
      time_allowed: '1 Hour 30 Mins',
      passing_marks: '',
      academic_session: '',
      instructions: 'Attempt all questions carefully. Cutting or overwriting is not allowed in objective questions.',
      language: 'en',
      show_student_info_box: true,
      show_answer_lines: false,
      status: 'draft',
      sections: useStarterLayout
        ? createDefaultSections(false)
        : [
            {
              id: makeLocalId(),
              title: 'Section A — Questions',
              instructions: 'Attempt all questions.',
              questions: [createEmptyQuestion('short', false)],
            },
          ],
    }),
    [classes, defaultExamId, exams, subjects, todayStr]
  );

  const [papers, setPapers] = useState<QuestionPaperRecord[]>([]);
  const [loadingPapers, setLoadingPapers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'library' | 'editor'>('library');
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewAnswerKey, setPreviewAnswerKey] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterClassId, setFilterClassId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');

  const [form, setForm] = useState<DraftPaperForm>(() => buildFreshForm(true));

  const [openAddSubject, setOpenAddSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectCode, setNewSubjectCode] = useState('');
  const [addingSubject, setAddingSubject] = useState(false);

  const loadPapers = useCallback(async () => {
    setLoadingPapers(true);
    try {
      const res = await fetch('/api/exams/question-papers', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPapers(data.papers ?? []);
      }
    } finally {
      setLoadingPapers(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadPapers();
    });
  }, [loadPapers]);

  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);
  const sectionMap = useMemo(() => new Map(sections.map((s) => [s.id, s.name])), [sections]);
  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);
  const examMap = useMemo(() => new Map(exams.map((e) => [e.id, e.title])), [exams]);

  const computedTotalMarks = useMemo(() => {
    let sum = 0;
    for (const sec of form.sections) {
      for (const q of sec.questions) {
        sum += Number(q.marks) || 0;
      }
    }
    return Math.round(sum * 100) / 100;
  }, [form.sections]);

  const totalQuestionCount = useMemo(
    () => form.sections.reduce((acc, s) => acc + s.questions.length, 0),
    [form.sections]
  );

  const filteredSections = useMemo(
    () => sections.filter((s) => !form.class_id || s.class_id === form.class_id),
    [sections, form.class_id]
  );

  const filteredPapers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return papers.filter((p) => {
      if (filterClassId && p.class_id !== filterClassId) return false;
      if (filterSubjectId && p.subject_id !== filterSubjectId) return false;
      if (!q) return true;
      const cls = p.class_id ? classMap.get(p.class_id) || '' : '';
      const sub = p.subject_id ? subjectMap.get(p.subject_id) || '' : '';
      return `${p.title} ${p.paper_code || ''} ${p.paper_type} ${cls} ${sub}`
        .toLowerCase()
        .includes(q);
    });
  }, [papers, filterClassId, filterSubjectId, searchQuery, classMap, subjectMap]);

  const openNewPaper = (starterLayout: boolean) => {
    setForm(buildFreshForm(starterLayout));
    setViewMode('editor');
  };

  const openEditPaper = (paper: QuestionPaperRecord) => {
    setForm({
      id: paper.id,
      exam_id: paper.exam_id || '',
      class_id: paper.class_id || '',
      section_id: paper.section_id || '',
      subject_id: paper.subject_id || '',
      title: paper.title,
      paper_code: paper.paper_code || '',
      paper_type: paper.paper_type,
      exam_date: paper.exam_date || todayStr,
      time_allowed: paper.time_allowed || '1 Hour 30 Mins',
      passing_marks: paper.passing_marks ? String(paper.passing_marks) : '',
      academic_session: paper.academic_session || '',
      instructions: paper.instructions || '',
      language: paper.language || 'en',
      show_student_info_box: paper.show_student_info_box ?? true,
      show_answer_lines: paper.show_answer_lines ?? false,
      status: paper.status || 'draft',
      sections:
        Array.isArray(paper.sections) && paper.sections.length > 0
          ? paper.sections
          : createDefaultSections(paper.language === 'ur'),
    });
    setViewMode('editor');
  };

  const handleSavePaper = async (targetStatus?: 'draft' | 'finalized') => {
    if (!form.title.trim()) {
      toast({ title: 'Paper title required', description: 'Please enter a title for this exam/test paper.', variant: 'error' });
      return;
    }

    const cleanedSections = form.sections
      .map((sec) => ({
        ...sec,
        title: sec.title.trim() || 'Section',
        questions: sec.questions.filter((q) => q.prompt.trim().length > 0),
      }))
      .filter((sec) => sec.questions.length > 0);

    if (cleanedSections.length === 0) {
      toast({
        title: 'Add at least one question',
        description: 'Please enter question text for at least one question before saving.',
        variant: 'error',
      });
      return;
    }

    setSaving(true);
    try {
      const statusToSave = targetStatus ?? form.status;
      const computed = cleanedSections.reduce(
        (acc, sec) => acc + sec.questions.reduce((qAcc, q) => qAcc + (Number(q.marks) || 0), 0),
        0
      );
      const res = await fetch('/api/exams/question-papers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.id,
          exam_id: form.exam_id || null,
          class_id: form.class_id || null,
          section_id: form.section_id || null,
          subject_id: form.subject_id || null,
          title: form.title.trim(),
          paper_code: form.paper_code.trim() || null,
          paper_type: form.paper_type,
          exam_date: form.exam_date || null,
          time_allowed: form.time_allowed.trim() || '1 Hour 30 Mins',
          total_marks: computed,
          passing_marks: form.passing_marks ? Number(form.passing_marks) : Math.round(computed * 0.33),
          academic_session: form.academic_session.trim() || null,
          instructions: form.instructions.trim() || null,
          language: form.language,
          show_student_info_box: form.show_student_info_box,
          show_answer_lines: form.show_answer_lines,
          sections: cleanedSections,
          status: statusToSave,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to save question paper', description: data.error, variant: 'error' });
        return;
      }

      if (data.paper) {
        setForm((prev) => ({
          ...prev,
          id: data.paper.id,
          status: data.paper.status,
          sections: data.paper.sections,
        }));
      }
      toast({
        title: statusToSave === 'finalized' ? 'Question paper finalized & saved' : 'Question paper draft saved',
        variant: 'success',
      });
      void loadPapers();
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicatePaper = async (paperId: string) => {
    const res = await fetch('/api/exams/question-papers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'duplicate', id: paperId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: 'Unable to duplicate paper', description: data.error, variant: 'error' });
      return;
    }
    toast({ title: 'Question paper duplicated', variant: 'success' });
    void loadPapers();
  };

  const handleDeletePaper = async (paperId: string) => {
    const res = await fetch(`/api/exams/question-papers?id=${encodeURIComponent(paperId)}`, {
      method: 'DELETE',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: 'Unable to delete paper', description: data.error, variant: 'error' });
      return;
    }
    toast({ title: 'Question paper deleted', variant: 'success' });
    if (form.id === paperId) {
      setForm(buildFreshForm(true));
      setViewMode('library');
    }
    void loadPapers();
  };

  const handleQuickAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    setAddingSubject(true);
    try {
      const res = await fetch('/api/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'quick_create_subject',
          name: newSubjectName.trim(),
          code: newSubjectCode.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.subject) {
        toast({ title: 'Unable to add subject', description: data.error, variant: 'error' });
        return;
      }
      onSubjectCreated(data.subject);
      setForm((prev) => ({ ...prev, subject_id: data.subject.id }));
      setNewSubjectName('');
      setNewSubjectCode('');
      setOpenAddSubject(false);
      toast({ title: `Subject "${data.subject.name}" ready`, variant: 'success' });
    } finally {
      setAddingSubject(false);
    }
  };

  const addSection = () => {
    const nextIdx = form.sections.length;
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const label = letters[nextIdx] || String(nextIdx + 1);
    setForm((prev) => ({
      ...prev,
      sections: [
        ...prev.sections,
        {
          id: makeLocalId(),
          title: `Section ${label} — New Section`,
          instructions: 'Attempt all questions in this section.',
          questions: [createEmptyQuestion('short', prev.language === 'ur')],
        },
      ],
    }));
  };

  const updateSection = (secId: string, patch: Partial<PaperSection>) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === secId ? { ...s, ...patch } : s)),
    }));
  };

  const removeSection = (secId: string) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.filter((s) => s.id !== secId),
    }));
  };

  const addQuestionToSection = (secId: string, type: QuestionType) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === secId
          ? { ...s, questions: [...s.questions, createEmptyQuestion(type, prev.language === 'ur')] }
          : s
      ),
    }));
  };

  const updateQuestion = (secId: string, qId: string, patch: Partial<PaperQuestion>) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === secId
          ? {
              ...s,
              questions: s.questions.map((q) => (q.id === qId ? { ...q, ...patch } : q)),
            }
          : s
      ),
    }));
  };

  const moveQuestion = (secId: string, qIndex: number, dir: -1 | 1) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== secId) return s;
        const target = qIndex + dir;
        if (target < 0 || target >= s.questions.length) return s;
        const next = [...s.questions];
        const [moved] = next.splice(qIndex, 1);
        next.splice(target, 0, moved);
        return { ...s, questions: next };
      }),
    }));
  };

  const duplicateQuestion = (secId: string, q: PaperQuestion) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === secId
          ? {
              ...s,
              questions: [
                ...s.questions,
                {
                  ...q,
                  id: makeLocalId(),
                  options: q.options ? [...q.options] : undefined,
                },
              ],
            }
          : s
      ),
    }));
  };

  const removeQuestion = (secId: string, qId: string) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === secId ? { ...s, questions: s.questions.filter((q) => q.id !== qId) } : s
      ),
    }));
  };

  const downloadPdfFromPaper = (
    paperInput: {
      title: string;
      paper_code?: string | null;
      paper_type?: string;
      class_id?: string | null;
      section_id?: string | null;
      subject_id?: string | null;
      exam_date?: string | null;
      time_allowed: string;
      total_marks: number;
      passing_marks?: number;
      academic_session?: string | null;
      instructions?: string | null;
      show_student_info_box?: boolean;
      show_answer_lines?: boolean;
      sections: PaperSection[];
    },
    includeAnswerKey: boolean
  ) => {
    generateQuestionPaperPdf(
      {
        nameEn: school.name_en,
        address: school.address,
        city: school.city,
        phone: school.phone,
      },
      {
        title: paperInput.title || 'Examination Paper',
        paper_code: paperInput.paper_code,
        paper_type: paperInput.paper_type,
        className: (paperInput.class_id && classMap.get(paperInput.class_id)) || 'All Classes',
        sectionName: paperInput.section_id ? sectionMap.get(paperInput.section_id) : undefined,
        subjectName: (paperInput.subject_id && subjectMap.get(paperInput.subject_id)) || 'General',
        examDate: paperInput.exam_date,
        timeAllowed: paperInput.time_allowed,
        totalMarks: paperInput.total_marks,
        passingMarks: paperInput.passing_marks,
        academicSession: paperInput.academic_session,
        instructions: paperInput.instructions,
        showStudentInfoBox: paperInput.show_student_info_box,
        showAnswerLines: paperInput.show_answer_lines,
        sections: paperInput.sections,
      },
      { includeAnswerKey }
    );
  };

  const triggerBrowserPrint = (withKey: boolean) => {
    setPreviewAnswerKey(withKey);
    setShowPreviewModal(true);
    setTimeout(() => {
      window.print();
    }, 250);
  };

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileText className="h-4 w-4 text-teal-700 dark:text-teal-400" />
            Exam & Test Question Paper Builder
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Design structured MCQs, Short & Long questions, Fill in the Blanks, True/False papers, Answer Keys & printable A4 PDFs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('library')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === 'library'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Saved Papers ({papers.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('editor')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === 'editor'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Paper Builder Studio
            </button>
          </div>

          <button
            type="button"
            onClick={() => openNewPaper(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-2 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            New Question Paper
          </button>
        </div>
      </div>

      {viewMode === 'library' ? (
        <div className="no-print space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search question papers by title, code, class, subject..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 py-2 pl-9 pr-3 text-xs"
              />
            </div>
            <select
              value={filterClassId}
              onChange={(e) => setFilterClassId(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
            >
              <option value="">All Classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={filterSubjectId}
              onChange={(e) => setFilterSubjectId(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
            >
              <option value="">All Subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {loadingPapers ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-500">
              Loading saved question papers...
            </div>
          ) : filteredPapers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center space-y-3">
              <BookOpen className="mx-auto h-8 w-8 text-teal-700 dark:text-teal-400 opacity-80" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  No question papers created yet
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Start with a standard 3-section exam paper (MCQs + Short + Long) or build a custom class test.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => openNewPaper(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 text-xs font-semibold text-white"
                >
                  <LayoutTemplate className="h-3.5 w-3.5" />
                  Create Standard Exam Paper
                </button>
                <button
                  type="button"
                  onClick={() => openNewPaper(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Blank Class Test
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredPapers.map((paper) => {
                const qCount = paper.sections.reduce((acc, s) => acc + s.questions.length, 0);
                return (
                  <div
                    key={paper.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="inline-block rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                            {paper.paper_type}
                            {paper.paper_code ? ` · ${paper.paper_code}` : ''}
                          </span>
                          <h3 className="mt-1.5 font-display text-sm font-bold text-slate-900 dark:text-white">
                            {paper.title}
                          </h3>
                        </div>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-semibold capitalize ${
                            paper.status === 'finalized'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                          }`}
                        >
                          {paper.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400 pt-1">
                        <p>
                          Class:{' '}
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {(paper.class_id && classMap.get(paper.class_id)) || 'All'}
                          </span>
                        </p>
                        <p>
                          Subject:{' '}
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {(paper.subject_id && subjectMap.get(paper.subject_id)) || 'General'}
                          </span>
                        </p>
                        <p>
                          Questions:{' '}
                          <span className="font-mono-tabular font-semibold">{qCount}</span>
                        </p>
                        <p>
                          Total Marks:{' '}
                          <span className="font-mono-tabular font-semibold">{paper.total_marks}</span>
                        </p>
                        {paper.exam_id && examMap.get(paper.exam_id) && (
                          <p className="col-span-2 truncate">
                            Exam: <span className="font-medium">{examMap.get(paper.exam_id)}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 dark:border-slate-800 pt-3">
                      <button
                        type="button"
                        onClick={() => openEditPaper(paper)}
                        className="rounded-md bg-teal-700 hover:bg-teal-800 px-2.5 py-1 text-[11px] font-semibold text-white"
                      >
                        Edit Paper
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadPdfFromPaper(paper, false)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Download className="h-3 w-3" />
                        Paper PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadPdfFromPaper(paper, true)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <KeyRound className="h-3 w-3" />
                        Key PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicatePaper(paper.id)}
                        title="Duplicate paper"
                        className="rounded-md border border-slate-200 dark:border-slate-800 p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePaper(paper.id)}
                        title="Delete paper"
                        className="ml-auto rounded-md border border-red-200 dark:border-red-900/50 p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="no-print rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-display text-sm font-bold">
                  {form.id ? 'Edit Question Paper' : 'Create New Question Paper'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Configure exam details, class, subject, time allowed, and paper language.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      sections: createDefaultSections(prev.language === 'ur'),
                    }))
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <LayoutTemplate className="h-3.5 w-3.5" />
                  3-Section Template
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewAnswerKey(false);
                    setShowPreviewModal(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Eye className="h-3.5 w-3.5" />
                  A4 Preview
                </button>
                <button
                  type="button"
                  onClick={() => triggerBrowserPrint(false)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-medium">Paper Title *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Monthly Test — Urdu (Grade 5)"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium">Paper Type</label>
                <select
                  value={form.paper_type}
                  onChange={(e) =>
                    setForm({ ...form, paper_type: e.target.value as DraftPaperForm['paper_type'] })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="Test">Class Test</option>
                  <option value="Quiz">Quiz</option>
                  <option value="Monthly">Monthly Test</option>
                  <option value="Midterm">Midterm</option>
                  <option value="Final">Final Exam</option>
                  <option value="Exam">General Exam</option>
                </select>
              </div>
              <div>
                <label className="block font-medium">Linked Exam / Term (Optional)</label>
                <select
                  value={form.exam_id}
                  onChange={(e) => setForm({ ...form, exam_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="">Standalone Test / No Exam</option>
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.title} ({ex.exam_type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium">Class</label>
                <select
                  value={form.class_id}
                  onChange={(e) =>
                    setForm({ ...form, class_id: e.target.value, section_id: '' })
                  }
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
                <label className="block font-medium">Section (Optional)</label>
                <select
                  value={form.section_id}
                  onChange={(e) => setForm({ ...form, section_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="">All Sections</option>
                  {filteredSections.map((sec) => (
                    <option key={sec.id} value={sec.id}>
                      {sec.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="block font-medium">Subject</label>
                  <button
                    type="button"
                    onClick={() => setOpenAddSubject(true)}
                    className="text-[11px] font-semibold text-teal-700 hover:underline dark:text-teal-400"
                  >
                    + Add Subject
                  </button>
                </div>
                <select
                  value={form.subject_id}
                  onChange={(e) => setForm({ ...form, subject_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="">Select Subject</option>
                  {subjects.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium">Language / Script</label>
                <select
                  value={form.language}
                  onChange={(e) =>
                    setForm({ ...form, language: e.target.value as DraftPaperForm['language'] })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="en">English (LTR)</option>
                  <option value="ur">Urdu / Islamiat (RTL)</option>
                  <option value="bilingual">Bilingual (English + Urdu)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium">Exam Date</label>
                <input
                  type="date"
                  value={form.exam_date}
                  onChange={(e) => setForm({ ...form, exam_date: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium">Time Allowed</label>
                <input
                  value={form.time_allowed}
                  onChange={(e) => setForm({ ...form, time_allowed: e.target.value })}
                  placeholder="1 Hour 30 Mins"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium">Paper Code / Version</label>
                <input
                  value={form.paper_code}
                  onChange={(e) => setForm({ ...form, paper_code: e.target.value })}
                  placeholder="e.g. SET-A"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block font-medium">
                  Passing Marks (Total: {computedTotalMarks})
                </label>
                <input
                  type="number"
                  min={0}
                  max={computedTotalMarks || undefined}
                  value={form.passing_marks}
                  onChange={(e) => setForm({ ...form, passing_marks: e.target.value })}
                  placeholder={`Auto 33% (${Math.round(computedTotalMarks * 0.33)})`}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-4">
                <label className="block font-medium">General Instructions for Students</label>
                <input
                  value={form.instructions}
                  onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-5 pt-1">
                <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.show_student_info_box}
                    onChange={(e) =>
                      setForm({ ...form, show_student_info_box: e.target.checked })
                    }
                  />
                  Show Student Name / Roll No Box at Top
                </label>
                <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.show_answer_lines}
                    onChange={(e) => setForm({ ...form, show_answer_lines: e.target.checked })}
                  />
                  Print Writing Lines Below Subjective Questions (Worksheet Mode)
                </label>
              </div>
            </div>
          </div>

          <div className="no-print space-y-4">
            {form.sections.map((section, secIndex) => {
              const sectionMarks = section.questions.reduce(
                (acc, q) => acc + (Number(q.marks) || 0),
                0
              );
              return (
                <div
                  key={section.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div className="flex-1 min-w-[240px] space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-teal-50 dark:bg-teal-950/60 px-2 py-0.5 font-mono-tabular text-[11px] font-bold text-teal-800 dark:text-teal-300">
                          Section {secIndex + 1} · {sectionMarks} Marks
                        </span>
                      </div>
                      <input
                        value={section.title}
                        onChange={(e) => updateSection(section.id, { title: e.target.value })}
                        placeholder="Section Title (e.g. Section A — Objective)"
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm font-semibold"
                      />
                      <input
                        value={section.instructions || ''}
                        onChange={(e) =>
                          updateSection(section.id, { instructions: e.target.value })
                        }
                        placeholder="Section instructions (e.g. Attempt any 5 out of 7 questions)"
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs"
                      />
                    </div>
                    {form.sections.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSection(section.id)}
                        className="rounded-lg border border-red-200 dark:border-red-900/50 px-2.5 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        Remove Section
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    {section.questions.map((q, qIdx) => (
                      <div
                        key={q.id}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3.5 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono-tabular text-xs font-bold text-slate-700 dark:text-slate-200">
                              Q{qIdx + 1}
                            </span>
                            <select
                              value={q.type}
                              onChange={(e) => {
                                const nextType = e.target.value as QuestionType;
                                const patch: Partial<PaperQuestion> = { type: nextType };
                                if (nextType === 'mcq' && (!q.options || q.options.length === 0)) {
                                  patch.options = ['', '', '', ''];
                                  patch.correctAnswer = 'A';
                                } else if (nextType === 'true_false') {
                                  patch.correctAnswer = 'True';
                                }
                                updateQuestion(section.id, q.id, patch);
                              }}
                              className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] font-semibold"
                            >
                              {Object.entries(QUESTION_TYPE_LABELS).map(([val, lbl]) => (
                                <option key={val} value={val}>
                                  {lbl}
                                </option>
                              ))}
                            </select>

                            <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(q.isRtl)}
                                onChange={(e) =>
                                  updateQuestion(section.id, q.id, { isRtl: e.target.checked })
                                }
                              />
                              Urdu/RTL
                            </label>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <label className="text-[11px] text-slate-500">Marks:</label>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={q.marks}
                              onChange={(e) =>
                                updateQuestion(section.id, q.id, {
                                  marks: Number(e.target.value) || 0,
                                })
                              }
                              className="w-16 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs font-mono-tabular text-right"
                            />
                            <button
                              type="button"
                              onClick={() => moveQuestion(section.id, qIdx, -1)}
                              disabled={qIdx === 0}
                              title="Move up"
                              className="rounded border border-slate-200 dark:border-slate-700 p-1 text-slate-600 disabled:opacity-35"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveQuestion(section.id, qIdx, 1)}
                              disabled={qIdx === section.questions.length - 1}
                              title="Move down"
                              className="rounded border border-slate-200 dark:border-slate-700 p-1 text-slate-600 disabled:opacity-35"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => duplicateQuestion(section.id, q)}
                              title="Duplicate question"
                              className="rounded border border-slate-200 dark:border-slate-700 p-1 text-slate-600"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeQuestion(section.id, q.id)}
                              title="Delete question"
                              className="rounded border border-red-200 dark:border-red-900/50 p-1 text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        <textarea
                          rows={q.type === 'long' ? 3 : 2}
                          dir={q.isRtl ? 'rtl' : 'ltr'}
                          value={q.prompt}
                          onChange={(e) =>
                            updateQuestion(section.id, q.id, { prompt: e.target.value })
                          }
                          placeholder={
                            q.type === 'fill_blank'
                              ? 'Type sentence with _____ for the blank...'
                              : 'Enter question statement here...'
                          }
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                        />

                        {q.type === 'mcq' && (
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {['A', 'B', 'C', 'D'].map((letter, optIdx) => {
                              const optVal = q.options?.[optIdx] ?? '';
                              const isCorrect = q.correctAnswer === letter;
                              return (
                                <div key={letter} className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateQuestion(section.id, q.id, { correctAnswer: letter })
                                    }
                                    title="Mark as correct option"
                                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-bold transition-colors ${
                                      isCorrect
                                        ? 'border-teal-700 bg-teal-700 text-white'
                                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600'
                                    }`}
                                  >
                                    {letter}
                                  </button>
                                  <input
                                    dir={q.isRtl ? 'rtl' : 'ltr'}
                                    value={optVal}
                                    onChange={(e) => {
                                      const nextOpts = [...(q.options ?? ['', '', '', ''])];
                                      while (nextOpts.length < 4) nextOpts.push('');
                                      nextOpts[optIdx] = e.target.value;
                                      updateQuestion(section.id, q.id, { options: nextOpts });
                                    }}
                                    placeholder={`Option ${letter}`}
                                    className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {q.type === 'true_false' && (
                          <div className="flex items-center gap-3 text-xs">
                            <span className="font-medium text-slate-600 dark:text-slate-400">
                              Correct Answer:
                            </span>
                            {['True', 'False'].map((tf) => (
                              <button
                                key={tf}
                                type="button"
                                onClick={() =>
                                  updateQuestion(section.id, q.id, { correctAnswer: tf })
                                }
                                className={`rounded-md border px-3 py-1 text-xs font-semibold ${
                                  q.correctAnswer === tf
                                    ? 'border-teal-700 bg-teal-700 text-white'
                                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900'
                                }`}
                              >
                                {tf}
                              </button>
                            ))}
                          </div>
                        )}

                        {q.type !== 'mcq' && q.type !== 'true_false' && (
                          <input
                            dir={q.isRtl ? 'rtl' : 'ltr'}
                            value={q.correctAnswer || ''}
                            onChange={(e) =>
                              updateQuestion(section.id, q.id, { correctAnswer: e.target.value })
                            }
                            placeholder="Optional Answer Key / Marking Hints (only shown on Answer Key PDF)"
                            className="w-full rounded-md border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-[11px] font-medium text-slate-500">Add Question:</span>
                    {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((qType) => (
                      <button
                        key={qType}
                        type="button"
                        onClick={() => addQuestionToSection(section.id, qType)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Plus className="h-3 w-3 text-teal-700 dark:text-teal-400" />
                        {QUESTION_TYPE_LABELS[qType]}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              onClick={addSection}
              className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-teal-600/60 bg-teal-50/40 dark:bg-teal-950/20 px-4 py-2.5 text-xs font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Another Section (e.g. Comprehension / Translation / Practical)
            </button>
          </div>

          <div className="no-print sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm p-4 shadow-lg">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span>
                Sections: <strong className="font-mono-tabular">{form.sections.length}</strong>
              </span>
              <span>
                Questions: <strong className="font-mono-tabular">{totalQuestionCount}</strong>
              </span>
              <span>
                Total Marks:{' '}
                <strong className="font-mono-tabular text-teal-700 dark:text-teal-400">
                  {computedTotalMarks}
                </strong>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadPdfFromPaper(
                    {
                      ...form,
                      total_marks: computedTotalMarks,
                      passing_marks: form.passing_marks
                        ? Number(form.passing_marks)
                        : Math.round(computedTotalMarks * 0.33),
                    },
                    false
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" />
                Paper PDF
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadPdfFromPaper(
                    {
                      ...form,
                      total_marks: computedTotalMarks,
                      passing_marks: form.passing_marks
                        ? Number(form.passing_marks)
                        : Math.round(computedTotalMarks * 0.33),
                    },
                    true
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Answer Key PDF
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSavePaper('draft')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700 px-3.5 py-2 text-xs font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/30 disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSavePaper('finalized')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Finalize & Save Paper'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ModalDialog
        open={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        title={previewAnswerKey ? 'Answer Key Preview' : 'Question Paper A4 Preview'}
        maxWidthClass="max-w-4xl"
      >
        <div className="space-y-4">
          <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewAnswerKey(false)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  !previewAnswerKey ? 'bg-teal-700 text-white' : 'border border-slate-300 dark:border-slate-700'
                }`}
              >
                Student Paper
              </button>
              <button
                type="button"
                onClick={() => setPreviewAnswerKey(true)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  previewAnswerKey ? 'bg-teal-700 text-white' : 'border border-slate-300 dark:border-slate-700'
                }`}
              >
                Answer Key
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 px-3.5 py-1.5 text-xs font-semibold text-white"
              >
                <Printer className="h-3.5 w-3.5" />
                Print / Save PDF (Supports Urdu & English)
              </button>
            </div>
          </div>

          <div
            dir={form.language === 'ur' ? 'rtl' : 'ltr'}
            className="rounded-lg border border-slate-300 bg-white text-slate-950 p-6 space-y-4 text-xs"
          >
            <div className="border-b-2 border-slate-900 pb-3 text-center space-y-1">
              <h2 className="text-lg font-bold uppercase tracking-wide">{school.name_en}</h2>
              {(school.address || school.city || school.phone) && (
                <p className="text-[11px] text-slate-600">
                  {[school.address, school.city, school.phone].filter(Boolean).join(' · ')}
                </p>
              )}
              <p className="pt-1 text-sm font-bold">
                {form.title || 'Examination Question Paper'}
                {previewAnswerKey ? ' — ANSWER KEY' : ''}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-[11px]">
              <div>
                <strong>Class:</strong>{' '}
                {(form.class_id && classMap.get(form.class_id)) || 'All'}{' '}
                {form.section_id ? `(${sectionMap.get(form.section_id) || ''})` : ''}
              </div>
              <div className="text-center">
                <strong>Subject:</strong>{' '}
                {(form.subject_id && subjectMap.get(form.subject_id)) || 'General'}
              </div>
              <div className="text-right font-mono-tabular">
                <strong>Total Marks:</strong> {computedTotalMarks}
              </div>
              <div>
                <strong>Type:</strong> {form.paper_type}
                {form.paper_code ? ` (${form.paper_code})` : ''}
              </div>
              <div className="text-center">
                <strong>Time:</strong> {form.time_allowed}
              </div>
              <div className="text-right font-mono-tabular">
                <strong>Date:</strong> {form.exam_date || '________'}
              </div>
            </div>

            {!previewAnswerKey && form.show_student_info_box && (
              <div className="grid grid-cols-3 gap-3 border border-slate-400 px-3 py-2 text-[11px]">
                <div>Name: _______________________</div>
                <div>Roll No: ____________</div>
                <div>Section: __________</div>
              </div>
            )}

            {!previewAnswerKey && form.instructions && (
              <p className="italic text-[11px] text-slate-700">
                <strong>Instructions:</strong> {form.instructions}
              </p>
            )}

            <div className="space-y-4">
              {form.sections.map((sec) => {
                const secTotal = sec.questions.reduce((a, b) => a + (Number(b.marks) || 0), 0);
                return (
                  <div key={sec.id} className="space-y-2">
                    <div className="flex items-center justify-between border-b border-slate-400 bg-slate-100 px-2.5 py-1.5 font-bold">
                      <span>{sec.title}</span>
                      <span className="font-mono-tabular">[{secTotal} Marks]</span>
                    </div>
                    {sec.instructions && (
                      <p className="italic text-[11px] text-slate-600 px-1">{sec.instructions}</p>
                    )}
                    <div className="space-y-2.5 pl-1">
                      {sec.questions.map((q, idx) => (
                        <div
                          key={q.id}
                          dir={q.isRtl ? 'rtl' : undefined}
                          className="space-y-1 border-b border-dotted border-slate-200 pb-2"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <p className="font-semibold text-[12px] whitespace-pre-wrap">
                              Q{idx + 1}. {q.prompt || '(Question text)'}
                            </p>
                            <span className="shrink-0 font-mono-tabular text-[11px] font-semibold">
                              [{q.marks}]
                            </span>
                          </div>
                          {q.type === 'mcq' && q.options && (
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 pl-4 text-[11px]">
                              {['A', 'B', 'C', 'D'].map((letter, oIdx) => (
                                <div key={letter}>
                                  ({letter}) {q.options?.[oIdx] || '—'}
                                </div>
                              ))}
                            </div>
                          )}
                          {q.type === 'true_false' && !previewAnswerKey && (
                            <p className="pl-4 text-[11px] text-slate-600">[ ] True   [ ] False</p>
                          )}
                          {previewAnswerKey && q.correctAnswer && (
                            <p className="pl-4 text-[11px] font-bold text-teal-800">
                              Answer: {q.correctAnswer}
                            </p>
                          )}
                          {!previewAnswerKey &&
                            form.show_answer_lines &&
                            (q.type === 'short' || q.type === 'long') && (
                              <div className="space-y-3 pt-2 pl-4">
                                {Array.from({ length: q.type === 'long' ? 4 : 2 }).map((_, li) => (
                                  <div key={li} className="border-b border-slate-300" />
                                ))}
                              </div>
                            )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </ModalDialog>

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
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              placeholder="e.g. Mathematics, English, Science, Islamiat"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">Subject Code (Optional)</label>
            <input
              value={newSubjectCode}
              onChange={(e) => setNewSubjectCode(e.target.value)}
              placeholder="e.g. MATH-101"
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
