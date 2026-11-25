'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { WebcamPhotoCapture } from '@/components/dashboard/webcam-capture';
import { useToast } from '@/components/providers/toast-provider';
import {
  generateAdmissionLetterPdf,
  generateStudentIdCardPdf,
} from '@/lib/pdf/generators';
import { fileToOptimizedDataUrl } from '@/lib/utils/image-data-url';
import { Loader2, Plus, Trash2 } from 'lucide-react';

interface StudentRow {
  id: string;
  admission_number: string;
  roll_number: string | null;
  name_en: string;
  name_ur: string | null;
  father_name: string;
  mother_name: string | null;
  father_cnic: string | null;
  b_form_number: string | null;
  gender: 'Male' | 'Female' | 'Other';
  date_of_birth: string | null;
  parent_mobile: string | null;
  parent_email: string | null;
  student_email: string | null;
  emergency_contact: string | null;
  province: string | null;
  district: string | null;
  tehsil: string | null;
  village: string | null;
  complete_address: string | null;
  previous_school: string | null;
  admission_date: string;
  academic_session_id: string | null;
  class_id: string | null;
  section_id: string | null;
  admission_fee_pkr: number;
  monthly_fee_pkr: number;
  discount_pkr: number;
  scholarship_note: string | null;
  photo_url: string | null;
  student_id?: string | null;
  qr_token: string | null;
  status: 'active' | 'inactive' | 'graduated' | 'transferred' | 'withdrawn';
}

interface EditProfileForm {
  admission_number: string;
  roll_number: string;
  name_en: string;
  name_ur: string;
  father_name: string;
  mother_name: string;
  father_cnic: string;
  b_form_number: string;
  date_of_birth: string;
  gender: 'Male' | 'Female' | 'Other';
  parent_mobile: string;
  parent_email: string;
  student_email: string;
  emergency_contact: string;
  province: string;
  district: string;
  tehsil: string;
  village: string;
  complete_address: string;
  previous_school: string;
  admission_date: string;
  academic_session_id: string;
  class_id: string;
  section_id: string;
  admission_fee_pkr: string;
  monthly_fee_pkr: string;
  discount_pkr: string;
  scholarship_note: string;
  status: 'active' | 'inactive' | 'graduated' | 'transferred' | 'withdrawn';
}

const EMPTY_EDIT_FORM: EditProfileForm = {
  admission_number: '',
  roll_number: '',
  name_en: '',
  name_ur: '',
  father_name: '',
  mother_name: '',
  father_cnic: '',
  b_form_number: '',
  date_of_birth: '',
  gender: 'Male',
  parent_mobile: '',
  parent_email: '',
  student_email: '',
  emergency_contact: '',
  province: 'Punjab',
  district: '',
  tehsil: '',
  village: '',
  complete_address: '',
  previous_school: '',
  admission_date: '',
  academic_session_id: '',
  class_id: '',
  section_id: '',
  admission_fee_pkr: '0',
  monthly_fee_pkr: '0',
  discount_pkr: '0',
  scholarship_note: '',
  status: 'active',
};

export default function StudentsPage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [sections, setSections] = useState<Array<{ id: string; name: string; class_id: string }>>([]);
  const [sessions, setSessions] = useState<Array<{ id: string; name: string }>>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [classFilter, setClassFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedStudent, setSelectedStudent] = useState<StudentRow | null>(null);
  const [historyRows, setHistoryRows] = useState<
    Array<{ id: string; event_type: string; notes: string | null; created_at: string }>
  >([]);
  const [actionModal, setActionModal] = useState<{
    student: StudentRow;
    mode: 'edit' | 'promote' | 'transfer' | 'withdraw';
  } | null>(null);

  const [targetClassId, setTargetClassId] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [editForm, setEditForm] = useState<EditProfileForm>(EMPTY_EDIT_FORM);
  const [editPhotoPreview, setEditPhotoPreview] = useState<string | null>(null);
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/students', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to load students', description: data.error, variant: 'error' });
        setLoading(false);
        return;
      }
      setStudents(data.students ?? []);
      setClasses(data.classes ?? []);
      setSections(data.sections ?? []);
      setSessions(data.sessions ?? []);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);
  const sectionMap = useMemo(() => new Map(sections.map((s) => [s.id, s.name])), [sections]);
  const sessionMap = useMemo(() => new Map(sessions.map((s) => [s.id, s.name])), [sessions]);

  const openProfile = async (stu: StudentRow) => {
    setSelectedStudent(stu);
    const res = await fetch(`/api/students?historyStudentId=${encodeURIComponent(stu.id)}`, {
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    setHistoryRows(data.history ?? []);
  };

  const openEditModal = (stu: StudentRow) => {
    const normalizedStatus = (stu.status || 'active').toLowerCase() as EditProfileForm['status'];
    const normalizedGender =
      stu.gender === 'Female' || stu.gender === 'Other' ? stu.gender : 'Male';

    setEditForm({
      admission_number: stu.admission_number || '',
      roll_number: stu.roll_number || '',
      name_en: stu.name_en || '',
      name_ur: stu.name_ur || '',
      father_name: stu.father_name || '',
      mother_name: stu.mother_name || '',
      father_cnic: stu.father_cnic || '',
      b_form_number: stu.b_form_number || '',
      date_of_birth: stu.date_of_birth || '',
      gender: normalizedGender,
      parent_mobile: stu.parent_mobile || '',
      parent_email: stu.parent_email || '',
      student_email: stu.student_email || '',
      emergency_contact: stu.emergency_contact || '',
      province: stu.province || 'Punjab',
      district: stu.district || '',
      tehsil: stu.tehsil || '',
      village: stu.village || '',
      complete_address: stu.complete_address || '',
      previous_school: stu.previous_school || '',
      admission_date: stu.admission_date || '',
      academic_session_id: stu.academic_session_id || '',
      class_id: stu.class_id || '',
      section_id: stu.section_id || '',
      admission_fee_pkr: String(Number(stu.admission_fee_pkr || 0)),
      monthly_fee_pkr: String(Number(stu.monthly_fee_pkr || 0)),
      discount_pkr: String(Number(stu.discount_pkr || 0)),
      scholarship_note: stu.scholarship_note || '',
      status: ['active', 'inactive', 'graduated', 'transferred', 'withdrawn'].includes(normalizedStatus)
        ? normalizedStatus
        : 'active',
    });
    setEditPhotoPreview(stu.photo_url || null);
    setEditPhotoFile(null);
    setRemovePhoto(false);
    setActionModal({ student: stu, mode: 'edit' });
  };

  const handleLifecycleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionModal) return;

    const { student, mode } = actionModal;
    setSaving(true);
    try {
      let photoDataUrl: string | null = null;
      if (mode === 'edit' && editPhotoFile && !removePhoto) {
        photoDataUrl = await fileToOptimizedDataUrl(editPhotoFile);
      }

      const payload =
        mode === 'edit'
          ? {
              action: 'update_profile',
              student_id: student.id,
              admission_number: editForm.admission_number,
              roll_number: editForm.roll_number || null,
              name_en: editForm.name_en,
              name_ur: editForm.name_ur || null,
              father_name: editForm.father_name || null,
              mother_name: editForm.mother_name || null,
              father_cnic: editForm.father_cnic || null,
              b_form_number: editForm.b_form_number || null,
              date_of_birth: editForm.date_of_birth || null,
              gender: editForm.gender,
              parent_mobile: editForm.parent_mobile || null,
              parent_email: editForm.parent_email || null,
              student_email: editForm.student_email || null,
              emergency_contact: editForm.emergency_contact || null,
              province: editForm.province || null,
              district: editForm.district || null,
              tehsil: editForm.tehsil || null,
              village: editForm.village || null,
              complete_address: editForm.complete_address || null,
              previous_school: editForm.previous_school || null,
              admission_date: editForm.admission_date || null,
              academic_session_id: editForm.academic_session_id || null,
              class_id: editForm.class_id || null,
              section_id: editForm.section_id || null,
              admission_fee_pkr: Number(editForm.admission_fee_pkr || 0),
              monthly_fee_pkr: Number(editForm.monthly_fee_pkr || 0),
              discount_pkr: Number(editForm.discount_pkr || 0),
              scholarship_note: editForm.scholarship_note || null,
              status: editForm.status,
              photo_data_url: photoDataUrl,
              remove_photo: removePhoto,
            }
          : mode === 'promote'
            ? {
                action: 'promote',
                student_id: student.id,
                class_id: targetClassId || student.class_id,
                notes: actionNote || null,
              }
            : {
                action: mode,
                student_id: student.id,
                notes: actionNote || null,
              };

      const res = await fetch('/api/students', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Update failed', description: data.error, variant: 'error' });
        return;
      }

      toast({ title: 'Student profile updated', variant: 'success' });
      if (selectedStudent?.id === student.id && data.student) {
        setSelectedStudent(data.student);
      }
      setActionModal(null);
      setEditPhotoFile(null);
      void loadData();
    } catch (err) {
      toast({
        title: 'Photo processing failed',
        description: err instanceof Error ? err.message : 'Unable to prepare student photo.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const filtered = students.filter((s) => {
    if (statusFilter !== 'All' && s.status.toLowerCase() !== statusFilter.toLowerCase()) return false;
    if (classFilter !== 'All' && s.class_id !== classFilter) return false;
    return true;
  });

  const editAvailableSections = sections.filter((s) => s.class_id === editForm.class_id);

  const columns: TableColumn<StudentRow>[] = [
    {
      key: 'adm',
      header: 'Adm No / Student ID',
      render: (r) => (
        <div>
          <p className="font-mono-tabular font-semibold text-slate-900 dark:text-white">{r.admission_number}</p>
          {r.student_id && <p className="font-mono-tabular text-[11px] text-teal-700 dark:text-teal-400">ID: {r.student_id}</p>}
        </div>
      ),
      exportValue: (r) => `${r.admission_number}${r.student_id ? ` / ${r.student_id}` : ''}`,
    },
    {
      key: 'name',
      header: 'Student Name',
      render: (r) => (
        <div className="flex items-center gap-2.5">
          {r.photo_url ? (
            <img
              src={r.photo_url}
              alt={r.name_en}
              referrerPolicy="no-referrer"
              className="h-9 w-9 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-900 text-[11px] font-bold text-teal-700 dark:text-teal-300">
              {r.name_en
                .split(' ')
                .slice(0, 2)
                .map((p) => p[0] || '')
                .join('')
                .toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">{r.name_en}</p>
            {r.name_ur && <p className="text-[11px] text-slate-500">{r.name_ur}</p>}
            {r.student_email && (
              <p className="font-mono-tabular text-[11px] text-slate-500">{r.student_email}</p>
            )}
          </div>
        </div>
      ),
      exportValue: (r) => r.name_en,
    },
    {
      key: 'class',
      header: 'Class / Section',
      render: (r) =>
        `${(r.class_id && classMap.get(r.class_id)) || '—'}${
          r.section_id && sectionMap.get(r.section_id) ? ` (${sectionMap.get(r.section_id)})` : ''
        }`,
      exportValue: (r) => (r.class_id && classMap.get(r.class_id)) || '',
    },
    {
      key: 'bform',
      header: 'B-Form',
      render: (r) => <span className="font-mono-tabular">{r.b_form_number || '—'}</span>,
      exportValue: (r) => r.b_form_number || '',
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <span className="font-medium capitalize">{r.status}</span>,
      exportValue: (r) => r.status,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <button
            type="button"
            onClick={() => openProfile(r)}
            className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Profile
          </button>
          <button
            type="button"
            onClick={() => openEditModal(r)}
            className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() =>
              generateStudentIdCardPdf(
                { nameEn: school.name_en, address: school.address, city: school.city, phone: school.phone },
                {
                  admission_no: r.admission_number,
                  roll_no: r.roll_number,
                  student_id: r.student_id,
                  name_en: r.name_en,
                  qr_token: r.qr_token,
                  photo_url: r.photo_url,
                  b_form: r.b_form_number,
                  emergency_contact: r.emergency_contact,
                  className: (r.class_id && classMap.get(r.class_id)) || undefined,
                  sectionName: (r.section_id && sectionMap.get(r.section_id)) || undefined,
                }
              )
            }
            className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ID Card PDF
          </button>
          <button
            type="button"
            onClick={() =>
              generateAdmissionLetterPdf(
                { nameEn: school.name_en, address: school.address, city: school.city, phone: school.phone },
                {
                  admission_no: r.admission_number,
                  name_en: r.name_en,
                  admission_date: r.admission_date,
                  b_form: r.b_form_number,
                  gender: r.gender,
                  address: r.complete_address,
                  className: (r.class_id && classMap.get(r.class_id)) || undefined,
                  sectionName: (r.section_id && sectionMap.get(r.section_id)) || undefined,
                }
              )
            }
            className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Letter PDF
          </button>
          <button
            type="button"
            onClick={() => {
              setTargetClassId(r.class_id || '');
              setActionNote('');
              setActionModal({ student: r, mode: 'promote' });
            }}
            className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Promote
          </button>
          <Link
            href="/dashboard/app-access/students"
            className="rounded border border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 px-2 py-1 text-[11px] font-semibold hover:bg-teal-100"
          >
            App QR
          </Link>
          <Link
            href="/dashboard/parents"
            className="rounded border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 px-2 py-1 text-[11px] font-semibold hover:bg-purple-100"
          >
            Guardians
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Student Directory"
        subtitle="Manage full student profiles, promotions, transfers, withdrawals, and PDF identity documents."
        rows={filtered}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) =>
          `${r.admission_number} ${r.student_id || ''} ${r.name_en} ${r.student_email || ''} ${r.father_name || ''} ${r.b_form_number || ''} ${r.roll_number || ''}`
        }
        exportFileName="students-directory"
        primaryAction={
          <Link
            href="/dashboard/admissions"
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            New Admission
          </Link>
        }
        filters={
          <>
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            >
              <option value="All">All Classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            >
              <option value="All">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="graduated">Graduated</option>
              <option value="transferred">Transferred</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </>
        }
      />

      <ModalDialog
        open={Boolean(selectedStudent)}
        onClose={() => setSelectedStudent(null)}
        title={selectedStudent?.name_en || 'Student Profile'}
        subtitle={selectedStudent ? `Admission No: ${selectedStudent.admission_number}` : undefined}
        maxWidthClass="max-w-2xl"
      >
        {selectedStudent && (
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3.5">
              {selectedStudent.photo_url ? (
                <img
                  src={selectedStudent.photo_url}
                  alt={selectedStudent.name_en}
                  referrerPolicy="no-referrer"
                  className="h-20 w-20 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-900 text-lg font-bold text-teal-700 dark:text-teal-300">
                  {selectedStudent.name_en
                    .split(' ')
                    .slice(0, 2)
                    .map((p) => p[0] || '')
                    .join('')
                    .toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-display text-base font-bold text-slate-900 dark:text-white">
                    {selectedStudent.name_en}
                  </p>
                  <span className="rounded bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-900 px-2 py-0.5 text-[10px] font-semibold capitalize text-teal-700 dark:text-teal-300">
                    {selectedStudent.status}
                  </span>
                </div>
                {selectedStudent.name_ur && (
                  <p className="text-xs text-slate-500" dir="rtl">
                    {selectedStudent.name_ur}
                  </p>
                )}
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Adm No: <span className="font-mono-tabular font-semibold">{selectedStudent.admission_number}</span>
                  {selectedStudent.student_id ? (
                    <>
                      {' · '}Student ID: <span className="font-mono-tabular font-semibold text-teal-700 dark:text-teal-400">{selectedStudent.student_id}</span>
                    </>
                  ) : null}
                  {' · '}
                  Class:{' '}
                  <span className="font-semibold">
                    {(selectedStudent.class_id && classMap.get(selectedStudent.class_id)) || '—'}
                    {selectedStudent.section_id && sectionMap.get(selectedStudent.section_id)
                      ? ` (${sectionMap.get(selectedStudent.section_id)})`
                      : ''}
                  </span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-slate-500">Student ID:</span> <span className="font-mono-tabular font-semibold">{selectedStudent.student_id || '—'}</span></div>
              <div><span className="text-slate-500">Roll No:</span> {selectedStudent.roll_number || '—'}</div>
              <div><span className="text-slate-500">Urdu Name:</span> {selectedStudent.name_ur || '—'}</div>
              <div><span className="text-slate-500">Father Name:</span> {selectedStudent.father_name || '—'}</div>
              <div><span className="text-slate-500">Mother Name:</span> {selectedStudent.mother_name || '—'}</div>
              <div><span className="text-slate-500">Father CNIC:</span> {selectedStudent.father_cnic || '—'}</div>
              <div><span className="text-slate-500">B-Form:</span> {selectedStudent.b_form_number || '—'}</div>
              <div><span className="text-slate-500">DOB:</span> {selectedStudent.date_of_birth || '—'}</div>
              <div><span className="text-slate-500">Gender:</span> {selectedStudent.gender}</div>
              <div>
                <span className="text-slate-500">Class / Section:</span>{' '}
                {(selectedStudent.class_id && classMap.get(selectedStudent.class_id)) || '—'}
                {selectedStudent.section_id && sectionMap.get(selectedStudent.section_id)
                  ? ` (${sectionMap.get(selectedStudent.section_id)})`
                  : ''}
              </div>
              <div>
                <span className="text-slate-500">Session:</span>{' '}
                {(selectedStudent.academic_session_id &&
                  sessionMap.get(selectedStudent.academic_session_id)) ||
                  '—'}
              </div>
              <div><span className="text-slate-500">Parent Mobile:</span> {selectedStudent.parent_mobile || '—'}</div>
              <div><span className="text-slate-500">Emergency:</span> {selectedStudent.emergency_contact || '—'}</div>
              <div><span className="text-slate-500">Parent Email:</span> {selectedStudent.parent_email || '—'}</div>
              <div><span className="text-slate-500">Student Email:</span> {selectedStudent.student_email || '—'}</div>
              <div>
                <span className="text-slate-500">Monthly Fee:</span> PKR{' '}
                {Number(selectedStudent.monthly_fee_pkr || 0).toLocaleString()}
              </div>
              <div>
                <span className="text-slate-500">Discount:</span> PKR{' '}
                {Number(selectedStudent.discount_pkr || 0).toLocaleString()}
              </div>
              <div className="col-span-2">
                <span className="text-slate-500">Address:</span> {selectedStudent.complete_address || '—'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-semibold text-xs text-slate-900 dark:text-white">Mobile App Access & Guardians</h4>
                  <p className="text-[11px] text-slate-500">Universal Student App access & multi-child guardian linking</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Link
                    href="/dashboard/app-access/students"
                    className="rounded bg-teal-700 hover:bg-teal-800 text-white px-2.5 py-1 text-[11px] font-semibold"
                  >
                    Student App QR
                  </Link>
                  <Link
                    href="/dashboard/parents"
                    className="rounded border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 px-2.5 py-1 text-[11px] font-semibold hover:bg-purple-100"
                  >
                    Linked Guardians
                  </Link>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => {
                  const target = selectedStudent;
                  setSelectedStudent(null);
                  openEditModal(target);
                }}
                className="rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white"
              >
                Edit Full Profile
              </button>
              <button
                type="button"
                onClick={() => {
                  setActionNote('');
                  setActionModal({ student: selectedStudent, mode: 'transfer' });
                  setSelectedStudent(null);
                }}
                className="rounded-lg border border-amber-300 px-3 py-1.5 font-semibold text-amber-700 dark:text-amber-300"
              >
                Transfer Student
              </button>
              <button
                type="button"
                onClick={() => {
                  setActionNote('');
                  setActionModal({ student: selectedStudent, mode: 'withdraw' });
                  setSelectedStudent(null);
                }}
                className="rounded-lg border border-red-300 px-3 py-1.5 font-semibold text-red-700 dark:text-red-300"
              >
                Withdraw Student
              </button>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
              <p className="font-semibold text-slate-800 dark:text-slate-200">Student History</p>
              {historyRows.length === 0 ? (
                <p className="mt-1 text-slate-500">No history events recorded.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {historyRows.map((h) => (
                    <li key={h.id} className="flex justify-between">
                      <span>
                        {h.event_type} · {h.notes}
                      </span>
                      <span className="font-mono-tabular text-slate-400">
                        {new Date(h.created_at).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </ModalDialog>

      <ModalDialog
        open={Boolean(actionModal)}
        onClose={() => setActionModal(null)}
        maxWidthClass={actionModal?.mode === 'edit' ? 'max-w-4xl' : 'max-w-xl'}
        title={
          actionModal?.mode === 'edit'
            ? `Edit Full Student Profile — ${actionModal.student.name_en}`
            : actionModal?.mode === 'promote'
              ? 'Promote Student'
              : actionModal?.mode === 'transfer'
                ? 'Transfer Student'
                : 'Withdraw Student'
        }
        subtitle={
          actionModal?.mode === 'edit'
            ? `Admission No: ${actionModal.student.admission_number}`
            : undefined
        }
      >
        {actionModal && (
          <form onSubmit={handleLifecycleSubmit} className="space-y-5 text-xs">
            {actionModal.mode === 'edit' && (
              <>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      01. Student Photo & Identification
                    </p>
                    {editPhotoPreview && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditPhotoPreview(null);
                          setEditPhotoFile(null);
                          setRemovePhoto(true);
                        }}
                        className="inline-flex items-center gap-1 rounded border border-red-200 dark:border-red-900 px-2.5 py-1 text-[11px] font-semibold text-red-600 dark:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove Photo
                      </button>
                    )}
                  </div>
                  <WebcamPhotoCapture
                    valueUrl={editPhotoPreview}
                    onCaptureFile={(file, preview) => {
                      setEditPhotoFile(file);
                      setEditPhotoPreview(preview);
                      setRemovePhoto(false);
                    }}
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-2">
                    <EditField
                      label="Admission Number *"
                      required
                      value={editForm.admission_number}
                      onChange={(v) => setEditForm({ ...editForm, admission_number: v })}
                    />
                    <EditField
                      label="Roll Number"
                      value={editForm.roll_number}
                      onChange={(v) => setEditForm({ ...editForm, roll_number: v })}
                    />
                    <EditField
                      label="B-Form / CRC Number"
                      value={editForm.b_form_number}
                      onChange={(v) => setEditForm({ ...editForm, b_form_number: v })}
                    />
                    <EditField
                      label="Student Name (English) *"
                      required
                      value={editForm.name_en}
                      onChange={(v) => setEditForm({ ...editForm, name_en: v })}
                    />
                    <EditField
                      label="Student Name (Urdu)"
                      dir="rtl"
                      value={editForm.name_ur}
                      onChange={(v) => setEditForm({ ...editForm, name_ur: v })}
                    />
                    <div>
                      <label className="block font-medium">Gender</label>
                      <select
                        value={editForm.gender}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            gender: e.target.value as EditProfileForm['gender'],
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                      >
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <EditField
                      label="Date of Birth"
                      type="date"
                      value={editForm.date_of_birth}
                      onChange={(v) => setEditForm({ ...editForm, date_of_birth: v })}
                    />
                    <EditField
                      label="Admission Date"
                      type="date"
                      value={editForm.admission_date}
                      onChange={(v) => setEditForm({ ...editForm, admission_date: v })}
                    />
                    <div>
                      <label className="block font-medium">Status</label>
                      <select
                        value={editForm.status}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            status: e.target.value as EditProfileForm['status'],
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="graduated">Graduated</option>
                        <option value="transferred">Transferred</option>
                        <option value="withdrawn">Withdrawn</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    02. Academic Placement
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="block font-medium">Academic Session</label>
                      <select
                        value={editForm.academic_session_id}
                        onChange={(e) =>
                          setEditForm({ ...editForm, academic_session_id: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                      >
                        <option value="">Select Session</option>
                        {sessions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium">Class</label>
                      <select
                        value={editForm.class_id}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            class_id: e.target.value,
                            section_id: '',
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
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
                      <label className="block font-medium">Section</label>
                      <select
                        value={editForm.section_id}
                        onChange={(e) =>
                          setEditForm({ ...editForm, section_id: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                      >
                        <option value="">Select Section</option>
                        {editAvailableSections.map((sec) => (
                          <option key={sec.id} value={sec.id}>
                            {sec.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <EditField
                      label="Previous School"
                      value={editForm.previous_school}
                      onChange={(v) => setEditForm({ ...editForm, previous_school: v })}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    03. Parent / Guardian & Contact Information
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <EditField
                      label="Father Name"
                      value={editForm.father_name}
                      onChange={(v) => setEditForm({ ...editForm, father_name: v })}
                    />
                    <EditField
                      label="Mother Name"
                      value={editForm.mother_name}
                      onChange={(v) => setEditForm({ ...editForm, mother_name: v })}
                    />
                    <EditField
                      label="Father CNIC"
                      value={editForm.father_cnic}
                      onChange={(v) => setEditForm({ ...editForm, father_cnic: v })}
                    />
                    <EditField
                      label="Parent Mobile"
                      value={editForm.parent_mobile}
                      onChange={(v) => setEditForm({ ...editForm, parent_mobile: v })}
                    />
                    <EditField
                      label="Emergency Contact"
                      value={editForm.emergency_contact}
                      onChange={(v) => setEditForm({ ...editForm, emergency_contact: v })}
                    />
                    <EditField
                      label="Parent Email"
                      type="email"
                      value={editForm.parent_email}
                      onChange={(v) => setEditForm({ ...editForm, parent_email: v })}
                    />
                    <div className="sm:col-span-3">
                      <EditField
                        label="Student Email (Portal / App Login)"
                        type="email"
                        value={editForm.student_email}
                        onChange={(v) => setEditForm({ ...editForm, student_email: v })}
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    04. Residential Address
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <EditField
                      label="Province"
                      value={editForm.province}
                      onChange={(v) => setEditForm({ ...editForm, province: v })}
                    />
                    <EditField
                      label="District / City"
                      value={editForm.district}
                      onChange={(v) => setEditForm({ ...editForm, district: v })}
                    />
                    <EditField
                      label="Tehsil"
                      value={editForm.tehsil}
                      onChange={(v) => setEditForm({ ...editForm, tehsil: v })}
                    />
                    <EditField
                      label="Village / Town"
                      value={editForm.village}
                      onChange={(v) => setEditForm({ ...editForm, village: v })}
                    />
                    <div className="sm:col-span-4">
                      <EditField
                        label="Complete Address"
                        value={editForm.complete_address}
                        onChange={(v) => setEditForm({ ...editForm, complete_address: v })}
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    05. Fee Structure & Scholarship
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <EditField
                      label="Monthly Fee (PKR)"
                      type="number"
                      value={editForm.monthly_fee_pkr}
                      onChange={(v) => setEditForm({ ...editForm, monthly_fee_pkr: v })}
                    />
                    <EditField
                      label="Admission Fee (PKR)"
                      type="number"
                      value={editForm.admission_fee_pkr}
                      onChange={(v) => setEditForm({ ...editForm, admission_fee_pkr: v })}
                    />
                    <EditField
                      label="Monthly Discount (PKR)"
                      type="number"
                      value={editForm.discount_pkr}
                      onChange={(v) => setEditForm({ ...editForm, discount_pkr: v })}
                    />
                    <EditField
                      label="Scholarship / Concession Note"
                      value={editForm.scholarship_note}
                      onChange={(v) => setEditForm({ ...editForm, scholarship_note: v })}
                    />
                  </div>
                </div>
              </>
            )}

            {actionModal.mode === 'promote' && (
              <div>
                <label className="block font-medium">Target Class</label>
                <select
                  value={targetClassId}
                  onChange={(e) => setTargetClassId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {actionModal.mode !== 'edit' && (
              <div>
                <label className="block font-medium">Remarks / Reason</label>
                <textarea
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save Changes
              </button>
            </div>
          </form>
        )}
      </ModalDialog>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  dir,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  type?: string;
  required?: boolean;
  dir?: 'rtl' | 'ltr';
}) {
  return (
    <div>
      <label className="block font-medium">{label}</label>
      <input
        type={type}
        required={required}
        dir={dir}
        min={type === 'number' ? 0 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
      />
    </div>
  );
}
