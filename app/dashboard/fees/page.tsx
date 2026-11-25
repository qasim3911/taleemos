'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { generateFeeReceiptPdf, generateFeeVoucherPdf } from '@/lib/pdf/generators';
import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Plus,
  Receipt,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Trash2,
} from 'lucide-react';

interface VoucherRow {
  id: string;
  voucher_number: string;
  student_id: string;
  studentName: string;
  admissionNo: string;
  classId: string | null;
  className: string;
  studentUserId: string | null;
  studentAppEnabled: boolean;
  billing_month: string;
  issue_date: string;
  due_date: string;
  tuition_amount_pkr: number;
  other_charges_pkr: number;
  discount_pkr: number;
  fine_pkr: number;
  total_amount_pkr: number;
  paid_amount_pkr: number;
  status: string;
  last_reminder_at?: string | null;
}

interface PaymentRow {
  id: string;
  voucher_id: string;
  student_id: string;
  receipt_no: string;
  amount_paid: number;
  payment_method: string;
  transaction_ref: string | null;
  paid_at: string;
}

interface StudentBrief {
  id: string;
  admission_number: string;
  name_en: string;
  class_id: string | null;
  user_id: string | null;
  app_access_enabled: boolean;
  app_blocked: boolean;
  monthly_fee_pkr: number;
  discount_pkr: number;
}

interface ClassBrief {
  id: string;
  name: string;
  tuition_fee_pkr: number;
}

interface FeeAutoSettings {
  auto_generate_monthly: boolean;
  generate_day: number;
  due_day: number;
  grace_days: number;
  late_fine_pkr: number;
  default_monthly_fee_pkr: number;
  auto_reminders: boolean;
  sync_to_student_app: boolean;
}

function VoucherStatusBadge({ status }: { status: string }) {
  const s = (status || 'unpaid').toLowerCase();
  const cls =
    s === 'paid'
      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
      : s === 'partial'
        ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900'
        : s === 'overdue'
          ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900'
          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900';

  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold capitalize ${cls}`}>
      {s}
    </span>
  );
}

export default function FeesFinancePage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [rawVouchers, setRawVouchers] = useState<
    Array<
      Omit<
        VoucherRow,
        'studentName' | 'admissionNo' | 'classId' | 'className' | 'studentUserId' | 'studentAppEnabled'
      >
    >
  >([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [students, setStudents] = useState<StudentBrief[]>([]);
  const [classes, setClasses] = useState<ClassBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<'vouchers' | 'receipts' | 'rates'>('vouchers');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unpaid' | 'partial' | 'paid' | 'overdue'>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [classFilter, setClassFilter] = useState<string>('all');

  const [openVoucher, setOpenVoucher] = useState(false);
  const [payTarget, setPayTarget] = useState<VoucherRow | null>(null);
  const [openAutoModal, setOpenAutoModal] = useState(false);
  const [openSettingsModal, setOpenSettingsModal] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoMonth, setAutoMonth] = useState(new Date().toISOString().slice(0, 7));

  const [rateEdits, setRateEdits] = useState<Record<string, string>>({});
  const [studentRateEdits, setStudentRateEdits] = useState<
    Record<string, { fee: string; discount: string }>
  >({});

  const [feeSettings, setFeeSettings] = useState<FeeAutoSettings>({
    auto_generate_monthly: true,
    generate_day: 1,
    due_day: 10,
    grace_days: 5,
    late_fine_pkr: 0,
    default_monthly_fee_pkr: 0,
    auto_reminders: true,
    sync_to_student_app: true,
  });

  const [vForm, setVForm] = useState({
    student_id: '',
    billing_month: new Date().toISOString().slice(0, 7),
    due_date: new Date().toISOString().slice(0, 10),
    fee_category: 'Monthly Tuition Fee',
    custom_category: '',
    gross_amount: '3000',
    discount_amount: '0',
    fine_amount: '0',
  });

  const [payForm, setPayForm] = useState({
    amount_paid: '',
    payment_method: 'Cash' as 'Cash' | 'Bank' | 'JazzCash' | 'Easypaisa',
    transaction_ref: '',
  });

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/fees', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to load fees', description: data.error, variant: 'error' });
        setLoading(false);
        return;
      }

      setRawVouchers(data.vouchers ?? []);
      setPayments(data.payments ?? []);
      setStudents(data.students ?? []);
      setClasses(data.classes ?? []);
      if (data.settings) {
        setFeeSettings(data.settings);
      }

      const nextClassRates: Record<string, string> = {};
      for (const c of (data.classes ?? []) as ClassBrief[]) {
        nextClassRates[c.id] = String(Number(c.tuition_fee_pkr || 0));
      }
      setRateEdits(nextClassRates);

      const nextStuRates: Record<string, { fee: string; discount: string }> = {};
      for (const s of (data.students ?? []) as StudentBrief[]) {
        nextStuRates[s.id] = {
          fee: String(Number(s.monthly_fee_pkr || 0)),
          discount: String(Number(s.discount_pkr || 0)),
        };
      }
      setStudentRateEdits(nextStuRates);

      if (data.autoSummary && Number(data.autoSummary.createdCount) > 0) {
        toast({
          title: `${data.autoSummary.createdCount} monthly challan(s) auto-generated`,
          description: `Synced to Portal & Student App for ${data.autoSummary.billingMonth}.`,
          variant: 'success',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadData();

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`school-fees-${school.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fee_vouchers', filter: `school_id=eq.${school.id}` },
        () => void loadData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fee_payments', filter: `school_id=eq.${school.id}` },
        () => void loadData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData, school.id]);

  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const vouchers: VoucherRow[] = useMemo(() => {
    return rawVouchers.map((v) => {
      const stu = studentMap.get(v.student_id);
      const cls = stu?.class_id ? classMap.get(stu.class_id) : undefined;
      return {
        ...v,
        studentName: stu?.name_en || 'Student',
        admissionNo: stu?.admission_number || '',
        classId: stu?.class_id || null,
        className: cls?.name || 'Unassigned',
        studentUserId: stu?.user_id || null,
        studentAppEnabled: Boolean(stu?.user_id && stu?.app_access_enabled && !stu?.app_blocked),
      };
    });
  }, [rawVouchers, studentMap, classMap]);

  const availableMonths = useMemo(() => {
    const set = new Set(vouchers.map((v) => v.billing_month).filter(Boolean));
    return Array.from(set).sort().reverse();
  }, [vouchers]);

  const filteredVouchers = useMemo(() => {
    return vouchers.filter((v) => {
      const st = (v.status || 'unpaid').toLowerCase();
      if (statusFilter !== 'all' && st !== statusFilter) return false;
      if (monthFilter !== 'all' && v.billing_month !== monthFilter) return false;
      if (classFilter !== 'all' && v.classId !== classFilter) return false;
      return true;
    });
  }, [vouchers, statusFilter, monthFilter, classFilter]);

  const stats = useMemo(() => {
    const scoped = vouchers.filter((v) => {
      if (monthFilter !== 'all' && v.billing_month !== monthFilter) return false;
      if (classFilter !== 'all' && v.classId !== classFilter) return false;
      return true;
    });

    let totalBilled = 0;
    let totalPaid = 0;
    let totalPending = 0;
    let countAll = 0;
    let countUnpaid = 0;
    let countPartial = 0;
    let countPaid = 0;
    let countOverdue = 0;

    for (const v of scoped) {
      countAll++;
      const total = Number(v.total_amount_pkr || 0);
      const paid = Number(v.paid_amount_pkr || 0);
      const st = (v.status || 'unpaid').toLowerCase();
      totalBilled += total;
      totalPaid += paid;
      totalPending += Math.max(0, total - paid);
      if (st === 'paid') countPaid++;
      else if (st === 'partial') countPartial++;
      else if (st === 'overdue') countOverdue++;
      else countUnpaid++;
    }

    return {
      totalBilled,
      totalPaid,
      totalPending,
      countAll,
      countUnpaid,
      countPartial,
      countPaid,
      countOverdue,
    };
  }, [vouchers, monthFilter, classFilter]);

  const prefillStudentFee = (studentId: string) => {
    const stu = studentMap.get(studentId);
    const cls = stu?.class_id ? classMap.get(stu.class_id) : undefined;
    const baseFee =
      Number(stu?.monthly_fee_pkr || 0) > 0
        ? Number(stu?.monthly_fee_pkr)
        : Number(cls?.tuition_fee_pkr || 0) > 0
          ? Number(cls?.tuition_fee_pkr)
          : Number(feeSettings.default_monthly_fee_pkr || 0);
    setVForm((prev) => ({
      ...prev,
      student_id: studentId,
      gross_amount: String(baseFee || 3000),
      discount_amount: String(Number(stu?.discount_pkr || 0)),
    }));
  };

  const handleCreateVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    setAutoBusy(true);
    try {
      const res = await fetch('/api/fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_voucher',
          student_id: vForm.student_id,
          billing_month: vForm.billing_month,
          due_date: vForm.due_date,
          fee_category: vForm.fee_category,
          custom_category: vForm.custom_category,
          tuition_amount_pkr: Number(vForm.gross_amount || 0),
          discount_pkr: Number(vForm.discount_amount || 0),
          fine_pkr: Number(vForm.fine_amount || 0),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to issue voucher', description: data.error, variant: 'error' });
        return;
      }

      toast({
        title: `Voucher ${data.voucher?.voucher_number} issued`,
        description: 'Visible immediately on Student Portal & App.',
        variant: 'success',
      });
      setOpenVoucher(false);
      void loadData();
    } finally {
      setAutoBusy(false);
    }
  };

  const handleGenerateMonthlyBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setAutoBusy(true);
    try {
      const res = await fetch('/api/fees/auto-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingMonth: autoMonth, force: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Batch generation failed', description: data.error, variant: 'error' });
        return;
      }

      if (data.createdCount > 0) {
        toast({
          title: `${data.createdCount} challan(s) generated for ${data.billingMonth}`,
          description: `${data.notificationsSent} pushed to Student Portal & App.`,
          variant: 'success',
        });
      } else if (data.skippedZeroFee > 0 && data.skippedExisting === 0) {
        toast({
          title: 'No challans generated (0 PKR fee)',
          description:
            'Set Class Tuition Fee, Student Monthly Fee, or Default Monthly Fee in Auto Settings.',
          variant: 'info',
        });
      } else {
        toast({
          title: `All active students already have challans for ${data.billingMonth}`,
          description: `${data.skippedExisting} existing voucher(s) preserved.`,
          variant: 'info',
        });
      }
      setOpenAutoModal(false);
      void loadData();
    } finally {
      setAutoBusy(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setAutoBusy(true);
    try {
      const res = await fetch('/api/fees/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feeSettings),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Unable to save settings', description: data.error, variant: 'error' });
        return;
      }
      setFeeSettings(data.settings);
      toast({ title: 'Monthly Auto-Challan settings saved', variant: 'success' });
      setOpenSettingsModal(false);
    } finally {
      setAutoBusy(false);
    }
  };

  const submitPayment = async (
    voucher: VoucherRow,
    amount: number,
    method: 'Cash' | 'Bank' | 'JazzCash' | 'Easypaisa',
    ref: string | null,
    downloadReceipt: boolean
  ) => {
    setBusyId(voucher.id);
    try {
      const res = await fetch('/api/fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_payment',
          voucher_id: voucher.id,
          amount_paid: amount,
          payment_method: method,
          transaction_ref: ref,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Payment failed', description: data.error, variant: 'error' });
        return;
      }

      toast({
        title: `Payment recorded · ${data.payment?.receipt_no}`,
        description: `Voucher ${voucher.voucher_number} is now ${data.voucher?.status?.toUpperCase()}.`,
        variant: 'success',
      });

      if (downloadReceipt && data.payment) {
        generateFeeReceiptPdf(
          { nameEn: school.name_en, address: school.address, city: school.city, phone: school.phone },
          {
            receipt_no: data.payment.receipt_no,
            studentName: voucher.studentName,
            admissionNo: voucher.admissionNo,
            voucherNo: voucher.voucher_number,
            amount_paid: amount,
            payment_method: method,
            transaction_ref: ref,
            paid_at: data.payment.paid_at,
          }
        );
      }

      setPayTarget(null);
      void loadData();
    } finally {
      setBusyId(null);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    const amount = Number(payForm.amount_paid);
    if (amount <= 0) {
      toast({ title: 'Enter a valid payment amount', variant: 'error' });
      return;
    }
    await submitPayment(
      payTarget,
      amount,
      payForm.payment_method,
      payForm.transaction_ref || null,
      true
    );
  };

  const handleMarkUnpaid = async (voucher: VoucherRow) => {
    setBusyId(voucher.id);
    try {
      const res = await fetch('/api/fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_unpaid', voucher_id: voucher.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to reset voucher', description: data.error, variant: 'error' });
        return;
      }
      toast({ title: `Voucher ${voucher.voucher_number} marked Unpaid`, variant: 'info' });
      void loadData();
    } finally {
      setBusyId(null);
    }
  };

  const handleSendReminder = async (target: 'single' | 'all_unpaid', voucherId?: string) => {
    setBusyId(voucherId || 'all_reminders');
    try {
      const res = await fetch('/api/fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_reminder',
          target,
          voucher_id: voucherId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to send reminder', description: data.error, variant: 'error' });
        return;
      }
      toast({
        title: `${data.remindersSent || 0} fee reminder(s) pushed`,
        description: 'Delivered to Student Portal & Student App.',
        variant: 'success',
      });
      void loadData();
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteVoucher = async (voucher: VoucherRow) => {
    setBusyId(voucher.id);
    try {
      const res = await fetch(`/api/fees?id=${encodeURIComponent(voucher.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to delete voucher', description: data.error, variant: 'error' });
        return;
      }
      toast({ title: `Voucher ${voucher.voucher_number} deleted`, variant: 'info' });
      void loadData();
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveRate = async (
    targetType: 'class' | 'student',
    targetId: string,
    feeVal: string,
    discountVal?: string
  ) => {
    setBusyId(targetId);
    try {
      const res = await fetch('/api/fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_fee_rates',
          target_type: targetType,
          target_id: targetId,
          monthly_fee_pkr: Number(feeVal || 0),
          discount_pkr: discountVal !== undefined ? Number(discountVal || 0) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unable to save fee rate', description: data.error, variant: 'error' });
        return;
      }
      toast({ title: 'Fee rate updated', variant: 'success' });
      void loadData();
    } finally {
      setBusyId(null);
    }
  };

  const voucherColumns: TableColumn<VoucherRow>[] = [
    {
      key: 'vno',
      header: 'Voucher',
      render: (r) => (
        <div>
          <p className="font-mono-tabular font-semibold text-slate-900 dark:text-white">{r.voucher_number}</p>
          <p className="font-mono-tabular text-[10px] text-slate-500">Due: {r.due_date}</p>
        </div>
      ),
      exportValue: (r) => r.voucher_number,
    },
    {
      key: 'stu',
      header: 'Student',
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{r.studentName}</p>
          <p className="text-[10px] text-slate-500">
            {r.admissionNo} · {r.className}
          </p>
        </div>
      ),
      exportValue: (r) => `${r.studentName} (${r.admissionNo})`,
    },
    {
      key: 'month',
      header: 'Month',
      render: (r) => <span className="font-mono-tabular">{r.billing_month}</span>,
      exportValue: (r) => r.billing_month,
    },
    {
      key: 'net',
      header: 'Net (PKR)',
      align: 'right',
      render: (r) => <span className="font-mono-tabular">{Number(r.total_amount_pkr).toLocaleString()}</span>,
      exportValue: (r) => Number(r.total_amount_pkr),
    },
    {
      key: 'paid',
      header: 'Paid / Balance',
      align: 'right',
      render: (r) => {
        const bal = Math.max(0, Number(r.total_amount_pkr) - Number(r.paid_amount_pkr));
        return (
          <div className="font-mono-tabular">
            <p className="text-emerald-700 dark:text-emerald-400">{Number(r.paid_amount_pkr).toLocaleString()}</p>
            <p className="text-[10px] text-slate-500">Due: {bal.toLocaleString()}</p>
          </div>
        );
      },
      exportValue: (r) => Number(r.paid_amount_pkr),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <VoucherStatusBadge status={r.status} />,
      exportValue: (r) => r.status,
    },
    {
      key: 'app',
      header: 'Portal Sync',
      render: (r) =>
        r.studentAppEnabled ? (
          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
            <Smartphone className="h-3 w-3" />
            Synced
          </span>
        ) : (
          <Link
            href="/dashboard/app-access/students"
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:underline"
          >
            <Smartphone className="h-3 w-3" />
            Not Linked
          </Link>
        ),
      exportValue: (r) => (r.studentAppEnabled ? 'Synced' : 'Not Linked'),
    },
    {
      key: 'act',
      header: 'Actions',
      align: 'right',
      render: (r) => {
        const isPaid = r.status?.toLowerCase() === 'paid';
        const balance = Math.max(0, Number(r.total_amount_pkr) - Number(r.paid_amount_pkr));
        const isBusy = busyId === r.id;

        return (
          <div className="flex flex-wrap justify-end gap-1">
            {!isPaid && (
              <>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => submitPayment(r, balance > 0 ? balance : Number(r.total_amount_pkr), 'Cash', null, false)}
                  className="inline-flex items-center gap-1 rounded bg-emerald-700 hover:bg-emerald-800 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                  title="Mark full fee paid via Cash"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Mark Paid
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    setPayForm({
                      amount_paid: String(balance),
                      payment_method: 'Cash',
                      transaction_ref: '',
                    });
                    setPayTarget(r);
                  }}
                  className="rounded bg-teal-700 hover:bg-teal-800 px-2 py-1 text-[11px] font-semibold text-white"
                >
                  Pay / Receipt
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleSendReminder('single', r.id)}
                  className="rounded border border-amber-300 dark:border-amber-800 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  title="Send fee reminder to Student Portal & App"
                >
                  <BellRing className="h-3 w-3" />
                </button>
              </>
            )}

            {Number(r.paid_amount_pkr) > 0 && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => handleMarkUnpaid(r)}
                className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Reset payment to Unpaid"
              >
                <RotateCcw className="h-3 w-3" />
                Mark Unpaid
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                generateFeeVoucherPdf(
                  { nameEn: school.name_en, address: school.address, city: school.city, phone: school.phone },
                  {
                    voucher_no: r.voucher_number,
                    studentName: r.studentName,
                    admissionNo: r.admissionNo,
                    className: r.className,
                    billing_month: r.billing_month,
                    due_date: r.due_date,
                    gross_amount: r.tuition_amount_pkr,
                    discount_amount: r.discount_pkr,
                    fine_amount: r.fine_pkr,
                    net_amount: r.total_amount_pkr,
                    paid_amount: r.paid_amount_pkr,
                    status: r.status,
                  }
                )
              }
              className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px]"
            >
              PDF
            </button>

            {Number(r.paid_amount_pkr) === 0 && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => handleDeleteVoucher(r)}
                className="rounded border border-red-200 dark:border-red-900 p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                title="Delete unpaid voucher"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const voucherNumberMap = useMemo(
    () => new Map(rawVouchers.map((v) => [v.id, v])),
    [rawVouchers]
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-teal-50 dark:bg-teal-950/50 p-2 text-teal-700 dark:text-teal-300">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                Monthly Auto-Challan & Student Portal Sync
              </h2>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                  feeSettings.auto_generate_monthly
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                }`}
              >
                {feeSettings.auto_generate_monthly ? 'Auto-Monthly Active' : 'Manual Mode'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Auto-generates on day <strong>{feeSettings.generate_day}</strong> · Due day{' '}
              <strong>{feeSettings.due_day}</strong> · Grace <strong>{feeSettings.grace_days}d</strong> · Late fine{' '}
              <strong>PKR {feeSettings.late_fine_pkr.toLocaleString()}</strong> · Portal & App Sync{' '}
              <strong>{feeSettings.sync_to_student_app ? 'On' : 'Off'}</strong>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busyId === 'all_reminders'}
            onClick={() => handleSendReminder('all_unpaid')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-800 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
          >
            <BellRing className="h-3.5 w-3.5" />
            Remind All Unpaid
          </button>
          <button
            type="button"
            onClick={() => setOpenSettingsModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Auto Settings
          </button>
          <button
            type="button"
            onClick={() => setOpenAutoModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-teal-700 hover:bg-slate-800 dark:hover:bg-teal-600 px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Generate Monthly Challans
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-[11px] font-medium text-slate-500">Total Billed</p>
          <p className="mt-1 font-mono-tabular text-lg font-bold text-slate-900 dark:text-white">
            PKR {stats.totalBilled.toLocaleString()}
          </p>
          <p className="text-[10px] text-slate-400">{stats.countAll} total voucher(s)</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Paid Collected</p>
          <p className="mt-1 font-mono-tabular text-lg font-bold text-emerald-700 dark:text-emerald-300">
            PKR {stats.totalPaid.toLocaleString()}
          </p>
          <p className="text-[10px] text-slate-400">{stats.countPaid} paid · {stats.countPartial} partial</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Unpaid / Balance Due</p>
          <p className="mt-1 font-mono-tabular text-lg font-bold text-amber-700 dark:text-amber-300">
            PKR {stats.totalPending.toLocaleString()}
          </p>
          <p className="text-[10px] text-slate-400">{stats.countUnpaid + stats.countPartial + stats.countOverdue} pending</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-[11px] font-medium text-red-600 dark:text-red-400">Overdue Challans</p>
          <p className="mt-1 font-mono-tabular text-lg font-bold text-red-600 dark:text-red-400">
            {stats.countOverdue}
          </p>
          <p className="text-[10px] text-slate-400">Past due + {feeSettings.grace_days}d grace</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'vouchers', label: `Fee Vouchers (${vouchers.length})`, icon: CreditCard },
            { id: 'receipts', label: `Payment Receipts (${payments.length})`, icon: Receipt },
            { id: 'rates', label: 'Class & Student Fee Rates', icon: SlidersHorizontal },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveView(tab.id as typeof activeView)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold ${
                  active
                    ? 'bg-teal-700 text-white'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <Link
          href="/student-portal"
          target="_blank"
          className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline"
        >
          Open Student Portal View
        </Link>
      </div>

      {activeView === 'vouchers' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'all', label: `All (${stats.countAll})` },
                { key: 'unpaid', label: `Unpaid (${stats.countUnpaid})` },
                { key: 'partial', label: `Partial (${stats.countPartial})` },
                { key: 'paid', label: `Paid (${stats.countPaid})` },
                { key: 'overdue', label: `Overdue (${stats.countOverdue})` },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setStatusFilter(t.key as typeof statusFilter)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    statusFilter === t.key
                      ? 'bg-slate-900 dark:bg-teal-700 text-white'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5"
              >
                <option value="all">All Months</option>
                {availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5"
              >
                <option value="all">All Classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <DataTable
            title="Student Fee Vouchers"
            subtitle="Auto-generated and manual PKR challans synced to Student Portal & App."
            rows={filteredVouchers}
            columns={voucherColumns}
            loading={loading}
            getRowKey={(r) => r.id}
            getSearchText={(r) => `${r.voucher_number} ${r.studentName} ${r.admissionNo} ${r.billing_month} ${r.className}`}
            exportFileName="fee-vouchers"
            primaryAction={
              <button
                type="button"
                onClick={() => {
                  const firstId = students[0]?.id || '';
                  if (firstId) prefillStudentFee(firstId);
                  setOpenVoucher(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Single Voucher
              </button>
            }
          />
        </div>
      )}

      {activeView === 'receipts' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="font-display text-sm font-bold mb-4">Verified Fee Payment Receipts</h2>
          {payments.length === 0 ? (
            <p className="text-xs text-slate-500">No payments recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 pr-3">Receipt No</th>
                    <th className="py-2 pr-3">Student</th>
                    <th className="py-2 pr-3">Voucher</th>
                    <th className="py-2 pr-3">Method</th>
                    <th className="py-2 pr-3">Reference</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Paid At</th>
                    <th className="py-2 text-right">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {payments.map((p) => {
                    const stu = studentMap.get(p.student_id);
                    const v = voucherNumberMap.get(p.voucher_id);
                    return (
                      <tr key={p.id}>
                        <td className="py-2.5 pr-3 font-mono-tabular font-semibold">{p.receipt_no}</td>
                        <td className="py-2.5 pr-3">
                          {stu?.name_en || 'Student'} ({stu?.admission_number || ''})
                        </td>
                        <td className="py-2.5 pr-3 font-mono-tabular">{v?.voucher_number || '—'}</td>
                        <td className="py-2.5 pr-3">{p.payment_method}</td>
                        <td className="py-2.5 pr-3 text-slate-500">{p.transaction_ref || 'Counter'}</td>
                        <td className="py-2.5 pr-3 font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400">
                          PKR {Number(p.amount_paid).toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-500">
                          {new Date(p.paid_at).toLocaleString()}
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              generateFeeReceiptPdf(
                                {
                                  nameEn: school.name_en,
                                  address: school.address,
                                  city: school.city,
                                  phone: school.phone,
                                },
                                {
                                  receipt_no: p.receipt_no,
                                  studentName: stu?.name_en || 'Student',
                                  admissionNo: stu?.admission_number || '',
                                  voucherNo: v?.voucher_number || '—',
                                  amount_paid: p.amount_paid,
                                  payment_method: p.payment_method,
                                  transaction_ref: p.transaction_ref,
                                  paid_at: p.paid_at,
                                }
                              )
                            }
                            className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold"
                          >
                            Receipt PDF
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeView === 'rates' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div>
              <h2 className="font-display text-sm font-bold">Class Monthly Tuition Fees</h2>
              <p className="text-xs text-slate-500">
                Used automatically when generating monthly fee challans for students in each class.
              </p>
            </div>
            <div className="space-y-2.5 text-xs">
              {classes.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <span className="font-semibold">{c.name}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={rateEdits[c.id] ?? '0'}
                      onChange={(e) => setRateEdits({ ...rateEdits, [c.id]: e.target.value })}
                      className="w-28 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono-tabular text-xs"
                    />
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => handleSaveRate('class', c.id, rateEdits[c.id] ?? '0')}
                      className="rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div>
              <h2 className="font-display text-sm font-bold">Student Fee & Discount Overrides</h2>
              <p className="text-xs text-slate-500">
                Optional custom fee or concession per student (overrides class tuition if &gt; 0).
              </p>
            </div>
            <div className="space-y-2.5 text-xs max-h-[420px] overflow-y-auto">
              {students.map((s) => {
                const edit = studentRateEdits[s.id] ?? { fee: '0', discount: '0' };
                return (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                    <div>
                      <p className="font-semibold">{s.name_en}</p>
                      <p className="text-[10px] text-slate-500">
                        {s.admission_number} · {s.class_id ? classMap.get(s.class_id)?.name : 'Unassigned'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        title="Custom Monthly Fee"
                        placeholder="Fee"
                        value={edit.fee}
                        onChange={(e) =>
                          setStudentRateEdits({
                            ...studentRateEdits,
                            [s.id]: { ...edit, fee: e.target.value },
                          })
                        }
                        className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 font-mono-tabular text-xs"
                      />
                      <input
                        type="number"
                        min={0}
                        title="Monthly Discount"
                        placeholder="Disc"
                        value={edit.discount}
                        onChange={(e) =>
                          setStudentRateEdits({
                            ...studentRateEdits,
                            [s.id]: { ...edit, discount: e.target.value },
                          })
                        }
                        className="w-20 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 font-mono-tabular text-xs"
                      />
                      <button
                        type="button"
                        disabled={busyId === s.id}
                        onClick={() => handleSaveRate('student', s.id, edit.fee, edit.discount)}
                        className="rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <ModalDialog
        open={openAutoModal}
        onClose={() => setOpenAutoModal(false)}
        title="Generate Monthly Fee Challans & Sync to Portal"
        subtitle="Creates challans for all active students who do not yet have a voucher for the selected month."
      >
        <form onSubmit={handleGenerateMonthlyBatch} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium">Billing Month *</label>
            <input
              type="month"
              required
              value={autoMonth}
              onChange={(e) => setAutoMonth(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
            <p>
              <strong>Fee priority:</strong> Student Monthly Fee → Class Tuition Fee → Default Monthly Fee, minus Student Discount.
            </p>
            <p>
              <strong>Active students:</strong> {students.length} · <strong>Due date:</strong>{' '}
              {autoMonth}-{String(feeSettings.due_day).padStart(2, '0')}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpenAutoModal(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={autoBusy}
              className="rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {autoBusy ? 'Generating...' : 'Generate & Sync to Portal'}
            </button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        open={openSettingsModal}
        onClose={() => setOpenSettingsModal(false)}
        title="Auto Monthly Challan Settings"
        subtitle="Configure automatic monthly generation, due/overdue rules, and Student Portal delivery."
      >
        <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
          <label className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">Auto-Generate Every Month</p>
              <p className="text-[11px] text-slate-500">
                Automatically issue monthly challans for active students on the scheduled day.
              </p>
            </div>
            <input
              type="checkbox"
              checked={feeSettings.auto_generate_monthly}
              onChange={(e) =>
                setFeeSettings({ ...feeSettings, auto_generate_monthly: e.target.checked })
              }
              className="h-4 w-4 accent-teal-700"
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">Sync Challans & Receipts to Portal</p>
              <p className="text-[11px] text-slate-500">
                Push live challan, payment, and fee reminder alerts to Student Portal & App.
              </p>
            </div>
            <input
              type="checkbox"
              checked={feeSettings.sync_to_student_app}
              onChange={(e) =>
                setFeeSettings({ ...feeSettings, sync_to_student_app: e.target.checked })
              }
              className="h-4 w-4 accent-teal-700"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Generate Day (1–28)</label>
              <input
                type="number"
                min={1}
                max={28}
                required
                value={feeSettings.generate_day}
                onChange={(e) =>
                  setFeeSettings({ ...feeSettings, generate_day: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium">Due Day (1–28)</label>
              <input
                type="number"
                min={1}
                max={28}
                required
                value={feeSettings.due_day}
                onChange={(e) =>
                  setFeeSettings({ ...feeSettings, due_day: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium">Grace Days Before Overdue</label>
              <input
                type="number"
                min={0}
                max={30}
                value={feeSettings.grace_days}
                onChange={(e) =>
                  setFeeSettings({ ...feeSettings, grace_days: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium">Auto Late Fine (PKR)</label>
              <input
                type="number"
                min={0}
                value={feeSettings.late_fine_pkr}
                onChange={(e) =>
                  setFeeSettings({ ...feeSettings, late_fine_pkr: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block font-medium">Default Monthly Fee Fallback (PKR)</label>
              <input
                type="number"
                min={0}
                value={feeSettings.default_monthly_fee_pkr}
                onChange={(e) =>
                  setFeeSettings({
                    ...feeSettings,
                    default_monthly_fee_pkr: Number(e.target.value),
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpenSettingsModal(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={autoBusy}
              className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {autoBusy ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog open={openVoucher} onClose={() => setOpenVoucher(false)} title="Issue Student Fee Voucher">
        <form onSubmit={handleCreateVoucher} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Student *</label>
            <select
              required
              value={vForm.student_id}
              onChange={(e) => prefillStudentFee(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="">Select Student</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_en} ({s.admission_number})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Billing Month *</label>
              <input
                type="month"
                required
                value={vForm.billing_month}
                onChange={(e) => setVForm({ ...vForm, billing_month: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium">Due Date *</label>
              <input
                type="date"
                required
                value={vForm.due_date}
                onChange={(e) => setVForm({ ...vForm, due_date: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block font-medium">Challan Type / Fund Category *</label>
              <select
                value={vForm.fee_category}
                onChange={(e) => setVForm({ ...vForm, fee_category: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="Monthly Tuition Fee">Monthly Tuition Fee</option>
                <option value="Paper Funds">Paper Funds / Exam Fee</option>
                <option value="New Books & Stationery">New Books & Stationery</option>
                <option value="School Uniform">School Uniform</option>
                <option value="Annual Sports & Activities">Annual Sports & Activities</option>
                <option value="Transport / Bus Fee">Transport / Bus Fee</option>
                <option value="Laboratory / Computer Fund">Laboratory / Computer Fund</option>
                <option value="Custom Fund / Item">Other Custom Fund / Item (Specify below)</option>
              </select>
            </div>
            {vForm.fee_category === 'Custom Fund / Item' && (
              <div className="col-span-2">
                <label className="block font-medium">Custom Fund / Item Name *</label>
                <input
                  required
                  value={vForm.custom_category}
                  onChange={(e) => setVForm({ ...vForm, custom_category: e.target.value })}
                  placeholder="e.g. Science Exhibition Fee, ID Card Replacement"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            )}
            <div>
              <label className="block font-medium">Amount (PKR)</label>
              <input
                type="number"
                required
                value={vForm.gross_amount}
                onChange={(e) => setVForm({ ...vForm, gross_amount: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium">Discount (PKR)</label>
              <input
                type="number"
                value={vForm.discount_amount}
                onChange={(e) => setVForm({ ...vForm, discount_amount: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block font-medium">Late Fine (PKR)</label>
              <input
                type="number"
                value={vForm.fine_amount}
                onChange={(e) => setVForm({ ...vForm, fine_amount: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpenVoucher(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={autoBusy}
              className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {autoBusy ? 'Issuing...' : 'Create Voucher'}
            </button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        open={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title={`Record Verified Payment — ${payTarget?.voucher_number || ''}`}
      >
        <form onSubmit={handleRecordPayment} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Payment Amount (PKR) *</label>
            <input
              type="number"
              required
              min="1"
              value={payForm.amount_paid}
              onChange={(e) => setPayForm({ ...payForm, amount_paid: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">Payment Channel *</label>
            <select
              value={payForm.payment_method}
              onChange={(e) =>
                setPayForm({ ...payForm, payment_method: e.target.value as typeof payForm.payment_method })
              }
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="Cash">Cash Counter</option>
              <option value="Bank">Bank Transfer / Challan</option>
              <option value="JazzCash">JazzCash</option>
              <option value="Easypaisa">Easypaisa</option>
            </select>
          </div>
          <div>
            <label className="block font-medium">Transaction Reference / Slip No.</label>
            <input
              value={payForm.transaction_ref}
              onChange={(e) => setPayForm({ ...payForm, transaction_ref: e.target.value })}
              placeholder="Optional for Cash · Recommended for Bank/JazzCash/Easypaisa"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPayTarget(null)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(payTarget && busyId === payTarget.id)}
              className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              Verify & Download Receipt PDF
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
