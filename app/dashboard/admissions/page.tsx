'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { canAddStudent } from '@/lib/subscription/entitlements';
import { WebcamPhotoCapture } from '@/components/dashboard/webcam-capture';
import { useToast } from '@/components/providers/toast-provider';
import { fileToOptimizedDataUrl } from '@/lib/utils/image-data-url';
import { Loader2, RefreshCw } from 'lucide-react';

export default function AdmissionsPage() {
  const router = useRouter();
  const { school, entitlements } = useSchool();
  const { toast } = useToast();

  const [sessions, setSessions] = useState<Array<{ id: string; name: string }>>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [sections, setSections] = useState<Array<{ id: string; name: string; class_id: string }>>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingIds, setLoadingIds] = useState(true);
  const [admManuallyEdited, setAdmManuallyEdited] = useState(false);
  const [matchedGuardian, setMatchedGuardian] = useState<{
    id: string;
    full_name: string;
    relationship?: string;
    phone: string;
    email?: string | null;
    cnic?: string | null;
    address?: string | null;
  } | null>(null);

  const [form, setForm] = useState({
    admission_no: '',
    student_id_code: '',
    roll_no: '',
    name_en: '',
    name_ur: '',
    b_form: '',
    dob: '',
    gender: 'Male' as 'Male' | 'Female' | 'Other',
    address: '',
    admission_date: new Date().toISOString().slice(0, 10),
    session_id: '',
    class_id: '',
    section_id: '',
    email: '',
    emergency_contact: '',
    guardian_name: '',
    guardian_relationship: 'Father' as 'Father' | 'Mother' | 'Guardian' | 'Other',
    guardian_phone: '',
    guardian_email: '',
    guardian_cnic: '',
  });

  const fetchNextIdentifiers = async () => {
    setLoadingIds(true);
    try {
      const res = await fetch('/api/students?nextIdentifiers=1', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.admissionNumber) {
        setForm((prev) => ({
          ...prev,
          admission_no: data.admissionNumber,
          student_id_code: data.studentId || '',
          roll_no: data.rollNumber || prev.roll_no,
        }));
        setAdmManuallyEdited(false);
      }
    } finally {
      setLoadingIds(false);
    }
  };

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      Promise.all([
        supabase.from('academic_sessions').select('id, name').eq('school_id', school.id),
        supabase.from('classes').select('id, name').eq('school_id', school.id).order('level_order'),
        supabase.from('sections').select('id, name, class_id').eq('school_id', school.id),
      ]).then(([sessRes, clsRes, secRes]) => {
        if (!active) return;
        setSessions(sessRes.data ?? []);
        setClasses(clsRes.data ?? []);
        setSections(secRes.data ?? []);
      });
    }

    fetch('/api/students?nextIdentifiers=1', { cache: 'no-store' })
      .then((res) => res.json().catch(() => ({})).then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!active) return;
        if (ok && data.admissionNumber) {
          setForm((prev) => ({
            ...prev,
            admission_no: data.admissionNumber,
            student_id_code: data.studentId || '',
            roll_no: data.rollNumber || prev.roll_no,
          }));
          setAdmManuallyEdited(false);
        }
      })
      .finally(() => {
        if (active) setLoadingIds(false);
      });

    return () => {
      active = false;
    };
  }, [school.id]);

  useEffect(() => {
    const phone = form.guardian_phone.trim();
    const cnic = form.guardian_cnic.trim();

    const timer = setTimeout(async () => {
      if (!phone && !cnic) {
        setMatchedGuardian(null);
        return;
      }
      try {
        const query = phone ? `phone=${encodeURIComponent(phone)}` : `cnic=${encodeURIComponent(cnic)}`;
        const res = await fetch(`/api/guardians?${query}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.guardian) {
          setMatchedGuardian(data.guardian);
        } else {
          setMatchedGuardian(null);
        }
      } catch {
        // silent
      }
    }, !phone && !cnic ? 0 : 400);

    return () => clearTimeout(timer);
  }, [form.guardian_phone, form.guardian_cnic]);

  const limitCheck = canAddStudent(entitlements);
  const availableSections = sections.filter((s) => s.class_id === form.class_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!limitCheck.allowed) {
      toast({ title: 'Admission blocked', description: limitCheck.reason, variant: 'error' });
      return;
    }

    setSubmitting(true);
    try {
      let photoDataUrl: string | undefined;
      if (photoFile) {
        photoDataUrl = await fileToOptimizedDataUrl(photoFile);
      }

      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admission_no: form.admission_no,
          roll_no: form.roll_no,
          student_id_code: form.student_id_code || undefined,
          auto_generate_ids: !admManuallyEdited,
          name_en: form.name_en,
          name_ur: form.name_ur,
          b_form: form.b_form,
          dob: form.dob || undefined,
          gender: form.gender,
          address: form.address,
          admission_date: form.admission_date,
          session_id: form.session_id || null,
          class_id: form.class_id || null,
          section_id: form.section_id || null,
          email: form.email,
          emergency_contact: form.emergency_contact,
          photo_data_url: photoDataUrl || null,
          guardian: form.guardian_name
            ? {
                full_name: form.guardian_name,
                relationship: form.guardian_relationship,
                phone: form.guardian_phone,
                email: form.guardian_email,
                cnic: form.guardian_cnic,
                address: form.address,
                emergency_contact: form.emergency_contact,
              }
            : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Admission failed', description: data.error, variant: 'error' });
        return;
      }

      const sidText = data.student?.student_id
        ? ` · Student ID: ${data.student.student_id}`
        : data.studentIdColumnMissing
          ? ' (Run SQL migration 003 in /setup-guide to save Student ID column in Supabase)'
          : '';
      toast({
        title: 'Student admitted successfully',
        description: data.student
          ? `Adm No: ${data.student.admission_number}${sidText}`
          : undefined,
        variant: 'success',
      });
      router.push('/dashboard/students');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">New Student Admission</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Student quota: <span className="font-mono-tabular font-semibold">{entitlements.currentStudents} / {entitlements.maxStudents || 'Unlimited'}</span>
          </p>
        </div>
      </div>

      {!limitCheck.allowed && (
        <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4 text-xs text-red-700 dark:text-red-300">
          {limitCheck.reason}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-6"
      >
        <div>
          <h2 className="text-sm font-semibold">01. Student Photo & Identification</h2>
          <div className="mt-3">
            <WebcamPhotoCapture
              valueUrl={photoPreview}
              onCaptureFile={(file, preview) => {
                setPhotoFile(file);
                setPhotoPreview(preview);
              }}
            />
          </div>

          <div className="mt-4 rounded-xl border border-teal-200 dark:border-teal-900/60 bg-teal-50/60 dark:bg-teal-950/20 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-teal-900 dark:text-teal-200">
                  Auto-Generated Unique Identifiers
                </p>
                <p className="text-[11px] text-teal-700 dark:text-teal-400">
                  Admission No, Student ID & Roll No are automatically assigned uniquely on registration.
                </p>
              </div>
              <button
                type="button"
                onClick={fetchNextIdentifiers}
                disabled={loadingIds}
                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 dark:border-teal-800 bg-white dark:bg-slate-950 px-3 py-1.5 text-[11px] font-semibold text-teal-800 dark:text-teal-200 hover:bg-teal-50 dark:hover:bg-slate-900 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${loadingIds ? 'animate-spin' : ''}`} />
                Generate New IDs
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Admission Number (Auto Unique)
                </label>
                <input
                  type="text"
                  value={form.admission_no}
                  onChange={(e) => {
                    setForm({ ...form, admission_no: e.target.value });
                    setAdmManuallyEdited(true);
                  }}
                  placeholder="Auto-generated on save"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Student ID (Auto Unique)
                </label>
                <input
                  type="text"
                  readOnly
                  value={form.student_id_code}
                  placeholder="Auto-generated"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-sm font-mono-tabular font-semibold text-teal-800 dark:text-teal-300"
                />
              </div>
              <Field
                label="Roll Number (Auto Sequential)"
                value={form.roll_no}
                onChange={(v) => setForm({ ...form, roll_no: v })}
                placeholder="Auto-assigned"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="B-Form / CRC Number" value={form.b_form} onChange={(v) => setForm({ ...form, b_form: v })} placeholder="35202-1234567-1" />
            <Field label="Student Name (English) *" required value={form.name_en} onChange={(v) => setForm({ ...form, name_en: v })} />
            <Field label="Student Name (Urdu)" dir="rtl" value={form.name_ur} onChange={(v) => setForm({ ...form, name_ur: v })} />
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Gender</label>
              <select
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value as 'Male' | 'Female' | 'Other' })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <Field label="Date of Birth" type="date" value={form.dob} onChange={(v) => setForm({ ...form, dob: v })} />
            <Field label="Admission Date" type="date" value={form.admission_date} onChange={(v) => setForm({ ...form, admission_date: v })} />
            <Field label="Student Email (for App Login)" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-6">
          <h2 className="text-sm font-semibold">02. Class & Session Placement</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Academic Session</label>
              <select
                value={form.session_id}
                onChange={(e) => setForm({ ...form, session_id: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="">Select Session</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Class</label>
              <select
                value={form.class_id}
                onChange={(e) => setForm({ ...form, class_id: e.target.value, section_id: '' })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="">Select Class</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Section</label>
              <select
                value={form.section_id}
                onChange={(e) => setForm({ ...form, section_id: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="">Select Section</option>
                {availableSections.map((sec) => (
                  <option key={sec.id} value={sec.id}>{sec.name}</option>
                ))}
              </select>
            </div>
            <Field label="Emergency Contact" value={form.emergency_contact} onChange={(v) => setForm({ ...form, emergency_contact: v })} />
            <div className="sm:col-span-2">
              <Field label="Residential Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">03. Parent / Guardian Profile & Sibling Linking</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Verified guardian profile enables multi-child linking and QR-based Guardian Login inside the Universal Student App.
              </p>
            </div>
            {matchedGuardian && (
              <span className="inline-flex items-center gap-1 rounded-full border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 px-3 py-1 text-xs font-semibold text-purple-700 dark:text-purple-300">
                Existing Sibling Guardian Found
              </span>
            )}
          </div>

          {matchedGuardian && (
            <div className="mt-3 rounded-xl border border-purple-300 dark:border-purple-800 bg-purple-50/80 dark:bg-purple-950/30 p-4 text-xs text-purple-950 dark:text-purple-200 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="font-bold text-sm">
                  Existing Guardian Account: {matchedGuardian.full_name} ({matchedGuardian.phone})
                </p>
                <p className="text-[11px] text-purple-800 dark:text-purple-300">
                  This new student will automatically be linked as a sibling to this guardian&apos;s account in the Universal Student App without creating a duplicate record.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setForm((prev) => ({
                    ...prev,
                    guardian_name: matchedGuardian.full_name,
                    guardian_relationship: (matchedGuardian.relationship as 'Father' | 'Mother' | 'Guardian' | 'Other') || prev.guardian_relationship,
                    guardian_email: matchedGuardian.email || prev.guardian_email,
                    guardian_cnic: matchedGuardian.cnic || prev.guardian_cnic,
                    address: matchedGuardian.address || prev.address,
                  }));
                }}
                className="rounded-lg bg-purple-700 hover:bg-purple-800 px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
              >
                Use Guardian Details
              </button>
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Parent / Guardian Name" value={form.guardian_name} onChange={(v) => setForm({ ...form, guardian_name: v })} />
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Relationship</label>
              <select
                value={form.guardian_relationship}
                onChange={(e) => setForm({ ...form, guardian_relationship: e.target.value as 'Father' | 'Mother' | 'Guardian' | 'Other' })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="Father">Father</option>
                <option value="Mother">Mother</option>
                <option value="Guardian">Guardian</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <Field label="Contact Number" value={form.guardian_phone} onChange={(v) => setForm({ ...form, guardian_phone: v })} placeholder="03001234567" />
            <Field label="CNIC Number" value={form.guardian_cnic} onChange={(v) => setForm({ ...form, guardian_cnic: v })} placeholder="35202-1234567-1" />
            <Field label="Email (Optional)" type="email" value={form.guardian_email} onChange={(v) => setForm({ ...form, guardian_email: v })} />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-slate-800 pt-5">
          <button
            type="submit"
            disabled={submitting || !limitCheck.allowed}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 px-5 py-2.5 text-sm font-semibold text-white"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Complete Admission
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  placeholder,
  dir,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  dir?: 'rtl' | 'ltr';
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <input
        type={type}
        required={required}
        dir={dir}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
      />
    </div>
  );
}
