
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { canAddTeacher } from '@/lib/subscription/entitlements';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { WebcamPhotoCapture } from '@/components/dashboard/webcam-capture';
import { useToast } from '@/components/providers/toast-provider';
import { CheckCircle2, Clock, Download, Plus, QrCode, RefreshCw } from 'lucide-react';
import { extractTeacherProfileMeta, type StaffGender } from '@/lib/staff/profile-meta';

// --- SIRF YE FUNCTION ADD KIYA HAI - BAAKI KUCH NAHI KATA ---
async function compressStaffPhoto(file: File): Promise<File> {
  if (file.size <= 200 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxSize = 600;
    let { width, height } = bitmap;
    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    let quality = 0.82;
    let blob: Blob | null = null;
    for (let i = 0; i < 4; i++) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
      if (!blob) break;
      if (blob.size <= 200 * 1024 || quality <= 0.4) break;
      quality -= 0.15;
    }
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}

interface StaffRow {
  id: string;
  employee_code: string;
  full_name: string;
  father_name?: string | null;
  date_of_birth?: string | null;
  gender?: StaffGender | null;
  documents?: unknown;
  cnic: string;
  mobile_number: string;
  email: string | null;
  qualification: string | null;
  experience_years: number;
  address: string | null;
  joining_date: string;
  designation: string;
  department: string;
  salary_pkr: number;
  status: string;
  photo_url: string | null;
  user_id?: string | null;
  app_access_enabled?: boolean;
  app_blocked?: boolean;
}

export default function TeachersStaffPage() {
  const { school, entitlements } = useSchool();
  const { toast } = useToast();

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [sections, setSections] = useState<Array<{ id: string; name: string; class_id: string }>>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([]);
  
  // NEW: State to hold subjects filtered specifically for the selected class
  const [classSubjects, setClassSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  const [openAdd, setOpenAdd] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [assignModal, setAssignModal] = useState<StaffRow | null>(null);
  const [assignForm, setAssignForm] = useState({ class_id: '', section_id: '', subject_id: '', is_class_incharge: false });
  const [leaveModal, setLeaveModal] = useState<StaffRow | null>(null);
  const [leaveForm, setLeaveForm] = useState({
    leave_type: 'Casual',
    start_date: '',
    end_date: '',
    reason: '',
    initialStatus: 'Pending' as 'Pending' | 'Approved',
  });
  const [editStaff, setEditStaff] = useState<StaffRow | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    father_name: '',
    date_of_birth: '',
    gender: 'Male' as StaffGender,
    cnic: '',
    phone: '',
    email: '',
    qualification: '',
    designation: 'Teacher',
    department: 'Academics',
    base_salary: '0',
    status: 'active',
  });

  const [loadingCode, setLoadingCode] = useState(false);
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [qrGeneratingId, setQrGeneratingId] = useState<string | null>(null);
  const [staffQrModal, setStaffQrModal] = useState<{
    teacherName: string;
    employeeCode: string;
    qrDataUrl: string;
    tokenPreview: string;
    expiresAt: string;
    schoolName: string;
    appLinked?: boolean;
    authEmail?: string | null;
    pinSet?: boolean;
    passwordSet?: boolean;
  } | null>(null);

  const createInitialForm = () => ({
    employee_code: '',
    name: '',
    father_name: '',
    date_of_birth: '',
    gender: 'Male' as StaffGender,
    cnic: '',
    phone: '',
    email: '',
    qualification: '',
    experience_years: '0',
    address: '',
    joining_date: new Date().toISOString().slice(0, 10),
    designation: 'Teacher',
    department: 'Academics',
    is_teaching_staff: true,
    base_salary: '35000',
    auto_app_access: true,
    app_password: '',
    app_pin: '',
  });

  const [form, setForm] = useState(createInitialForm);

  const fetchNextEmployeeCode = useCallback(async () => {
    setLoadingCode(true);
    try {
      const res = await fetch('/api/teachers?nextEmployeeCode=1', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.employeeCode) {
        setForm((prev) => ({ ...prev, employee_code: data.employeeCode }));
        setCodeManuallyEdited(false);
      }
    } finally {
      setLoadingCode(false);
    }
  }, []);

  const openAddModal = () => {
    setForm(createInitialForm());
    setPhotoFile(null);
    setPhotoPreview(null);
    setCodeManuallyEdited(false);
    setOpenAdd(true);
    void fetchNextEmployeeCode();
  };

  const loadData = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    
    const [{ data: tRows }, { data: cRows }, { data: sRows }, { data: subRows }] = await Promise.all([
      supabase.from('teachers').select('*').eq('school_id', school.id).order('created_at', { ascending: false }),
      supabase.from('classes').select('id, name').eq('school_id', school.id),
      supabase.from('sections').select('id, name, class_id').eq('school_id', school.id),
      supabase.from('subjects').select('id, name').eq('school_id', school.id),
    ]);
    setStaff(
      ((tRows ?? []) as StaffRow[]).map((row) => ({
        ...row,
        ...extractTeacherProfileMeta(row),
      }))
    );
    setClasses(cRows ?? []);
    setSections(sRows ?? []);
    setSubjects(subRows ?? []);
    setLoading(false);
  }, [school.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  // NEW: Fetch subjects for the selected class from class_subjects mapping table
  useEffect(() => {
    if (assignForm.class_id && subjects.length > 0) {
      const fetchClassSubjects = async () => {
        const supabase = createSupabaseBrowserClient();
        if (!supabase) return;
        
        // Fetch subject_ids linked to this class
        const { data, error } = await supabase
          .from('class_subjects')
          .select('subject_id')
          .eq('class_id', assignForm.class_id)
          .eq('school_id', school.id);
        
        if (!error && data) {
          const subjectIds = (data as Array<{ subject_id: string }>).map((item) => item.subject_id);
          // Filter the main subjects list to only show those linked to this class
          const filtered = subjects.filter((sub) => subjectIds.includes(sub.id));
          setClassSubjects(filtered);
        } else {
          setClassSubjects([]);
        }
      };
      void fetchClassSubjects();
    } else {
      queueMicrotask(() => {
        setClassSubjects([]);
      });
    }
  }, [assignForm.class_id, subjects, school.id]);

  const limitCheck = canAddTeacher(entitlements);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!limitCheck.allowed) {
      toast({ title: 'Staff limit reached', description: limitCheck.reason, variant: 'error' });
      return;
    }

    let uploadedUrl = '';
    if (photoFile) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        const compressedFile = await compressStaffPhoto(photoFile);
        const path = `${school.id}/staff-${Date.now()}.webp`;
        const { error: upErr } = await supabase.storage.from('documents').upload(path, compressedFile, { upsert: true });
        if (!upErr) {
          const { data: signed } = await supabase.storage
            .from('documents')
            .createSignedUrl(path, 60 * 60 * 24 * 365);
          if (signed?.signedUrl) {
            uploadedUrl = signed.signedUrl;
          }
        }
      }
    }

    const res = await fetch('/api/teachers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        auto_generate_code: !codeManuallyEdited || !form.employee_code.trim(),
        experience_years: Number(form.experience_years),
        base_salary: Number(form.base_salary),
        photo_url: uploadedUrl || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ title: 'Unable to save staff', description: data.error, variant: 'error' });
      return;
    }
    const assignedCode = data.teacher?.employee_code || form.employee_code;
    const appAccessLinked = Boolean(data.appAccess?.linked || data.teacher?.user_id);
    toast({
      title: 'Staff member saved',
      description: [
        assignedCode ? `Code: ${assignedCode}` : null,
        form.auto_app_access
          ? appAccessLinked
            ? 'Teacher App access created automatically'
            : data.appAccess?.error || 'App access pending'
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
      variant: data.appAccess?.error ? 'error' : 'success',
    });
    setOpenAdd(false);
    setForm(createInitialForm());
    setPhotoFile(null);
    setPhotoPreview(null);
    setCodeManuallyEdited(false);
    if (data.activationQr?.qrDataUrl && data.teacher) {
      setStaffQrModal({
        teacherName: data.teacher.full_name || form.name,
        employeeCode: assignedCode || '',
        qrDataUrl: data.activationQr.qrDataUrl,
        tokenPreview: data.activationQr.tokenPreview || '',
        expiresAt: data.activationQr.expiresAt || '',
        schoolName: data.activationQr.schoolName || school.name_en,
        appLinked: appAccessLinked,
        authEmail: data.appAccess?.authEmail || data.teacher.email || null,
        pinSet: Boolean(data.appAccess?.pinSet),
        passwordSet: Boolean(data.appAccess?.passwordSet),
      });
    }
    loadData();
  };

  const handleOpenStaffQr = async (row: StaffRow) => {
    setQrGeneratingId(row.id);
    try {
      const res = await fetch('/api/app-access/qr/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'teacher',
          targetId: row.id,
          purpose: 'teacher_first_activation',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.qrDataUrl) {
        toast({
          title: 'QR Generation failed',
          description: data.error || 'Unable to generate valid Teacher App QR.',
          variant: 'error',
        });
        return;
      }
      setStaffQrModal({
        teacherName: row.full_name,
        employeeCode: row.employee_code,
        qrDataUrl: data.qrDataUrl,
        tokenPreview: data.tokenPreview || '',
        expiresAt: data.expiresAt || '',
        schoolName: data.target?.schoolName || school.name_en,
      });
      void loadData();
    } finally {
      setQrGeneratingId(null);
    }
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignModal) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.from('teacher_assignments').insert({
      school_id: school.id,
      teacher_id: assignModal.id,
      class_id: assignForm.class_id,
      section_id: assignForm.section_id || null,
      subject_id: assignForm.subject_id || null,
      is_class_incharge: assignForm.is_class_incharge,
    });
    if (error) {
      toast({ title: 'Assignment error', description: error.message, variant: 'error' });
      return;
    }
    toast({ title: 'Class & subject assigned', variant: 'success' });
    setAssignModal(null);
  };

  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveModal) return;
    const res = await fetch('/api/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requesterType: 'Teacher',
        requesterId: leaveModal.id,
        leaveType: leaveForm.leave_type,
        startDate: leaveForm.start_date,
        endDate: leaveForm.end_date,
        reason: leaveForm.reason,
        initialStatus: leaveForm.initialStatus,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: 'Leave error', description: data.error || 'Unable to save leave.', variant: 'error' });
      return;
    }
    toast({
      title: leaveForm.initialStatus === 'Approved' ? 'Leave approved & attendance marked' : 'Leave request submitted for approval',
      description: 'View or manage requests in Leave Requests.',
      variant: 'success',
    });
    setLeaveModal(null);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editStaff) return;
    const res = await fetch('/api/teachers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editStaff.id,
        name: editForm.name,
        father_name: editForm.father_name,
        date_of_birth: editForm.date_of_birth,
        gender: editForm.gender,
        cnic: editForm.cnic,
        phone: editForm.phone,
        email: editForm.email,
        qualification: editForm.qualification,
        designation: editForm.designation,
        department: editForm.department,
        base_salary: Number(editForm.base_salary || 0),
        status: editForm.status,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: 'Update failed', description: data.error || 'Unable to update staff.', variant: 'error' });
      return;
    }
    toast({ title: 'Staff record updated', variant: 'success' });
    setEditStaff(null);
    loadData();
  };

  const columns: TableColumn<StaffRow>[] = [
    { key: 'code', header: 'Code', render: (r) => <span className="font-mono-tabular font-semibold">{r.employee_code}</span>, exportValue: (r) => r.employee_code },
    {
      key: 'name',
      header: 'Name & Profile',
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{r.full_name}</p>
          <p className="text-[11px] text-slate-500">
            {[
              r.father_name ? `S/O · D/O ${r.father_name}` : null,
              r.gender || null,
              r.date_of_birth ? `DOB: ${r.date_of_birth}` : null,
              r.qualification || r.designation,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      ),
      exportValue: (r) =>
        [r.full_name, r.father_name, r.gender, r.date_of_birth].filter(Boolean).join(' · '),
    },
    {
      key: 'email',
      header: 'Teacher App Access',
      render: (r) => {
        const isPlaceholder = !r.email || r.email.endsWith('@school.local');
        const accessLabel = r.user_id
          ? r.app_blocked
            ? 'App Blocked'
            : r.app_access_enabled
              ? 'Teacher App Active'
              : 'App Disabled'
          : 'Not Registered in App';
        const accessColor = r.user_id
          ? r.app_blocked
            ? 'text-red-600 dark:text-red-400'
            : r.app_access_enabled
              ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
              : 'text-amber-700 dark:text-amber-400'
          : 'text-slate-500';
        return (
          <div>
            <p className="font-mono-tabular text-[11px] text-slate-800 dark:text-slate-200">
              {isPlaceholder ? 'QR / PIN Login' : r.email}
            </p>
            <p className={`text-[10px] ${accessColor}`}>{accessLabel}</p>
          </div>
        );
      },
      exportValue: (r) => r.email || '',
    },
    { key: 'role', header: 'Designation / Dept', render: (r) => `${r.designation} · ${r.department}`, exportValue: (r) => `${r.designation} (${r.department})` },
    { key: 'cnic', header: 'CNIC & Phone', render: (r) => <span className="font-mono-tabular">{r.cnic} · {r.mobile_number}</span>, exportValue: (r) => r.cnic },
    { key: 'salary', header: 'Salary (PKR)', align: 'right', render: (r) => <span className="font-mono-tabular">{Number(r.salary_pkr).toLocaleString()}</span>, exportValue: (r) => Number(r.salary_pkr) },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const st = (r.status || 'active').toLowerCase();
        const badgeCls =
          st === 'active'
            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
            : 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900';
        return (
          <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold capitalize ${badgeCls}`}>
            {st === 'active' ? 'Active' : st === 'inactive' ? 'Terminated / Inactive' : st.replace('_', ' ')}
          </span>
        );
      },
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
            onClick={() => {
              setEditStaff(r);
              const meta = extractTeacherProfileMeta(r);
              setEditForm({
                name: r.full_name,
                father_name: r.father_name || '',
                date_of_birth: r.date_of_birth || meta.date_of_birth || '',
                gender: r.gender || meta.gender || 'Male',
                cnic: r.cnic,
                phone: r.mobile_number,
                email: r.email && !r.email.endsWith('@school.local') ? r.email : '',
                qualification: r.qualification || '',
                designation: r.designation,
                department: r.department,
                base_salary: String(r.salary_pkr ?? 0),
                status: ['active', 'resigned', 'inactive'].includes((r.status || '').toLowerCase())
                  ? (r.status || 'active').toLowerCase()
                  : 'inactive',
              });
            }}
            className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              // Reset form including subject_id when opening modal
              setAssignForm({ class_id: '', section_id: '', subject_id: '', is_class_incharge: false });
              setAssignModal(r);
            }}
            className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Assign Class
          </button>
          <button
            type="button"
            disabled={qrGeneratingId === r.id}
            onClick={() => void handleOpenStaffQr(r)}
            className="inline-flex items-center gap-1 rounded border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 px-2 py-1 text-[11px] font-semibold hover:bg-sky-100 disabled:opacity-50"
          >
            <QrCode className="h-3 w-3" />
            {qrGeneratingId === r.id ? 'Generating...' : 'App QR'}
          </button>
          <button
            type="button"
            onClick={() => {
              setLeaveForm({ leave_type: 'Casual', start_date: '', end_date: '', reason: '', initialStatus: 'Pending' });
              setLeaveModal(r);
            }}
            className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Leave
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Teachers & Staff Management"
        subtitle={`Staff quota: ${entitlements.currentTeachers} / ${entitlements.maxTeachers || 'Unlimited'} · Assign classes, subjects, salaries, and leave records.`}
        rows={staff}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) =>
          `${r.employee_code} ${r.full_name} ${r.father_name || ''} ${r.gender || ''} ${r.date_of_birth || ''} ${r.email || ''} ${r.cnic} ${r.designation} ${r.department}`
        }
        exportFileName="teachers-and-staff"
        primaryAction={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard/academics/teacher-assignments"
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Class Assignments
            </Link>
            <Link
              href="/dashboard/leave-requests"
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Leave Requests
            </Link>
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Teacher / Staff
            </button>
          </div>
        }
      />

      <ModalDialog open={openAdd} onClose={() => setOpenAdd(false)} title="Add Teacher / Staff Member" maxWidthClass="max-w-2xl">
        <form onSubmit={handleCreate} className="space-y-4 text-xs">
          <WebcamPhotoCapture
            valueUrl={photoPreview}
            onCaptureFile={async (file, preview) => {
              const compressed = await compressStaffPhoto(file);
              setPhotoFile(compressed);
              setPhotoPreview(preview);
            }}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between">
                <label className="block font-medium">Employee Code</label>
                <button
                  type="button"
                  onClick={() => void fetchNextEmployeeCode()}
                  disabled={loadingCode}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:text-teal-800 dark:text-teal-400 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingCode ? 'animate-spin' : ''}`} />
                  Auto
                </button>
              </div>
              <input
                value={form.employee_code}
                onChange={(e) => {
                  const val = e.target.value;
                  setForm({ ...form, employee_code: val });
                  setCodeManuallyEdited(Boolean(val.trim()));
                }}
                placeholder={loadingCode ? 'Generating unique code...' : 'Auto-generated (e.g. EMP-002)'}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular"
              />
              <p className="mt-0.5 text-[10px] text-slate-500">
                Auto-generated unique code per staff member (leave blank or click Auto).
              </p>
            </div>
            <div>
              <label className="block font-medium">Full Name *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Father Name</label>
              <input value={form.father_name} onChange={(e) => setForm({ ...form, father_name: e.target.value })} placeholder="Father / Husband Name" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Date of Birth</label>
              <input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Gender *</label>
              <select
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value as StaffGender })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block font-medium">CNIC *</label>
              <input required value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="35202-1234567-1" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Mobile Number *</label>
              <input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Email (Optional — for Email/Password login)</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="teacher@email.com" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Qualification</label>
              <input value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} placeholder="M.Sc Physics, B.Ed" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Designation *</label>
              <input required value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Department *</label>
              <input required value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Experience (Years)</label>
              <input type="number" step="0.5" value={form.experience_years} onChange={(e) => setForm({ ...form, experience_years: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Base Monthly Salary (PKR)</label>
              <input type="number" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Joining Date</label>
              <input type="date" value={form.joining_date} onChange={(e) => setForm({ ...form, joining_date: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input
                id="teaching-staff-chk"
                type="checkbox"
                checked={form.is_teaching_staff}
                onChange={(e) => setForm({ ...form, is_teaching_staff: e.target.checked })}
              />
              <label htmlFor="teaching-staff-chk" className="font-medium">Teaching Faculty</label>
            </div>
          </div>

          <div className="rounded-xl border border-teal-200 dark:border-teal-900/70 bg-teal-50/50 dark:bg-teal-950/20 p-3.5 space-y-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.auto_app_access}
                onChange={(e) => setForm({ ...form, auto_app_access: e.target.checked })}
                className="mt-0.5"
              />
              <div>
                <p className="font-semibold text-teal-900 dark:text-teal-200">
                  Auto-Create Teacher App Access (Recommended)
                </p>
                <p className="text-[11px] text-teal-800/80 dark:text-teal-300/80">
                  Automatically links a login account, enables Teacher App access, and generates a ready-to-scan Activation QR immediately upon saving.
                </p>
              </div>
            </label>

            {form.auto_app_access && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300">
                    Initial Password (Optional, min 8 chars)
                  </label>
                  <input
                    type="text"
                    minLength={8}
                    value={form.app_password}
                    onChange={(e) => setForm({ ...form, app_password: e.target.value })}
                    placeholder="Leave blank to use QR activation"
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300">
                    Initial App PIN (Optional, 4–6 digits)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{4,6}"
                    maxLength={6}
                    value={form.app_pin}
                    onChange={(e) => setForm({ ...form, app_pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                    placeholder="Teacher sets via QR if blank"
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenAdd(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Staff Record</button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog open={Boolean(assignModal)} onClose={() => setAssignModal(null)} title={`Assign Class & Subject — ${assignModal?.full_name || ''}`}>
        <form onSubmit={handleAssignSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Class *</label>
            {/* UPDATED: Resets subject_id when class changes, triggering the useEffect to fetch class subjects */}
            <select 
              required 
              value={assignForm.class_id} 
              onChange={(e) => setAssignForm({ ...assignForm, class_id: e.target.value, subject_id: '' })} 
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="">Select Class</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-medium">Section</label>
            <select value={assignForm.section_id} onChange={(e) => setAssignForm({ ...assignForm, section_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              <option value="">All Sections</option>
              {sections.filter((s) => s.class_id === assignForm.class_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-medium">Subject</label>
            {/* UPDATED: Maps over classSubjects instead of all subjects */}
            <select value={assignForm.subject_id} onChange={(e) => setAssignForm({ ...assignForm, subject_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              <option value="">General / Class In-charge</option>
              {classSubjects.map((sub) => (
                <option key={sub.id} value={sub.id}>{sub.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pt-1">
            <input type="checkbox" checked={assignForm.is_class_incharge} onChange={(e) => setAssignForm({ ...assignForm, is_class_incharge: e.target.checked })} />
            <span>Assign as Class In-charge</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setAssignModal(null)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Assignment</button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog open={Boolean(leaveModal)} onClose={() => setLeaveModal(null)} title={`Record Leave — ${leaveModal?.full_name || ''}`}>
        <form onSubmit={handleLeaveSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Leave Type</label>
            <select value={leaveForm.leave_type} onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              <option value="Casual">Casual Leave</option>
              <option value="Medical">Medical Leave</option>
              <option value="Earned">Earned Leave</option>
              <option value="Unpaid">Unpaid Leave</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Start Date *</label>
              <input type="date" required value={leaveForm.start_date} onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">End Date *</label>
              <input type="date" required value={leaveForm.end_date} onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block font-medium">Approval Status</label>
            <select
              value={leaveForm.initialStatus}
              onChange={(e) => setLeaveForm({ ...leaveForm, initialStatus: e.target.value as 'Pending' | 'Approved' })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="Pending">Pending Approval (Shows in Leave Requests)</option>
              <option value="Approved">Approved Immediately (Marks Attendance & Syncs Salary)</option>
            </select>
          </div>
          <div>
            <label className="block font-medium">Reason</label>
            <textarea required rows={2} value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setLeaveModal(null)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Leave</button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog open={Boolean(editStaff)} onClose={() => setEditStaff(null)} title={`Edit Staff — ${editStaff?.full_name || ''}`} maxWidthClass="max-w-xl">
        <form onSubmit={handleEditSubmit} className="space-y-3 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block font-medium">Full Name *</label>
              <input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Father Name</label>
              <input value={editForm.father_name} onChange={(e) => setEditForm({ ...editForm, father_name: e.target.value })} placeholder="Father / Husband Name" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Date of Birth</label>
              <input type="date" value={editForm.date_of_birth} onChange={(e) => setEditForm({ ...editForm, date_of_birth: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Gender *</label>
              <select
                value={editForm.gender}
                onChange={(e) => setEditForm({ ...editForm, gender: e.target.value as StaffGender })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block font-medium">Teacher App Login Email</label>
              <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="teacher@email.com" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular" />
            </div>
            <div>
              <label className="block font-medium">CNIC *</label>
              <input required value={editForm.cnic} onChange={(e) => setEditForm({ ...editForm, cnic: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Mobile Number *</label>
              <input required value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Designation *</label>
              <input required value={editForm.designation} onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Department *</label>
              <input required value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Qualification</label>
              <input value={editForm.qualification} onChange={(e) => setEditForm({ ...editForm, qualification: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Monthly Salary (PKR)</label>
              <input type="number" value={editForm.base_salary} onChange={(e) => setEditForm({ ...editForm, base_salary: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium">Employment Status (School Leaving / Resigned)</label>
              <select
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="active">Active (App Access Allowed)</option>
                <option value="resigned">Resigned / Left School (Revokes App Access)</option>
                <option value="inactive">Terminated / Inactive (Revokes App Access)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setEditStaff(null)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Changes</button>
          </div>
        </form>
      </ModalDialog>
      <ModalDialog
        open={Boolean(staffQrModal)}
        onClose={() => setStaffQrModal(null)}
        title={`Teacher App Activation QR — ${staffQrModal?.teacherName || ''}`}
        subtitle="Scan this one-time QR code in the TaleemOS Teacher App to activate and log in."
      >
        {staffQrModal && (
          <div className="space-y-4 text-xs">
            <div className="rounded-xl border border-teal-200 dark:border-teal-900 bg-teal-50/60 dark:bg-teal-950/30 p-3 flex items-start gap-2.5">
              <QrCode className="h-4 w-4 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-teal-950 dark:text-teal-200">
                    {staffQrModal.teacherName} ({staffQrModal.employeeCode})
                  </p>
                  {staffQrModal.appLinked !== false && (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-100 dark:bg-emerald-950/70 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      App Access Ready
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-teal-800 dark:text-teal-300">
                  School: <strong>{staffQrModal.schoolName}</strong>
                </p>
                {(staffQrModal.passwordSet || staffQrModal.pinSet) && (
                  <p className="text-[11px] text-emerald-800 dark:text-emerald-300 font-medium">
                    {[
                      staffQrModal.passwordSet ? 'Initial Portal Password set' : null,
                      staffQrModal.pinSet ? 'Initial App PIN set' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <img
                src={staffQrModal.qrDataUrl}
                alt="Teacher App Activation QR"
                className="h-56 w-56 rounded-lg border border-slate-200 dark:border-slate-700"
              />
              <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                <Clock className="h-3.5 w-3.5" />
                <span>Single-use · Valid for 15 minutes</span>
              </div>
              {staffQrModal.tokenPreview && (
                <p className="mt-1 font-mono-tabular text-[10px] text-slate-500">
                  Token: {staffQrModal.tokenPreview}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={staffQrModal.qrDataUrl}
                  download={`teacher-qr-${staffQrModal.employeeCode || 'activation'}.png`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download QR
                </a>
                <Link
                  href="/dashboard/app-access/teachers"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Manage Teacher Access
                </Link>
              </div>
              <button
                type="button"
                onClick={() => setStaffQrModal(null)}
                className="rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-1.5 font-semibold text-white"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}
