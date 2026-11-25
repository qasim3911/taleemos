'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { generateCertificatePdf } from '@/lib/pdf/generators';
import { Plus } from 'lucide-react';

interface CertRow {
  id: string;
  student_id: string;
  certificate_type: 'School Leaving' | 'Character' | 'Bonafide' | 'Admission Letter';
  serial_no: string;
  issued_date: string;
  remarks: string | null;
}

export default function CertificatesPage() {
  const { school, userId } = useSchool();
  const { toast } = useToast();

  const [certs, setCerts] = useState<CertRow[]>([]);
  const [students, setStudents] = useState<Array<{ id: string; admission_number: string; name_en: string; class_id: string | null }>>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [openAdd, setOpenAdd] = useState(false);

  const [form, setForm] = useState({
    student_id: '',
    certificate_type: 'Bonafide' as CertRow['certificate_type'],
    father_name: '',
    remarks: '',
  });

  const loadData = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const [{ data: cRows }, { data: sRows }, { data: clsRows }] = await Promise.all([
      supabase.from('certificates_issued').select('*').eq('school_id', school.id).order('issued_date', { ascending: false }),
      supabase.from('students').select('id, admission_number, name_en, class_id').eq('school_id', school.id),
      supabase.from('classes').select('id, name').eq('school_id', school.id),
    ]);
    setCerts(cRows ?? []);
    setStudents(sRows ?? []);
    setClasses(clsRows ?? []);
    setLoading(false);
  }, [school.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const studentMap = new Map(students.map((s) => [s.id, s]));
  const classMap = new Map(classes.map((c) => [c.id, c.name]));

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const stu = studentMap.get(form.student_id);
    if (!stu) return;

    const serialNo = `CERT-${Date.now().toString().slice(-6)}`;
    const issuedDate = new Date().toISOString().slice(0, 10);

    const { error } = await supabase.from('certificates_issued').insert({
      school_id: school.id,
      student_id: stu.id,
      certificate_type: form.certificate_type,
      serial_no: serialNo,
      issued_date: issuedDate,
      remarks: form.remarks || null,
      issued_by: userId,
    });

    if (error) {
      toast({ title: 'Error issuing certificate', description: error.message, variant: 'error' });
      return;
    }

    generateCertificatePdf(
      { nameEn: school.name_en, address: school.address, city: school.city, phone: school.phone },
      {
        certificateType: form.certificate_type,
        serialNo,
        studentName: stu.name_en,
        fatherName: form.father_name || undefined,
        admissionNo: stu.admission_number,
        className: (stu.class_id && classMap.get(stu.class_id)) || '—',
        issuedDate,
        remarks: form.remarks,
      }
    );

    toast({ title: `Certificate ${serialNo} issued & downloaded`, variant: 'success' });
    setOpenAdd(false);
    loadData();
  };

  const columns: TableColumn<CertRow>[] = [
    { key: 'serial', header: 'Serial No', render: (r) => <span className="font-mono-tabular font-semibold">{r.serial_no}</span>, exportValue: (r) => r.serial_no },
    { key: 'type', header: 'Certificate Type', render: (r) => r.certificate_type, exportValue: (r) => r.certificate_type },
    { key: 'stu', header: 'Student', render: (r) => studentMap.get(r.student_id)?.name_en || 'Student' },
    { key: 'date', header: 'Issue Date', render: (r) => <span className="font-mono-tabular">{r.issued_date}</span> },
    {
      key: 'pdf',
      header: 'Document',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          onClick={() => {
            const stu = studentMap.get(r.student_id);
            if (!stu) return;
            generateCertificatePdf(
              { nameEn: school.name_en, address: school.address, city: school.city, phone: school.phone },
              {
                certificateType: r.certificate_type,
                serialNo: r.serial_no,
                studentName: stu.name_en,
                admissionNo: stu.admission_number,
                className: (stu.class_id && classMap.get(stu.class_id)) || '—',
                issuedDate: r.issued_date,
                remarks: r.remarks,
              }
            );
          }}
          className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium"
        >
          Download PDF
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Certificates & Official Documents"
        subtitle="Generate official School Leaving, Character, and Bonafide PDF certificates with school branding."
        rows={certs}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.serial_no} ${r.certificate_type}`}
        exportFileName="issued-certificates"
        primaryAction={
          <button
            type="button"
            onClick={() => {
              setForm({ student_id: students[0]?.id || '', certificate_type: 'Bonafide', father_name: '', remarks: '' });
              setOpenAdd(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Issue Certificate PDF
          </button>
        }
      />

      <ModalDialog open={openAdd} onClose={() => setOpenAdd(false)} title="Issue Student Certificate">
        <form onSubmit={handleIssue} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Certificate Type *</label>
            <select value={form.certificate_type} onChange={(e) => setForm({ ...form, certificate_type: e.target.value as CertRow['certificate_type'] })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              <option value="School Leaving">School Leaving Certificate</option>
              <option value="Character">Character Certificate</option>
              <option value="Bonafide">Bonafide Certificate</option>
            </select>
          </div>
          <div>
            <label className="block font-medium">Student *</label>
            <select required value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              {students.map((s) => <option key={s.id} value={s.id}>{s.name_en} ({s.admission_number})</option>)}
            </select>
          </div>
          <div>
            <label className="block font-medium">Father / Guardian Name (for Certificate text)</label>
            <input value={form.father_name} onChange={(e) => setForm({ ...form, father_name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block font-medium">Remarks</label>
            <textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenAdd(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Generate & Download PDF</button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
