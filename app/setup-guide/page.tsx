'use client';

import React, { useEffect, useState } from 'react';
import { PublicHeader } from '@/components/public/public-header';
import { Check, Copy } from 'lucide-react';

export default function SetupGuidePage() {
  const [data, setData] = useState<{
    supabaseConfigured: boolean;
    adminConfigured: boolean;
    schemaSql: string;
    rlsSql: string;
    studentIdSql?: string;
    leaveRlsSql?: string;
    questionPapersSql?: string;
    qrAccessSql?: string;
    guardianChildrenRlsSql?: string;
  } | null>(null);
  const [copied, setCopied] = useState<
    'schema' | 'rls' | 'studentId' | 'leaveRls' | 'questionPapers' | 'qrAccess' | 'guardianChildrenRls' | null
  >(null);

  useEffect(() => {
    fetch('/api/setup-migrations')
      .then((res) => res.json())
      .then((json) => setData(json))
      .catch(() => {});
  }, []);

  const copySql = async (
    kind: 'schema' | 'rls' | 'studentId' | 'leaveRls' | 'questionPapers' | 'qrAccess' | 'guardianChildrenRls',
    text: string
  ) => {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-6 py-12 space-y-8">
        <div>
          <h1 className="font-display text-3xl font-bold">
            Supabase Connection & SQL Migration Guide
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            When you are ready to connect your live Supabase project, configure the environment
            secrets below and run the idempotent migrations in the Supabase SQL Editor.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Public Client Keys
            </p>
            <p className="mt-1 text-base font-semibold">
              {data?.supabaseConfigured ? 'Connected' : 'Pending Configuration'}
            </p>
            <p className="mt-1 font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
              NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_ANON_KEY
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Server Service Role Key
            </p>
            <p className="mt-1 text-base font-semibold">
              {data?.adminConfigured ? 'Connected' : 'Pending Configuration'}
            </p>
            <p className="mt-1 font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
              SUPABASE_SERVICE_ROLE_KEY (Server-side only)
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold">
                01. Core Multi-Tenant Schema Migration
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                supabase/migrations/001_initial_school_saas_schema.sql
              </p>
            </div>
            <button
              type="button"
              onClick={() => data?.schemaSql && copySql('schema', data.schemaSql)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {copied === 'schema' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === 'schema' ? 'Copied' : 'Copy SQL'}
            </button>
          </div>
          <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 font-mono-tabular text-xs text-slate-200">
            {data?.schemaSql || 'Loading migration SQL...'}
          </pre>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold">
                02. RLS Policies, Storage Buckets & Realtime Publication
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                supabase/migrations/002_rls_and_storage.sql
              </p>
            </div>
            <button
              type="button"
              onClick={() => data?.rlsSql && copySql('rls', data.rlsSql)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {copied === 'rls' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === 'rls' ? 'Copied' : 'Copy SQL'}
            </button>
          </div>
          <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 font-mono-tabular text-xs text-slate-200">
            {data?.rlsSql || 'Loading RLS SQL...'}
          </pre>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold">
                03. Dedicated Student ID Column Migration
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                supabase/migrations/003_add_student_id_column.sql
              </p>
            </div>
            <button
              type="button"
              onClick={() => data?.studentIdSql && copySql('studentId', data.studentIdSql)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {copied === 'studentId' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === 'studentId' ? 'Copied' : 'Copy SQL'}
            </button>
          </div>
          <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 font-mono-tabular text-xs text-slate-200">
            {data?.studentIdSql || 'Loading Student ID SQL...'}
          </pre>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold">
                04. Leave Requests App RLS & Realtime Migration
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                supabase/migrations/004_leave_requests_and_rls.sql
              </p>
            </div>
            <button
              type="button"
              onClick={() => data?.leaveRlsSql && copySql('leaveRls', data.leaveRlsSql)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {copied === 'leaveRls' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === 'leaveRls' ? 'Copied' : 'Copy SQL'}
            </button>
          </div>
          <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 font-mono-tabular text-xs text-slate-200">
            {data?.leaveRlsSql || 'Loading Leave RLS SQL...'}
          </pre>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold">
                05. Question Paper Builder Table & RLS Migration
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                supabase/migrations/005_question_papers.sql
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                data?.questionPapersSql && copySql('questionPapers', data.questionPapersSql)
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {copied === 'questionPapers' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied === 'questionPapers' ? 'Copied' : 'Copy SQL'}
            </button>
          </div>
          <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 font-mono-tabular text-xs text-slate-200">
            {data?.questionPapersSql || 'Loading Question Papers SQL...'}
          </pre>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold">
                06. QR App Access, Guardian Management & Multi-Child Linking Migration
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                supabase/migrations/006_qr_access_and_guardians.sql
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                data?.qrAccessSql && copySql('qrAccess', data.qrAccessSql)
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {copied === 'qrAccess' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied === 'qrAccess' ? 'Copied' : 'Copy SQL'}
            </button>
          </div>
          <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 font-mono-tabular text-xs text-slate-200">
            {data?.qrAccessSql || 'Loading QR App Access & Guardian Migration SQL...'}
          </pre>
        </div>

        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold">
                13. Parents / Guardians App Linked Children RLS Migration
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                supabase/migrations/013_guardian_app_children_rls.sql
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                data?.guardianChildrenRlsSql &&
                copySql('guardianChildrenRls', data.guardianChildrenRlsSql)
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {copied === 'guardianChildrenRls' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied === 'guardianChildrenRls' ? 'Copied' : 'Copy SQL'}
            </button>
          </div>
          <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 font-mono-tabular text-xs text-slate-200">
            {data?.guardianChildrenRlsSql || 'Loading Guardian App Children RLS SQL...'}
          </pre>
        </div>
      </main>
    </div>
  );
}
