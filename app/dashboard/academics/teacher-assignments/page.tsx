'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Download,
  Layers,
  Pencil,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { exportRowsToExcel } from '@/lib/export/excel';

interface AssignmentRow {
  id: string;
  teacher_id: string;
  session_id: string | null;
  class_id: string;
  section_id: string | null;
  subject_id: string | null;
  is_class_incharge: boolean;
  created_at: string;
}

interface TeacherOption {
  id: string;
  employee_code: string;
  full_name: string;
  designation: string;
  department: string;
  status: string;
}

interface ClassOption {
  id: string;
  name: string;
  level_order: number;
}

interface SectionOption {
  id: string;
  name: string;
  class_id: string;
}

interface SubjectOption {
  id: string;
  name: string;
  code: string | null;
}

interface ClassSubjectMap {
  id: string;
  class_id: string;
  subject_id: string;
}

interface SessionOption {
  id: string;
  name: string;
  is_current: boolean;
}

interface EnrichedAssignment extends AssignmentRow {
  teacherName: string;
  employeeCode: string;
  designation: string;
  teacherStatus: string;
  className: string;
  sectionName: string;
  subjectName: string;
  subjectCode: string | null;
  sessionName: string;
}

type ConfirmTarget =
  | { mode: 'single'; assignment: EnrichedAssignment }
  | { mode: 'bulk'; ids: string[] }
  | { mode: 'teacher'; teacher: TeacherOption; count: number }
  | null;

const selectClass =
  'rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-teal-600 focus:outline-none [color-scheme:light] dark:[color-scheme:dark]';

const fieldLabelClass = 'block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1';

export default function TeacherClassAssignmentsPage() {
  const { toast } = useToast();

  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [classSubjects, setClassSubjects] = useState<ClassSubjectMap[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<'list' | 'teachers'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState<'all' | 'incharge' | 'subject'>('all');
  const [teacherAllocationFilter, setTeacherAllocationFilter] = useState<'all' | 'assigned' | 'unassigned'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Assign modal state
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTeacherId, setAssignTeacherId] = useState('');
  const [assignClassId, setAssignClassId] = useState('');
  const [assignSectionId, setAssignSectionId] = useState('');
  const [assignSessionId, setAssignSessionId] = useState('');
  const [assignSubjectIds, setAssignSubjectIds] = useState<string[]>([]);
  const [assignIsIncharge, setAssignIsIncharge] = useState(false);
  const [showAllSubjectsInModal, setShowAllSubjectsInModal] = useState(false);
  const [submittingAssign, setSubmittingAssign] = useState(false);

  // Edit modal state
  const [editTarget, setEditTarget] = useState<EnrichedAssignment | null>(null);
  const [editClassId, setEditClassId] = useState('');
  const [editSectionId, setEditSectionId] = useState('');
  const [editSubjectId, setEditSubjectId] = useState('');
  const [editSessionId, setEditSessionId] = useState('');
  const [editIsIncharge, setEditIsIncharge] = useState(false);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  // Confirm unassign state
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/teacher-assignments', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Failed to load assignments',
          description: data.error || 'Could not fetch teacher class assignments.',
          variant: 'error',
        });
        return;
      }
      setAssignments(data.assignments ?? []);
      setTeachers(data.teachers ?? []);
      setClasses(data.classes ?? []);
      setSections(data.sections ?? []);
      setSubjects(data.subjects ?? []);
      setClassSubjects(data.classSubjects ?? []);
      setSessions(data.sessions ?? []);
      setSelectedIds([]);
    } catch {
      toast({
        title: 'Network error',
        description: 'Could not reach the server.',
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
  }, [loadData]);

  const currentSessionId = useMemo(
    () => sessions.find((s) => s.is_current)?.id ?? '',
    [sessions]
  );

  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const sectionMap = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const sessionMap = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  const enrichedAssignments = useMemo<EnrichedAssignment[]>(() => {
    return assignments.map((row) => {
      const teacher = teacherMap.get(row.teacher_id);
      const cls = classMap.get(row.class_id);
      const sec = row.section_id ? sectionMap.get(row.section_id) : undefined;
      const subj = row.subject_id ? subjectMap.get(row.subject_id) : undefined;
      const sess = row.session_id ? sessionMap.get(row.session_id) : undefined;
      return {
        ...row,
        teacherName: teacher?.full_name ?? 'Unknown Teacher',
        employeeCode: teacher?.employee_code ?? '—',
        designation: teacher?.designation ?? 'Teacher',
        teacherStatus: teacher?.status ?? 'active',
        className: cls?.name ?? 'Unknown Class',
        sectionName: sec ? sec.name : 'All Sections',
        subjectName: subj ? subj.name : 'General / All Subjects',
        subjectCode: subj?.code ?? null,
        sessionName: sess?.name ?? '—',
      };
    });
  }, [assignments, teacherMap, classMap, sectionMap, subjectMap, sessionMap]);

  const assignmentsByTeacher = useMemo(() => {
    const map = new Map<string, EnrichedAssignment[]>();
    for (const item of enrichedAssignments) {
      const list = map.get(item.teacher_id) ?? [];
      list.push(item);
      map.set(item.teacher_id, list);
    }
    return map;
  }, [enrichedAssignments]);

  const activeTeachers = useMemo(
    () => teachers.filter((t) => String(t.status || '').toLowerCase() === 'active'),
    [teachers]
  );

  const summary = useMemo(() => {
    const assignedTeacherIds = new Set(assignments.map((a) => a.teacher_id));
    const inchargeCount = assignments.filter((a) => a.is_class_incharge).length;
    const unassignedActiveCount = activeTeachers.filter((t) => !assignedTeacherIds.has(t.id)).length;
    return {
      totalAssignments: assignments.length,
      assignedTeachers: assignedTeacherIds.size,
      inchargeCount,
      unassignedActiveCount,
    };
  }, [assignments, activeTeachers]);

  const filteredAssignments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedAssignments.filter((item) => {
      if (teacherFilter !== 'all' && item.teacher_id !== teacherFilter) return false;
      if (classFilter !== 'all' && item.class_id !== classFilter) return false;
      if (roleFilter === 'incharge' && !item.is_class_incharge) return false;
      if (roleFilter === 'subject' && item.is_class_incharge) return false;
      if (!q) return true;
      const haystack = `${item.teacherName} ${item.employeeCode} ${item.designation} ${item.className} ${item.sectionName} ${item.subjectName} ${item.subjectCode ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [enrichedAssignments, teacherFilter, classFilter, roleFilter, searchQuery]);

  const filteredTeacherRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return teachers
      .filter((t) => {
        const list = assignmentsByTeacher.get(t.id) ?? [];
        const isActive = String(t.status || '').toLowerCase() === 'active';
        if (!isActive && list.length === 0) return false;
        if (teacherAllocationFilter === 'assigned' && list.length === 0) return false;
        if (teacherAllocationFilter === 'unassigned' && list.length > 0) return false;
        if (!q) return true;
        const classMatch = list.some(
          (a) =>
            a.className.toLowerCase().includes(q) ||
            a.sectionName.toLowerCase().includes(q) ||
            a.subjectName.toLowerCase().includes(q)
        );
        return (
          t.full_name.toLowerCase().includes(q) ||
          t.employee_code.toLowerCase().includes(q) ||
          t.designation.toLowerCase().includes(q) ||
          classMatch
        );
      });
  }, [teachers, assignmentsByTeacher, teacherAllocationFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredAssignments.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageAssignments = filteredAssignments.slice((safePage - 1) * pageSize, safePage * pageSize);

  const assignClassSections = useMemo(
    () => sections.filter((s) => s.class_id === assignClassId),
    [sections, assignClassId]
  );

  const mappedSubjectsForAssignClass = useMemo(() => {
    if (!assignClassId) return [];
    const mappedIds = new Set(
      classSubjects.filter((m) => m.class_id === assignClassId).map((m) => m.subject_id)
    );
    return subjects.filter((s) => mappedIds.has(s.id));
  }, [assignClassId, classSubjects, subjects]);

  const availableSubjectsInAssignModal = useMemo(() => {
    if (showAllSubjectsInModal || mappedSubjectsForAssignClass.length === 0) {
      return subjects;
    }
    return mappedSubjectsForAssignClass;
  }, [showAllSubjectsInModal, mappedSubjectsForAssignClass, subjects]);

  const editClassSections = useMemo(
    () => sections.filter((s) => s.class_id === editClassId),
    [sections, editClassId]
  );

  const openAssignModal = (presetTeacherId?: string) => {
    setAssignTeacherId(presetTeacherId ?? (teacherFilter !== 'all' ? teacherFilter : ''));
    setAssignClassId(classFilter !== 'all' ? classFilter : '');
    setAssignSectionId('');
    setAssignSessionId(currentSessionId);
    setAssignSubjectIds([]);
    setAssignIsIncharge(false);
    setShowAllSubjectsInModal(false);
    setAssignOpen(true);
  };

  const openEditModal = (row: EnrichedAssignment) => {
    setEditTarget(row);
    setEditClassId(row.class_id);
    setEditSectionId(row.section_id ?? '');
    setEditSubjectId(row.subject_id ?? '');
    setEditSessionId(row.session_id ?? '');
    setEditIsIncharge(row.is_class_incharge);
  };

  const toggleAssignSubject = (subjectId: string) => {
    setAssignSubjectIds((prev) =>
      prev.includes(subjectId) ? prev.filter((id) => id !== subjectId) : [...prev, subjectId]
    );
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTeacherId || !assignClassId) {
      toast({
        title: 'Teacher & Class required',
        description: 'Please select both a teacher and a class.',
        variant: 'error',
      });
      return;
    }

    setSubmittingAssign(true);
    try {
      const res = await fetch('/api/teacher-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherId: assignTeacherId,
          classId: assignClassId,
          sectionId: assignSectionId || null,
          subjectIds: assignSubjectIds,
          sessionId: assignSessionId || null,
          isClassIncharge: assignIsIncharge,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Assignment failed',
          description: data.error || 'Could not assign class.',
          variant: 'error',
        });
        return;
      }
      toast({
        title: 'Class assigned',
        description:
          data.insertedCount > 1
            ? `${data.insertedCount} class/subject allocations saved.`
            : 'Teacher has been assigned to the selected class.',
        variant: 'success',
      });
      setAssignOpen(false);
      await loadData();
    } finally {
      setSubmittingAssign(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editClassId) return;

    setSubmittingEdit(true);
    try {
      const res = await fetch('/api/teacher-assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editTarget.id,
          classId: editClassId,
          sectionId: editSectionId || null,
          subjectId: editSubjectId || null,
          sessionId: editSessionId || null,
          isClassIncharge: editIsIncharge,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Update failed',
          description: data.error || 'Could not update assignment.',
          variant: 'error',
        });
        return;
      }
      toast({
        title: 'Assignment updated',
        description: 'Class allocation updated successfully.',
        variant: 'success',
      });
      setEditTarget(null);
      await loadData();
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleQuickToggleIncharge = async (row: EnrichedAssignment) => {
    const nextState = !row.is_class_incharge;
    const res = await fetch('/api/teacher-assignments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: row.id,
        isClassIncharge: nextState,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({
        title: 'Update failed',
        description: data.error || 'Could not update in-charge status.',
        variant: 'error',
      });
      return;
    }
    toast({
      title: nextState ? 'Marked as Class In-charge' : 'Class In-charge removed',
      variant: 'success',
    });
    await loadData();
  };

  const handleConfirmUnassign = async () => {
    if (!confirmTarget) return;
    setSubmittingDelete(true);
    try {
      const payload =
        confirmTarget.mode === 'single'
          ? { id: confirmTarget.assignment.id }
          : confirmTarget.mode === 'bulk'
            ? { ids: confirmTarget.ids }
            : { teacherId: confirmTarget.teacher.id };

      const res = await fetch('/api/teacher-assignments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Unassign failed',
          description: data.error || 'Could not remove assignment.',
          variant: 'error',
        });
        return;
      }
      toast({
        title: 'Class unassigned',
        description:
          data.removedCount > 1
            ? `${data.removedCount} class assignments removed.`
            : 'Teacher has been unassigned from the class.',
        variant: 'success',
      });
      setConfirmTarget(null);
      await loadData();
    } finally {
      setSubmittingDelete(false);
    }
  };

  const toggleRowSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const allPageSelected =
    pageAssignments.length > 0 && pageAssignments.every((item) => selectedIds.includes(item.id));

  const toggleSelectPage = () => {
    if (allPageSelected) {
      const pageIdSet = new Set(pageAssignments.map((p) => p.id));
      setSelectedIds((prev) => prev.filter((id) => !pageIdSet.has(id)));
    } else {
      const merged = new Set([...selectedIds, ...pageAssignments.map((p) => p.id)]);
      setSelectedIds(Array.from(merged));
    }
  };

  const handleExportExcel = () => {
    const mapped = filteredAssignments.map((r) => ({
      Teacher: r.teacherName,
      'Employee Code': r.employeeCode,
      Designation: r.designation,
      Class: r.className,
      Section: r.sectionName,
      Subject: r.subjectName,
      Role: r.is_class_incharge ? 'Class In-charge' : 'Subject Teacher',
      Session: r.sessionName,
      'Assigned On': new Date(r.created_at).toLocaleDateString(),
    }));
    exportRowsToExcel('teacher-class-assignments', 'Teacher Class Assignments', mapped);
  };

  const confirmMessage = useMemo(() => {
    if (!confirmTarget) return '';
    if (confirmTarget.mode === 'single') {
      const a = confirmTarget.assignment;
      return `Unassign ${a.teacherName} from ${a.className} (${a.sectionName}) — ${a.subjectName}? The teacher will no longer see this class in their portal.`;
    }
    if (confirmTarget.mode === 'bulk') {
      return `Unassign ${confirmTarget.ids.length} selected class allocation(s)? Affected teachers will immediately lose access to those classes in their portal.`;
    }
    return `Unassign all ${confirmTarget.count} class allocation(s) from ${confirmTarget.teacher.full_name} (${confirmTarget.teacher.employee_code})?`;
  }, [confirmTarget]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            Teacher Class Assignments
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Assign teachers to classes, sections, subjects, and class in-charge duties, or unassign existing allocations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openAssignModal()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 px-4 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Assign Class
        </button>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total Assignments</span>
            <Layers className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-white">
            {summary.totalAssignments}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Assigned Teachers</span>
            <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-white">
            {summary.assignedTeachers}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Class In-charges</span>
            <ShieldCheck className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-white">
            {summary.inchargeCount}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Unassigned Teachers</span>
            <Users className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-white">
            {summary.unassignedActiveCount}
          </p>
        </div>
      </div>

      {/* Main Panel */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {/* Toolbar Top */}
        <div className="flex flex-col gap-3 border-b border-slate-200 dark:border-slate-800 p-4 lg:flex-row lg:items-center lg:justify-between no-print">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-1 self-start">
            <button
              type="button"
              onClick={() => {
                setViewMode('list');
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                viewMode === 'list'
                  ? 'bg-teal-700 text-white dark:bg-teal-600'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Assignments List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('teachers')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                viewMode === 'teachers'
                  ? 'bg-teal-700 text-white dark:bg-teal-600'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Teacher-wise View
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {viewMode === 'list' && selectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmTarget({ mode: 'bulk', ids: selectedIds })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60 whitespace-nowrap"
              >
                <UserMinus className="h-3.5 w-3.5" />
                Unassign Selected ({selectedIds.length})
              </button>
            )}

            {viewMode === 'list' && filteredAssignments.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-col gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between no-print">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search teacher, code, class, subject..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none [color-scheme:light] dark:[color-scheme:dark]"
            />
          </div>

          {viewMode === 'list' ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={teacherFilter}
                onChange={(e) => {
                  setTeacherFilter(e.target.value);
                  setPage(1);
                }}
                className={selectClass}
                aria-label="Filter by teacher"
              >
                <option value="all">All Teachers</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name} ({t.employee_code})
                  </option>
                ))}
              </select>

              <select
                value={classFilter}
                onChange={(e) => {
                  setClassFilter(e.target.value);
                  setPage(1);
                }}
                className={selectClass}
                aria-label="Filter by class"
              >
                <option value="all">All Classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value as 'all' | 'incharge' | 'subject');
                  setPage(1);
                }}
                className={selectClass}
                aria-label="Filter by role"
              >
                <option value="all">All Roles</option>
                <option value="incharge">Class In-charge Only</option>
                <option value="subject">Subject / General Only</option>
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={teacherAllocationFilter}
                onChange={(e) =>
                  setTeacherAllocationFilter(e.target.value as 'all' | 'assigned' | 'unassigned')
                }
                className={selectClass}
                aria-label="Filter teacher allocation status"
              >
                <option value="all">All Active Teachers</option>
                <option value="assigned">Assigned Only</option>
                <option value="unassigned">Unassigned Only</option>
              </select>
            </div>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-11 w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
              />
            ))}
          </div>
        ) : viewMode === 'list' ? (
          filteredAssignments.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <BookOpen className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-500" />
              <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
                No class assignments found
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Click &ldquo;Assign Class&rdquo; to allocate a class, section, or subject to a teacher.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="w-10 px-4 py-3 no-print">
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          onChange={toggleSelectPage}
                          aria-label="Select all on page"
                          className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-700 accent-teal-700"
                        />
                      </th>
                      <th className="px-4 py-3 font-semibold whitespace-nowrap">Teacher</th>
                      <th className="px-4 py-3 font-semibold whitespace-nowrap">Class &amp; Section</th>
                      <th className="px-4 py-3 font-semibold whitespace-nowrap">Subject</th>
                      <th className="px-4 py-3 font-semibold whitespace-nowrap">Duty Role</th>
                      <th className="px-4 py-3 font-semibold whitespace-nowrap">Session</th>
                      <th className="px-4 py-3 font-semibold whitespace-nowrap">Assigned On</th>
                      <th className="px-4 py-3 font-semibold whitespace-nowrap text-right no-print">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {pageAssignments.map((row) => (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-4 py-3 no-print">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(row.id)}
                            onChange={() => toggleRowSelection(row.id)}
                            aria-label={`Select assignment for ${row.teacherName}`}
                            className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-700 accent-teal-700"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {row.teacherName}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="font-mono-tabular">{row.employeeCode}</span> · {row.designation}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-teal-700 dark:text-teal-400">
                            {row.className}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Section: {row.sectionName}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                          <span>{row.subjectName}</span>
                          {row.subjectCode && (
                            <span className="ml-1.5 font-mono-tabular text-[11px] text-slate-400">
                              ({row.subjectCode})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {row.is_class_incharge ? (
                            <button
                              type="button"
                              onClick={() => void handleQuickToggleIncharge(row)}
                              title="Click to remove Class In-charge duty"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Class In-charge
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleQuickToggleIncharge(row)}
                              title="Click to promote to Class In-charge"
                              className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400"
                            >
                              <CheckSquare className="h-3.5 w-3.5" />
                              Subject / General
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {row.sessionName}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {new Date(row.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right no-print">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(row)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmTarget({ mode: 'single', assignment: row })}
                              className="inline-flex items-center gap-1 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-2.5 py-1 text-[11px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60"
                            >
                              <UserMinus className="h-3 w-3" />
                              Unassign
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 px-4 py-3 text-xs text-slate-500 dark:text-slate-400 no-print">
                <span className="font-mono-tabular">
                  Showing {(safePage - 1) * pageSize + 1}–
                  {Math.min(safePage * pageSize, filteredAssignments.length)} of{' '}
                  {filteredAssignments.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="px-2 font-mono-tabular">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 disabled:opacity-40"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </>
          )
        ) : filteredTeacherRows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Users className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-500" />
            <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
              No matching teachers found
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Adjust your search or allocation filter to inspect teachers.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredTeacherRows.map((teacher) => {
              const list = assignmentsByTeacher.get(teacher.id) ?? [];
              return (
                <div key={teacher.id} className="p-4 sm:p-5 space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">
                          {teacher.full_name}
                        </p>
                        <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                          {teacher.employee_code}
                        </span>
                        {String(teacher.status || '').toLowerCase() !== 'active' && (
                          <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                            · {teacher.status}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {teacher.designation} · {teacher.department} ·{' '}
                        <span className="font-mono-tabular font-semibold text-slate-700 dark:text-slate-200">
                          {list.length} {list.length === 1 ? 'class' : 'classes'} assigned
                        </span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openAssignModal(teacher.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Assign Class
                      </button>
                      {list.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmTarget({ mode: 'teacher', teacher, count: list.length })
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60 whitespace-nowrap"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Unassign All
                        </button>
                      )}
                    </div>
                  </div>

                  {list.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      No classes assigned to this teacher yet.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {list.map((item) => (
                        <div
                          key={item.id}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs"
                        >
                          <span className="font-semibold text-teal-700 dark:text-teal-400">
                            {item.className}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-700 dark:text-slate-200">
                            {item.sectionName}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-600 dark:text-slate-300">
                            {item.subjectName}
                          </span>
                          {item.is_class_incharge && (
                            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                              · <ShieldCheck className="h-3 w-3" /> In-charge
                            </span>
                          )}
                          <div className="ml-1 flex items-center gap-1 border-l border-slate-200 dark:border-slate-700 pl-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(item)}
                              aria-label={`Edit ${item.className} assignment`}
                              className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmTarget({ mode: 'single', assignment: item })}
                              aria-label={`Unassign ${item.className}`}
                              className="rounded p-1 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Assign Class Modal */}
      <ModalDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Assign Class to Teacher"
        subtitle="Select teacher, class, section, and one or more subjects. Leave subjects unchecked for a general class assignment."
      >
        <form onSubmit={handleAssignSubmit} className="space-y-4 text-xs">
          <div>
            <label className={fieldLabelClass}>Teacher *</label>
            <select
              required
              value={assignTeacherId}
              onChange={(e) => setAssignTeacherId(e.target.value)}
              className={`${selectClass} w-full`}
            >
              <option value="">Select Teacher</option>
              {activeTeachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name} ({t.employee_code}) — {t.designation}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={fieldLabelClass}>Class *</label>
              <select
                required
                value={assignClassId}
                onChange={(e) => {
                  setAssignClassId(e.target.value);
                  setAssignSectionId('');
                  setAssignSubjectIds([]);
                  setShowAllSubjectsInModal(false);
                }}
                className={`${selectClass} w-full`}
              >
                <option value="">Select Class</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={fieldLabelClass}>Section</label>
              <select
                value={assignSectionId}
                onChange={(e) => setAssignSectionId(e.target.value)}
                disabled={!assignClassId}
                className={`${selectClass} w-full disabled:opacity-50`}
              >
                <option value="">All Sections</option>
                {assignClassSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {sessions.length > 0 && (
            <div>
              <label className={fieldLabelClass}>Academic Session</label>
              <select
                value={assignSessionId}
                onChange={(e) => setAssignSessionId(e.target.value)}
                className={`${selectClass} w-full`}
              >
                <option value="">No specific session</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.is_current ? '(Current)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Subjects (optional multi-select)
              </label>
              {assignClassId && mappedSubjectsForAssignClass.length > 0 && subjects.length > mappedSubjectsForAssignClass.length && (
                <button
                  type="button"
                  onClick={() => setShowAllSubjectsInModal((prev) => !prev)}
                  className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline"
                >
                  {showAllSubjectsInModal ? 'Show mapped class subjects only' : 'Show all school subjects'}
                </button>
              )}
            </div>

            {!assignClassId ? (
              <p className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-slate-500 dark:text-slate-400">
                Select a class first to load class subjects.
              </p>
            ) : availableSubjectsInAssignModal.length === 0 ? (
              <p className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-slate-500 dark:text-slate-400">
                No subjects defined yet. Submitting will assign a General / Class Teacher allocation.
              </p>
            ) : (
              <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {availableSubjectsInAssignModal.map((subj) => {
                  const checked = assignSubjectIds.includes(subj.id);
                  return (
                    <label
                      key={subj.id}
                      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors ${
                        checked
                          ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-900 dark:text-teal-200'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAssignSubject(subj.id)}
                        className="h-3.5 w-3.5 rounded accent-teal-700"
                      />
                      <span className="truncate font-medium">
                        {subj.name}
                        {subj.code ? ` (${subj.code})` : ''}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {assignSubjectIds.length === 0
                ? 'No subjects checked — will save as General / All Subjects.'
                : `${assignSubjectIds.length} subject(s) selected.`}
            </p>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={assignIsIncharge}
              onChange={(e) => setAssignIsIncharge(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded accent-teal-700"
            />
            <div>
              <span className="block font-semibold text-slate-800 dark:text-slate-100">
                Assign as Class In-charge
              </span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Grants primary class attendance &amp; homeroom oversight in the Teacher Portal.
              </span>
            </div>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setAssignOpen(false)}
              disabled={submittingAssign}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingAssign}
              className="rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {submittingAssign ? 'Assigning...' : 'Save Assignment'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Edit Assignment Modal */}
      <ModalDialog
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title={`Edit Assignment — ${editTarget?.teacherName ?? ''}`}
        subtitle={editTarget ? `Employee Code: ${editTarget.employeeCode}` : undefined}
      >
        <form onSubmit={handleEditSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={fieldLabelClass}>Class *</label>
              <select
                required
                value={editClassId}
                onChange={(e) => {
                  setEditClassId(e.target.value);
                  setEditSectionId('');
                }}
                className={`${selectClass} w-full`}
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={fieldLabelClass}>Section</label>
              <select
                value={editSectionId}
                onChange={(e) => setEditSectionId(e.target.value)}
                className={`${selectClass} w-full`}
              >
                <option value="">All Sections</option>
                {editClassSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={fieldLabelClass}>Subject</label>
            <select
              value={editSubjectId}
              onChange={(e) => setEditSubjectId(e.target.value)}
              className={`${selectClass} w-full`}
            >
              <option value="">General / All Subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.code ? `(${s.code})` : ''}
                </option>
              ))}
            </select>
          </div>

          {sessions.length > 0 && (
            <div>
              <label className={fieldLabelClass}>Academic Session</label>
              <select
                value={editSessionId}
                onChange={(e) => setEditSessionId(e.target.value)}
                className={`${selectClass} w-full`}
              >
                <option value="">No specific session</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.is_current ? '(Current)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={editIsIncharge}
              onChange={(e) => setEditIsIncharge(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded accent-teal-700"
            />
            <div>
              <span className="block font-semibold text-slate-800 dark:text-slate-100">
                Class In-charge
              </span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Toggle primary class in-charge status for this allocation.
              </span>
            </div>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setEditTarget(null)}
              disabled={submittingEdit}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingEdit}
              className="rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {submittingEdit ? 'Updating...' : 'Update Assignment'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Unassign Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(confirmTarget)}
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => void handleConfirmUnassign()}
        title="Confirm Unassign"
        message={confirmMessage}
        confirmLabel="Yes, Unassign"
        danger
        loading={submittingDelete}
      />
    </div>
  );
}
