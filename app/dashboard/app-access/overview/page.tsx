'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, Copy, ExternalLink } from 'lucide-react';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { useToast } from '@/components/providers/toast-provider';
import type { PortalDirectoryAccount } from '@/app/api/app-access/directory/route';

interface InviteLogRow {
  id: string;
  target_type: string;
  email: string;
  action: string;
  status: string;
  created_at: string;
}

export default function MobileAppOverviewPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<PortalDirectoryAccount[]>([]);
  const [conflictsCount, setConflictsCount] = useState(0);
  const [logs, setLogs] = useState<InviteLogRow[]>([]);
  const [roleFilter, setRoleFilter] = useState<'all' | 'teacher' | 'student' | 'guardian' | 'school_admin'>('all');
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadDirectory = useCallback(async () => {
    try {
      const res = await fetch('/api/app-access/directory', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAccounts(data.accounts ?? []);
        setConflictsCount(Number(data.conflictsCount || 0));
        setLogs(data.logs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadDirectory();
    });
  }, [loadDirectory]);

  const stats = useMemo(() => {
    const tRows = accounts.filter((a) => a.role === 'teacher');
    const sRows = accounts.filter((a) => a.role === 'student');
    const gRows = accounts.filter((a) => a.role === 'guardian');
    return {
      tTotal: tRows.length,
      tActive: tRows.filter((r) => r.status.toLowerCase().includes('active') || r.status === 'Activated').length,
      tDisabled: tRows.filter((r) => r.status.toLowerCase().includes('block') || r.status.toLowerCase().includes('suspend') || r.status.toLowerCase().includes('disable') || r.status.toLowerCase().includes('revoke')).length,
      tPending: tRows.filter((r) => r.status.toLowerCase().includes('pending') || r.status === 'QR Generated' || r.status === 'Awaiting Activation' || r.status === 'Registered').length,
      sTotal: sRows.length,
      sActive: sRows.filter((r) => r.status.toLowerCase().includes('active') || r.status === 'Activated').length,
      sDisabled: sRows.filter((r) => r.status.toLowerCase().includes('block') || r.status.toLowerCase().includes('suspend') || r.status.toLowerCase().includes('disable') || r.status.toLowerCase().includes('revoke')).length,
      sPending: sRows.filter((r) => r.status.toLowerCase().includes('pending') || r.status === 'QR Generated' || r.status === 'Awaiting Activation' || r.status === 'Registered').length,
      gTotal: gRows.length,
      gActive: gRows.filter((r) => r.status.toLowerCase().includes('active') || r.status === 'Activated').length,
      gDisabled: gRows.filter((r) => r.status.toLowerCase().includes('block') || r.status.toLowerCase().includes('suspend') || r.status.toLowerCase().includes('disable') || r.status.toLowerCase().includes('revoke')).length,
      gPending: gRows.filter((r) => r.status.toLowerCase().includes('pending') || r.status === 'QR Generated' || r.status === 'Awaiting Activation' || r.status === 'Registered').length,
    };
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    if (roleFilter === 'all') return accounts;
    return accounts.filter((a) => a.role === roleFilter);
  }, [accounts, roleFilter]);

  const handleCopy = async (row: PortalDirectoryAccount) => {
    if (!row.email) return;
    await navigator.clipboard.writeText(row.email).catch(() => null);
    setCopiedId(row.id);
    toast({
      title: `${row.roleLabel} contact copied`,
      description: `${row.name}: ${row.email}`,
      variant: 'success',
    });
    setTimeout(() => setCopiedId((prev) => (prev === row.id ? null : prev)), 1800);
  };

  const directoryColumns: TableColumn<PortalDirectoryAccount>[] = [
    {
      key: 'role',
      header: 'Portal / Role',
      render: (r) => {
        const badgeCls =
          r.role === 'school_admin'
            ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700'
            : r.role === 'teacher'
              ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900'
              : r.role === 'guardian'
                ? 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-900'
                : 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-900';
        return (
          <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${badgeCls}`}>
            {r.roleLabel}
          </span>
        );
      },
      exportValue: (r) => r.roleLabel,
    },
    {
      key: 'person',
      header: 'Name & Code',
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{r.name}</p>
          <p className="text-[11px] text-slate-500">
            <span className="font-mono-tabular font-semibold">{r.code}</span> · {r.subtitle}
          </p>
        </div>
      ),
      exportValue: (r) => `${r.name} (${r.code})`,
    },
    {
      key: 'email',
      header: 'Registered Login Email',
      render: (r) => (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono-tabular text-xs font-medium text-slate-900 dark:text-slate-100">
              {r.email || 'Not assigned'}
            </span>
            {r.email && !r.email.endsWith('@school.local') && (
              <button
                type="button"
                onClick={() => void handleCopy(r)}
                className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 text-[10px] hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {copiedId === r.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                {copiedId === r.id ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          {r.hasConflict && r.conflictWith && (
            <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              Conflict with {r.conflictWith}
            </p>
          )}
        </div>
      ),
      exportValue: (r) => r.email || '',
    },
    {
      key: 'status',
      header: 'Login Status',
      render: (r) => (
        <span className="capitalize font-medium text-xs">
          {r.status.replace(/_/g, ' ')}
        </span>
      ),
      exportValue: (r) => r.status,
    },
    {
      key: 'lastLogin',
      header: 'Last Login',
      render: (r) => (
        <span className="font-mono-tabular text-[11px] text-slate-500">
          {r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString() : 'Never'}
        </span>
      ),
      exportValue: (r) => r.lastLoginAt || 'Never',
    },
    {
      key: 'manage',
      header: 'Manage',
      align: 'right',
      render: (r) =>
        r.role === 'teacher' ? (
          <Link
            href="/dashboard/app-access/teachers"
            className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Teacher App
            <ExternalLink className="h-3 w-3" />
          </Link>
        ) : r.role === 'student' ? (
          <Link
            href="/dashboard/app-access/students"
            className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Student App
            <ExternalLink className="h-3 w-3" />
          </Link>
        ) : r.role === 'guardian' ? (
          <Link
            href="/dashboard/app-access/guardians"
            className="inline-flex items-center gap-1 rounded border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 px-2.5 py-1 text-[11px] font-medium hover:bg-purple-100"
          >
            Guardian App
            <ExternalLink className="h-3 w-3" />
          </Link>
        ) : (
          <span className="text-[11px] text-slate-400">School Admin</span>
        ),
    },
  ];

  const logColumns: TableColumn<InviteLogRow>[] = [
    { key: 'type', header: 'App Type', render: (r) => <span className="capitalize font-semibold">{r.target_type} App</span>, exportValue: (r) => r.target_type },
    { key: 'email', header: 'Email / Phone', render: (r) => <span className="font-mono-tabular">{r.email}</span>, exportValue: (r) => r.email },
    { key: 'action', header: 'Action', render: (r) => r.action, exportValue: (r) => r.action },
    { key: 'status', header: 'Status', render: (r) => r.status, exportValue: (r) => r.status },
    { key: 'date', header: 'Timestamp', render: (r) => <span className="font-mono-tabular">{new Date(r.created_at).toLocaleString()}</span>, exportValue: (r) => r.created_at },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Mobile App Access & Login Directory</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Control and monitor QR-based access, PIN status, and login security for Universal Teacher App, Universal Student App, and Guardian Login.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/app-access/teachers" className="rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-2 text-xs font-semibold text-white">
            Teacher App Access
          </Link>
          <Link href="/dashboard/app-access/students" className="rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold">
            Student App Access
          </Link>
          <Link href="/dashboard/app-access/guardians" className="rounded-lg bg-purple-700 hover:bg-purple-800 px-3.5 py-2 text-xs font-semibold text-white">
            Guardian App Access
          </Link>
        </div>
      </div>

      {conflictsCount > 0 && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          <span>
            <strong>{conflictsCount} duplicate email conflict(s)</strong> detected between Teacher and Student records. Teachers and Students must have separate login emails so each person signs into their own portal cleanly.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold">Universal Teacher App</h2>
            <Link href="/dashboard/app-access/teachers" className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline">
              Manage &rarr;
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat label="Registered" value={stats.tTotal} />
            <MiniStat label="Active" value={stats.tActive} />
            <MiniStat label="Disabled" value={stats.tDisabled} />
            <MiniStat label="Pending" value={stats.tPending} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold">Universal Student App</h2>
            <Link href="/dashboard/app-access/students" className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline">
              Manage &rarr;
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat label="Registered" value={stats.sTotal} />
            <MiniStat label="Active" value={stats.sActive} />
            <MiniStat label="Disabled" value={stats.sDisabled} />
            <MiniStat label="Pending" value={stats.sPending} />
          </div>
        </div>

        <div className="rounded-xl border border-purple-200 dark:border-purple-900 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-sm font-bold text-purple-950 dark:text-purple-200">Guardian App Access</h2>
              <p className="text-[10px] text-slate-500">Inside Universal Student App</p>
            </div>
            <Link href="/dashboard/app-access/guardians" className="text-xs font-medium text-purple-700 dark:text-purple-400 hover:underline">
              Manage &rarr;
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat label="Registered" value={stats.gTotal} />
            <MiniStat label="Active" value={stats.gActive} />
            <MiniStat label="Disabled" value={stats.gDisabled} />
            <MiniStat label="Pending" value={stats.gPending} />
          </div>
        </div>
      </div>

      <DataTable
        title="Remembered Login Directory (Teacher · Student · Guardian · Admin)"
        subtitle="Complete directory of all teachers, students, and guardians with mobile app status and identifiers."
        rows={filteredAccounts}
        columns={directoryColumns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.roleLabel} ${r.name} ${r.code} ${r.email || ''}`}
        exportFileName="registered-portal-login-directory"
        filters={
          <div className="flex flex-wrap gap-1.5">
            {([
              { id: 'all', label: 'All Accounts' },
              { id: 'teacher', label: 'Teacher App' },
              { id: 'student', label: 'Student App' },
              { id: 'guardian', label: 'Guardian App' },
              { id: 'school_admin', label: 'School Admin' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setRoleFilter(tab.id)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                  roleFilter === tab.id
                    ? 'bg-teal-700 text-white'
                    : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
      />

      <DataTable
        title="Invitation & Access History"
        rows={logs}
        columns={logColumns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.target_type} ${r.email} ${r.action}`}
        exportFileName="mobile-app-invitation-history"
      />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 font-mono-tabular text-xl font-bold">{value}</p>
    </div>
  );
}
