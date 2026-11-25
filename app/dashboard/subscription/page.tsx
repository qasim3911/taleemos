'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import type { BillingPeriod, SubscriptionPlanRecord } from '@/lib/types/database';

interface RequestRow {
  id: string;
  billing_period: string;
  request_type: string;
  payment_method: string;
  transaction_ref: string;
  amount_pkr: number;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  plan_id: string;
  amount_pkr: number;
  status: string;
  payment_method: string | null;
  created_at: string;
}

export default function MySubscriptionPage() {
  const { school, entitlements } = useSchool();
  const { toast } = useToast();

  const [plans, setPlans] = useState<SubscriptionPlanRecord[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanRecord | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('Monthly');
  const [paymentMethod, setPaymentMethod] = useState<'Bank Transfer' | 'JazzCash' | 'Easypaisa' | 'Cash'>('Bank Transfer');
  const [transactionRef, setTransactionRef] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const [{ data: pRows }, { data: rRows }, { data: iRows }] = await Promise.all([
      supabase.from('subscription_plans').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('subscription_requests').select('*').eq('school_id', school.id).order('created_at', { ascending: false }),
      supabase.from('subscription_invoices').select('*').eq('school_id', school.id).order('created_at', { ascending: false }),
    ]);
    setPlans(pRows ?? []);
    setRequests(rRows ?? []);
    setInvoices(iRows ?? []);
    setLoading(false);
  }, [school.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const ch = supabase
      .channel(`sub-sync-${school.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions', filter: `school_id=eq.${school.id}` }, () => window.location.reload())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'subscription_requests', filter: `school_id=eq.${school.id}` }, () => window.location.reload())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadData, school.id]);

  const getPriceForPeriod = (plan: SubscriptionPlanRecord, period: BillingPeriod) => {
    const monthly = Number(plan.price_monthly_pkr || 0);
    if (period === 'Quarterly') return monthly * 3;
    if (period === '6 Months') return monthly * 6;
    if (period === 'Yearly') return Number(plan.price_yearly_pkr || monthly * 12);
    return monthly;
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan) return;
    setSubmitting(true);
    try {
      let proofUrl = '';
      if (proofFile) {
        const supabase = createSupabaseBrowserClient();
        if (supabase) {
          const path = `${school.id}/payment-proofs/proof-${Date.now()}-${proofFile.name}`;
          const { error: upErr } = await supabase.storage.from('documents').upload(path, proofFile);
          if (!upErr) {
            const { data: signed } = await supabase.storage.from('documents').createSignedUrl(path, 60 * 60 * 24 * 365);
            if (signed?.signedUrl) {
              proofUrl = signed.signedUrl;
            }
          }
        }
      }

      const amount = getPriceForPeriod(selectedPlan, billingPeriod);
      const res = await fetch('/api/subscription/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requested_plan_id: selectedPlan.id,
          billing_period: billingPeriod,
          request_type: entitlements.planName === selectedPlan.name ? 'Renewal' : 'Upgrade',
          payment_method: paymentMethod,
          transaction_ref: transactionRef,
          amount_pkr: amount,
          proof_url: proofUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Submission failed', description: data.error, variant: 'error' });
        return;
      }
      toast({
        title: 'Renewal / Upgrade Request Submitted',
        description: 'Super Admin will verify payment and activate your subscription.',
        variant: 'success',
      });
      setSelectedPlan(null);
      setTransactionRef('');
      setProofFile(null);
      loadData();
    } finally {
      setSubmitting(false);
    }
  };

  const planNameMap = new Map(plans.map((p) => [p.id, p.name]));

  const reqColumns: TableColumn<RequestRow>[] = [
    { key: 'type', header: 'Request Type', render: (r) => `${r.request_type} (${r.billing_period})` },
    { key: 'method', header: 'Method', render: (r) => r.payment_method },
    { key: 'ref', header: 'Reference', render: (r) => <span className="font-mono-tabular">{r.transaction_ref}</span> },
    { key: 'amt', header: 'Amount (PKR)', align: 'right', render: (r) => <span className="font-mono-tabular">{Number(r.amount_pkr).toLocaleString()}</span> },
    { key: 'status', header: 'Verification', render: (r) => <span className="font-semibold">{r.status}</span> },
  ];

  const invColumns: TableColumn<InvoiceRow>[] = [
    { key: 'no', header: 'Invoice No', render: (r) => <span className="font-mono-tabular font-semibold">{r.invoice_number}</span> },
    { key: 'plan', header: 'Plan', render: (r) => planNameMap.get(r.plan_id) || r.plan_id },
    { key: 'amt', header: 'Amount (PKR)', align: 'right', render: (r) => <span className="font-mono-tabular">{Number(r.amount_pkr).toLocaleString()}</span> },
    { key: 'method', header: 'Method', render: (r) => r.payment_method || '—' },
    { key: 'status', header: 'Status', render: (r) => r.status },
    { key: 'date', header: 'Issued Date', render: (r) => <span className="font-mono-tabular">{new Date(r.created_at).toLocaleDateString()}</span> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">My Subscription</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Subscription plans, official PKR prices, and plan limits are controlled exclusively by the Super Admin Panel.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <p className="text-xs text-slate-500">Current Plan</p>
          <p className="mt-1 font-display text-xl font-bold">{entitlements.planName}</p>
          <p className="mt-1 text-xs text-slate-500">
            Status: <span className="font-semibold text-slate-900 dark:text-white">{entitlements.subscriptionStatus}</span> · {entitlements.billingPeriod}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <p className="text-xs text-slate-500">Validity Period</p>
          <p className="mt-1 font-mono-tabular text-sm font-semibold">
            {entitlements.startDate ? new Date(entitlements.startDate).toLocaleDateString() : '—'} →{' '}
            {entitlements.expiryDate ? new Date(entitlements.expiryDate).toLocaleDateString() : 'Unlimited / Active'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <p className="text-xs text-slate-500">Student Quota Usage</p>
          <p className="mt-1 font-mono-tabular text-xl font-bold">
            {entitlements.currentStudents} / {entitlements.maxStudents || '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Remaining: {Math.max(0, entitlements.maxStudents - entitlements.currentStudents)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <p className="text-xs text-slate-500">Teacher Quota Usage</p>
          <p className="mt-1 font-mono-tabular text-xl font-bold">
            {entitlements.currentTeachers} / {entitlements.maxTeachers || '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Storage Limit: {entitlements.maxStorageMb} MB
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
        <h2 className="font-display text-base font-bold">Available Super Admin Plans</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Select a plan below to request renewal or upgrade and upload your payment proof.
        </p>

        {plans.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            No active plans published in Supabase `subscription_plans` table yet.
          </p>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 p-5"
              >
                <div>
                  <p className="text-xs font-medium text-teal-700 dark:text-teal-400">{plan.tagline || plan.code.toUpperCase()}</p>
                  <h3 className="mt-1 font-display text-lg font-bold">{plan.name}</h3>
                  <p className="mt-2 font-mono-tabular text-xl font-bold">
                    PKR {Number(plan.price_monthly_pkr).toLocaleString()}
                    <span className="text-xs font-normal text-slate-500"> / month</span>
                  </p>
                  <ul className="mt-4 space-y-1.5 text-xs text-slate-600 dark:text-slate-300 font-mono-tabular">
                    <li>Students: Up to {plan.student_limit}</li>
                    <li>Teachers: Up to {plan.teacher_limit}</li>
                    <li>Storage: {plan.storage_limit_mb} MB</li>
                  </ul>
                  {Array.isArray(plan.features) && plan.features.length > 0 && (
                    <ul className="mt-3 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {plan.features.slice(0, 4).map((feat) => (
                        <li key={feat}>• {feat}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPlan(plan)}
                  className="mt-5 w-full rounded-lg bg-teal-700 hover:bg-teal-800 px-3 py-2 text-xs font-semibold text-white"
                >
                  Request Upgrade / Renewal
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <DataTable
        title="Submitted Payment & Renewal Requests"
        rows={requests}
        columns={reqColumns}
        loading={loading}
        getRowKey={(r) => r.id}
      />

      <DataTable
        title="Subscription Invoice History"
        rows={invoices}
        columns={invColumns}
        loading={loading}
        getRowKey={(r) => r.id}
      />

      <ModalDialog
        open={Boolean(selectedPlan)}
        onClose={() => setSelectedPlan(null)}
        title={`Request ${selectedPlan?.name || ''} Plan`}
        subtitle="Super Admin reviews your payment proof before activating the subscription."
      >
        {selectedPlan && (
          <form onSubmit={handleSubmitRequest} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium">Billing Period</label>
                <select value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value as BillingPeriod)} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                  <option value="Monthly">Monthly (PKR {Number(selectedPlan.price_monthly_pkr).toLocaleString()})</option>
                  <option value="Quarterly">Quarterly (PKR {(Number(selectedPlan.price_monthly_pkr) * 3).toLocaleString()})</option>
                  <option value="6 Months">6 Months (PKR {(Number(selectedPlan.price_monthly_pkr) * 6).toLocaleString()})</option>
                  <option value="Yearly">Yearly (PKR {Number(selectedPlan.price_yearly_pkr).toLocaleString()})</option>
                </select>
              </div>
              <div>
                <label className="block font-medium">Payment Method</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="JazzCash">JazzCash</option>
                  <option value="Easypaisa">Easypaisa</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-medium">Transaction ID / Reference *</label>
              <input required value={transactionRef} onChange={(e) => setTransactionRef(e.target.value)} placeholder="TID / IBFT Ref" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Upload Payment Screenshot / Receipt</label>
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setProofFile(e.target.files?.[0] || null)} className="mt-1 w-full text-xs" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setSelectedPlan(null)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
              <button type="submit" disabled={submitting} className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">
                {submitting ? 'Submitting...' : 'Submit Payment Proof'}
              </button>
            </div>
          </form>
        )}
      </ModalDialog>
    </div>
  );
}
