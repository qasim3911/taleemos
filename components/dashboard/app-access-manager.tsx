'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  History,
  KeyRound,
  Link2,
  Mail,
  Pencil,
  Printer,
  QrCode,
  RefreshCw,
  Shield,
  ShieldAlert,
  Smartphone,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';

export type AppTargetType = 'teacher' | 'student' | 'guardian';

export interface AppAccountRow {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string;
  user_id: string | null;
  app_access_enabled: boolean;
  app_blocked: boolean;
  status: string;
  last_login_at: string | null;
  created_at: string | null;
  conflictWith: string | null;
  // Specific role metadata
  class_id?: string | null;
  className?: string;
  sectionName?: string;
  linkedChildren?: Array<{ id: string; name: string; admissionNumber: string; className: string }>;
  deviceCount?: number;
}

export function formatAppStatusLabel(status: string) {
  switch (status) {
    case 'Activated':
    case 'active':
      return 'Activated';
    case 'QR Generated':
      return 'QR Generated';
    case 'Awaiting Activation':
    case 'pending_invite':
      return 'Awaiting Activation';
    case 'PIN Reset Required':
      return 'PIN Reset Required';
    case 'Access Suspended':
    case 'blocked':
      return 'Access Suspended';
    case 'Access Disabled':
    case 'deactivated':
      return 'Access Disabled';
    case 'Access Revoked':
      return 'Access Revoked';
    default:
      return 'Registered';
  }
}

export function getStatusBadgeClass(status: string) {
  const norm = formatAppStatusLabel(status);
  switch (norm) {
    case 'Activated':
      return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900';
    case 'QR Generated':
      return 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900';
    case 'Awaiting Activation':
      return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900';
    case 'PIN Reset Required':
      return 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-900';
    case 'Access Suspended':
      return 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900';
    case 'Access Disabled':
    case 'Access Revoked':
      return 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900';
    default:
      return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  }
}

// Safe date formatter to prevent "Invalid Date" crashes
const safeDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 'Never' : d.toLocaleDateString();
};

export function AppAccessManager({
  targetType,
  title,
  subtitle,
}: {
  targetType: AppTargetType;
  title: string;
  subtitle: string;
}) {
  const { school } = useSchool();
  const { toast } = useToast();

  const [rows, setRows] = useState<AppAccountRow[]>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [classFilter, setClassFilter] = useState('All');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);

  // Email / Password Provisioning modal
  const [inviteTarget, setInviteTarget] = useState<AppAccountRow | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [bulkConfirm, setBulkConfirm] = useState<'enable' | 'disable' | null>(null);

  // QR Code Modal State
  const [qrModalData, setQrModalData] = useState<{
    target: AppAccountRow;
    qrDataUrl: string;
    qrPayload: string;
    tokenPreview: string;
    expiresAt: string;
    purpose: string;
    schoolName: string;
  } | null>(null);
  const [qrPurpose, setQrPurpose] = useState<'first_activation' | 'pin_reset'>('first_activation');
  const [qrGenerating, setQrGenerating] = useState(false);

  // History & Device Modal State
  const [historyTarget, setHistoryTarget] = useState<AppAccountRow | null>(null);
  const [historyData, setHistoryData] = useState<{
    tokens: Array<{ id: string; purpose: string; token_preview: string; status: string; expires_at: string; consumed_at?: string; created_at: string }>;
    devices: Array<{ id: string; device_id: string; device_name?: string; device_model?: string; os_version?: string; app_version?: string; status: string; last_active_at: string; created_at: string }>;
    invitationLogs: Array<{ id: string; action: string; status: string; email: string; created_at: string }>;
  } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      if (targetType === 'teacher' || targetType === 'student') {
        const res = await fetch(`/api/app-access/accounts?targetType=${targetType}`, {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            title: `Unable to load ${targetType} accounts`,
            description: data.error || 'Please refresh and try again.',
            variant: 'error',
          });
          return;
        }
        setClasses(Array.isArray(data.classes) ? data.classes : []);
        setRows(Array.isArray(data.rows) ? data.rows : []);
      } else {
        // Guardian App Access
        const res = await fetch('/api/guardians', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            title: 'Unable to load guardian accounts',
            description: data.error || 'Please refresh and try again.',
            variant: 'error',
          });
          return;
        }
        const guardians = (data.guardians ?? []) as Array<{
          id: string;
          full_name: string;
          relationship: string;
          phone: string;
          email: string | null;
          user_id?: string | null;
          app_access_enabled?: boolean;
          app_blocked?: boolean;
          status?: string;
          last_login_at?: string | null;
          created_at?: string | null;
          linkedChildren?: Array<{ id: string; name: string; admissionNumber: string; className: string }>;
        }>;

        setRows(
          guardians.map((g) => ({
            id: g.id,
            code: g.relationship || 'Guardian',
            name: g.full_name,
            email: g.email || null,
            phone: g.phone || '',
            user_id: g.user_id || null,
            app_access_enabled: Boolean(g.app_access_enabled),
            app_blocked: Boolean(g.app_blocked),
            status: g.status || 'Registered',
            last_login_at: g.last_login_at || null,
            created_at: g.created_at || null,
            conflictWith: null,
            linkedChildren: g.linkedChildren || [],
            deviceCount: 0,
          }))
        );
      }
    } catch {
      toast({
        title: 'Connection error',
        description: 'Unable to load app accounts right now. Please try again.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [targetType, toast]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadAccounts();
    });
  }, [loadAccounts]);

  const handleCopyText = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text).catch(() => null);
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
  };

  // QR Code Generation
  const handleGenerateQR = async (row: AppAccountRow, selectedPurpose?: 'first_activation' | 'pin_reset') => {
    setQrGenerating(true);
    const purposeSuffix = selectedPurpose || qrPurpose;
    const purpose = `${targetType}_${purposeSuffix}` as
      | 'teacher_first_activation'
      | 'student_first_activation'
      | 'guardian_first_activation'
      | 'teacher_pin_reset'
      | 'student_pin_reset'
      | 'guardian_pin_reset';

    try {
      const res = await fetch('/api/app-access/qr/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType,
          targetId: row.id,
          purpose,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'QR Generation failed', description: data.error || 'Unable to generate QR', variant: 'error' });
        return;
      }

      setQrModalData({
        target: row,
        qrDataUrl: data.qrDataUrl,
        qrPayload: data.qrPayload,
        tokenPreview: data.tokenPreview,
        expiresAt: data.expiresAt,
        purpose: data.purpose,
        schoolName: data.target?.schoolName || school.name_en,
      });
      toast({ title: 'Activation QR Generated', description: `Valid for 15 minutes. Scan in ${targetType === 'teacher' ? 'Teacher App' : 'Universal Student App'}.`, variant: 'success' });
      void loadAccounts();
    } finally {
      setQrGenerating(false);
    }
  };

  const handleRevokeQR = async (row: AppAccountRow) => {
    setActionBusy(true);
    try {
      const res = await fetch('/api/app-access/qr/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId: row.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Revoke error', description: data.error || 'Failed to revoke QR', variant: 'error' });
        return;
      }
      toast({ title: 'QR Revoked', description: `Active QR code for ${row.name} has been revoked.`, variant: 'success' });
      setQrModalData(null);
      void loadAccounts();
    } finally {
      setActionBusy(false);
    }
  };

  const openHistoryModal = async (row: AppAccountRow) => {
    setHistoryTarget(row);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/app-access/qr/history?targetType=${targetType}&targetId=${row.id}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setHistoryData({
          tokens: data.tokens ?? [],
          devices: data.devices ?? [],
          invitationLogs: data.invitationLogs ?? [],
        });
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleToggle = async (
    ids: string[],
    action: 'enable' | 'disable' | 'block' | 'unblock'
  ) => {
    setActionBusy(true);
    try {
      if (targetType === 'guardian') {
        // PERFORMANCE FIX: Use Promise.all for parallel requests instead of sequential await
        await Promise.all(ids.map(id =>
          fetch('/api/guardians', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id,
              app_access_enabled: action === 'enable' || action === 'unblock',
              app_blocked: action === 'block',
              app_account_status: action === 'block' ? 'blocked' : action === 'disable' ? 'deactivated' : 'active',
              access_state: action === 'block' ? 'SUSPENDED' : 'ACTIVE',
              status: 'active',
            }),
          })
        ));
      } else {
        await fetch('/api/app-access/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType, targetIds: ids, action }),
        });
      }
      toast({ title: `Updated ${ids.length} account(s)`, variant: 'success' });
      setSelectedIds([]);
      setBulkConfirm(null);
      void loadAccounts();
    } finally {
      setActionBusy(false);
    }
  };

  const openEmailManageModal = (row: AppAccountRow) => {
    const clean = row.email && !row.email.endsWith('@school.local') ? row.email : '';
    setInviteEmail(clean);
    setInvitePassword('');
    setInviteTarget(row);
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== 'All' && formatAppStatusLabel(r.status) !== statusFilter) {
        return false;
      }
      if (targetType === 'student' && classFilter !== 'All' && r.class_id !== classFilter) {
        return false;
      }
      return true;
    });
  }, [rows, statusFilter, classFilter, targetType]);

  const columns: TableColumn<AppAccountRow>[] = [
    {
      key: 'select',
      header: 'Select',
      render: (r) => (
        <input
          type="checkbox"
          checked={selectedIds.includes(r.id)}
          onChange={(e) =>
            setSelectedIds((prev) =>
              e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)
            )
          }
          aria-label={`Select ${r.name}`}
        />
      ),
    },
    {
      key: 'code',
      header: targetType === 'teacher' ? 'Emp Code' : targetType === 'student' ? 'Adm No' : 'Relationship',
      render: (r) => <span className="font-mono-tabular font-semibold text-xs">{r.code}</span>,
      exportValue: (r) => r.code,
    },
    {
      key: 'name',
      header: 'Name & Role',
      render: (r) => (
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-semibold text-slate-900 dark:text-white text-xs">{r.name}</p>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                targetType === 'teacher'
                  ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-900'
                  : targetType === 'student'
                    ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-900'
                    : 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-900'
              }`}
            >
              {targetType === 'teacher' ? 'Teacher App' : targetType === 'student' ? 'Student App' : 'Guardian Login'}
            </span>
          </div>

          {targetType === 'student' && r.className && (
            <p className="text-[11px] text-slate-500">
              {r.className} {r.sectionName ? `· ${r.sectionName}` : ''}
            </p>
          )}

          {targetType === 'guardian' && r.linkedChildren && r.linkedChildren.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <span className="text-[10px] text-slate-500 font-medium">Children:</span>
              {r.linkedChildren.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-700 dark:text-slate-300"
                >
                  <Users className="h-2.5 w-2.5" />
                  {c.name} ({c.className})
                </span>
              ))}
            </div>
          )}

          {targetType === 'guardian' && (!r.linkedChildren || r.linkedChildren.length === 0) && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              No students linked yet
            </p>
          )}

          {r.conflictWith && (
            <p className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              <ShieldAlert className="h-3 w-3 shrink-0" />
              Shared with {r.conflictWith}
            </p>
          )}
        </div>
      ),
      exportValue: (r) => r.name,
    },
    {
      key: 'contact',
      header: 'Mobile / Email',
      render: (r) => (
        <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
          <p className="font-mono-tabular font-medium flex items-center gap-1">
            <span>{r.phone || 'No phone'}</span>
          </p>
          <div className="flex items-center gap-1 text-slate-500">
            <span className="font-mono-tabular truncate max-w-[140px]">{r.email || 'No email (optional)'}</span>
            {r.email && (
              <button
                type="button"
                onClick={() => void handleCopyText(r.email!, `email-${r.id}`)}
                className="text-slate-400 hover:text-slate-600"
                title="Copy email"
              >
                {copiedId === `email-${r.id}` ? <Check className="h-2.5 w-2.5 text-emerald-600" /> : <Copy className="h-2.5 w-2.5" />}
              </button>
            )}
          </div>
        </div>
      ),
      exportValue: (r) => `${r.phone} / ${r.email || ''}`,
    },
    {
      key: 'status',
      header: 'App Access Status',
      render: (r) => {
        const norm = formatAppStatusLabel(r.status);
        const cls = getStatusBadgeClass(r.status);
        return (
          <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
            {norm}
          </span>
        );
      },
      exportValue: (r) => formatAppStatusLabel(r.status),
    },
    {
      key: 'dates',
      header: 'Last Login / Device',
      render: (r) => (
        <div className="font-mono-tabular text-[11px] text-slate-500 space-y-0.5">
          <p>Login: {safeDate(r.last_login_at)}</p>
          <p className="flex items-center gap-1">
            <Smartphone className="h-3 w-3 text-slate-400" />
            <span>{(r.deviceCount || 0) > 0 ? `${r.deviceCount} Device(s)` : 'No device'}</span>
          </p>
        </div>
      ),
      exportValue: (r) => r.last_login_at || 'Never',
    },
    {
      key: 'actions',
      header: 'QR & Access Controls',
      align: 'right',
      render: (r) => {
        // BUG FIX: Use formatted status to correctly handle lowercase 'active' or 'blocked' from DB
        const normStatus = formatAppStatusLabel(r.status);
        
        return (
          <div className="flex flex-wrap justify-end gap-1.5">
            <button
              type="button"
              onClick={() => handleGenerateQR(r, 'first_activation')}
              className="inline-flex items-center gap-1 rounded bg-teal-700 hover:bg-teal-800 px-2 py-1 text-[11px] font-semibold text-white shadow-xs"
              title="Generate Activation QR Code"
            >
              <QrCode className="h-3 w-3" />
              {normStatus === 'QR Generated' || normStatus === 'Activated' ? 'Regenerate QR' : 'Generate QR'}
            </button>

            <button
              type="button"
              onClick={() => handleGenerateQR(r, 'pin_reset')}
              className="inline-flex items-center gap-1 rounded border border-purple-300 dark:border-purple-800 bg-purple-50/70 dark:bg-purple-950/30 px-2 py-1 text-[11px] font-semibold text-purple-700 dark:text-purple-300 hover:bg-purple-100"
              title="Generate PIN Reset QR Code"
            >
              <KeyRound className="h-3 w-3" />
              PIN Reset QR
            </button>

            <button
              type="button"
              onClick={() => openHistoryModal(r)}
              className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              title="View QR History & Authorized Devices"
            >
              <History className="h-3 w-3" />
              History
            </button>

            {r.app_access_enabled && !r.app_blocked ? (
              <button
                type="button"
                onClick={() => handleToggle([r.id], 'disable')}
                className="rounded border border-amber-300 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300 hover:bg-amber-50"
              >
                Disable
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleToggle([r.id], 'enable')}
                className="rounded border border-emerald-300 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50"
              >
                Enable
              </button>
            )}

            {targetType !== 'guardian' && (
              <button
                type="button"
                onClick={() => openEmailManageModal(r)}
                className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Edit Email/Password direct setup"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        title={title}
        subtitle={subtitle}
        rows={filtered}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.code} ${r.name} ${r.phone} ${r.email || ''} ${r.status}`}
        exportFileName={`${targetType}-app-access`}
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            >
              <option value="All">All Statuses</option>
              <option value="Activated">Activated</option>
              <option value="QR Generated">QR Generated</option>
              <option value="Awaiting Activation">Awaiting Activation</option>
              <option value="PIN Reset Required">PIN Reset Required</option>
              <option value="Registered">Registered</option>
              <option value="Access Disabled">Access Disabled</option>
              <option value="Access Suspended">Access Suspended</option>
              <option value="Access Revoked">Access Revoked</option>
            </select>

            {targetType === 'student' && classes.length > 0 && (
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
            )}

            {selectedIds.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setBulkConfirm('enable')}
                  className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Bulk Enable ({selectedIds.length})
                </button>
                <button
                  type="button"
                  onClick={() => setBulkConfirm('disable')}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Bulk Disable ({selectedIds.length})
                </button>
              </>
            )}
          </div>
        }
      />

      {/* QR Code Presentation Modal */}
      <ModalDialog
        open={Boolean(qrModalData)}
        onClose={() => setQrModalData(null)}
        title={
          qrModalData?.purpose.includes('reset')
            ? `PIN Reset QR — ${qrModalData.target.name}`
            : `First-Time Activation QR — ${qrModalData?.target.name}`
        }
        subtitle="User scans this one-time QR in the mobile app and creates their secret 4-digit or 6-digit PIN."
      >
        {qrModalData && (
          <div className="space-y-4 text-xs">
            <div className="rounded-xl border border-teal-200 dark:border-teal-900 bg-teal-50/60 dark:bg-teal-950/30 p-3.5 flex items-start gap-3">
              <QrCode className="h-5 w-5 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-teal-950 dark:text-teal-200">
                  {qrModalData.target.name} ({qrModalData.target.code})
                </p>
                <p className="text-[11px] text-teal-800 dark:text-teal-300">
                  School: <strong>{qrModalData.schoolName}</strong> · Role:{' '}
                  <strong className="capitalize">{targetType}</strong>
                </p>
              </div>
            </div>

            {/* Visual QR Image Card */}
            <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <img
                src={qrModalData.qrDataUrl}
                alt="Activation QR Code"
                className="w-56 h-56 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xs"
              />
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                <Clock className="h-3.5 w-3.5" />
                <span>Single-use · Valid until {safeDate(qrModalData.expiresAt)}</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500 font-mono-tabular">
                Token preview: {qrModalData.tokenPreview}
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const printWindow = window.open('', '_blank');
                      if (printWindow) {
                        printWindow.document.write(`
                          <html>
                            <head>
                              <title>TaleemOS Mobile App Activation QR - ${qrModalData.target.name}</title>
                              <style>
                                body { font-family: sans-serif; text-align: center; padding: 40px; }
                                .card { border: 2px dashed #0f766e; border-radius: 12px; padding: 24px; max-width: 360px; margin: auto; }
                                img { width: 220px; height: 220px; margin: 12px 0; }
                                h2 { margin: 0 0 6px 0; color: #0f766e; }
                                p { margin: 4px 0; font-size: 13px; color: #334155; }
                                .badge { display: inline-block; padding: 4px 10px; border-radius: 6px; background: #f1f5f9; font-weight: bold; font-size: 12px; }
                              </style>
                            </head>
                            <body>
                              <div class="card">
                                <h2>${qrModalData.schoolName}</h2>
                                <p><strong>Mobile App Activation QR</strong></p>
                                <div class="badge">${qrModalData.target.name} (${qrModalData.target.code})</div>
                                <br/>
                                <img src="${qrModalData.qrDataUrl}" />
                                <p style="font-size: 11px; color: #64748b;">Scan in TaleemOS ${targetType === 'teacher' ? 'Teacher App' : 'Universal Student App'}</p>
                                <p style="font-size: 10px; color: #94a3b8;">One-time use · Expires in 15 mins</p>
                              </div>
                              <script>window.print();</script>
                            </body>
                          </html>
                        `);
                        printWindow.document.close();
                      } else {
                        toast({ title: 'Print Blocked', description: 'Please allow popups for this site to print.', variant: 'error' });
                      }
                    } catch (err) {
                      toast({ title: 'Print Error', description: 'Could not open print window.', variant: 'error' });
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print QR Slip
                </button>

                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => handleRevokeQR(qrModalData.target)}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-300 dark:border-red-900/60 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Revoke Token
                </button>
              </div>

              <button
                type="button"
                onClick={() => setQrModalData(null)}
                className="rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-1.5 font-semibold text-white"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </ModalDialog>

      {/* History & Authorized Devices Modal */}
      <ModalDialog
        open={Boolean(historyTarget)}
        onClose={() => setHistoryTarget(null)}
        title={`App Access History & Devices — ${historyTarget?.name}`}
        subtitle="Audit logs of generated QR activation tokens and authorized mobile devices bound to this account."
      >
        <div className="space-y-4 text-xs">
          {historyLoading ? (
            <div className="p-8 text-center text-slate-500">Loading audit history...</div>
          ) : (
            <>
              {/* Authorized Devices */}
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 mb-2">
                  <Smartphone className="h-4 w-4 text-teal-700 dark:text-teal-400" />
                  Authorized Devices ({historyData?.devices.length || 0})
                </h3>
                {historyData && historyData.devices.length > 0 ? (
                  <div className="space-y-1.5">
                    {historyData.devices.map((d) => (
                      <div
                        key={d.id}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 flex items-center justify-between"
                      >
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {d.device_name || 'Smartphone'} ({d.device_model || d.os_version || 'Android'})
                          </p>
                          {/* BUG FIX: Safe slice to prevent crash if device_id is undefined or short */}
                          <p className="font-mono-tabular text-[10px] text-slate-500">
                            ID: {d.device_id ? d.device_id.slice(0, 14) + '...' : 'Unknown'} · App v{d.app_version || '1.0.0'}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900 px-1.5 py-0.5 text-[10px] font-semibold">
                            {d.status}
                          </span>
                          <p className="font-mono-tabular text-[10px] text-slate-400 mt-0.5">
                            Active: {safeDate(d.last_active_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 italic p-3 bg-slate-50 dark:bg-slate-950 rounded-lg">
                    No mobile devices have logged into this account yet.
                  </p>
                )}
              </div>

              {/* QR Token Audit Logs */}
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 mb-2">
                  <QrCode className="h-4 w-4 text-teal-700 dark:text-teal-400" />
                  QR Token History ({historyData?.tokens.length || 0})
                </h3>
                {historyData && historyData.tokens.length > 0 ? (
                  <div className="space-y-1.5 max-h-48 overflow-auto">
                    {historyData.tokens.map((t) => (
                      <div
                        key={t.id}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 p-2 flex items-center justify-between text-[11px]"
                      >
                        <div>
                          <span className="font-medium text-slate-900 dark:text-white capitalize">
                            {t.purpose.replace(/_/g, ' ')}
                          </span>
                          <p className="font-mono-tabular text-[10px] text-slate-500">
                            Token: {t.token_preview} · Created: {safeDate(t.created_at)}
                          </p>
                        </div>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            t.status === 'active'
                              ? 'bg-sky-50 text-sky-700 border border-sky-200'
                              : t.status === 'consumed'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 italic p-3 bg-slate-50 dark:bg-slate-950 rounded-lg">
                    No QR tokens generated yet.
                  </p>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setHistoryTarget(null)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-1.5 font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      </ModalDialog>

      {/* Direct Password Modal */}
      <ModalDialog
        open={Boolean(inviteTarget)}
        onClose={() => setInviteTarget(null)}
        title={`Set Login Email / Password — ${inviteTarget?.name}`}
        subtitle="Optional direct credential assignment for web portal sign-in."
      >
        {inviteTarget && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setActionBusy(true);
              try {
                const res = await fetch('/api/app-access/provision', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    targetType: targetType === 'guardian' ? 'student' : targetType,
                    targetId: inviteTarget.id,
                    email: inviteEmail.trim().toLowerCase(),
                    password: invitePassword,
                    enableImmediately: true,
                    mode: 'direct_password', // Kept for backend compatibility
                  }),
                });
                const data = await res.json();
                if (!res.ok) {
                  toast({ title: 'Update failed', description: data.error, variant: 'error' });
                  return;
                }
                toast({ title: 'Password Set', description: `Login credentials updated for ${inviteTarget.name}.`, variant: 'success' });
                setInviteTarget(null);
                void loadAccounts();
              } finally {
                setActionBusy(false);
              }
            }}
            className="space-y-3 text-xs"
          >
            <div>
              <label className="block font-medium">Login Email Address</label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block font-medium">Set New Password (Min 8 characters)</label>
              <input
                type="text"
                required
                minLength={8}
                value={invitePassword}
                onChange={(e) => setInvitePassword(e.target.value)}
                placeholder="Enter password"
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setInviteTarget(null)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {actionBusy ? 'Saving...' : 'Save Password'}
              </button>
            </div>
          </form>
        )}
      </ModalDialog>

      <ConfirmDialog
        open={Boolean(bulkConfirm)}
        onClose={() => setBulkConfirm(null)}
        onConfirm={() => bulkConfirm && handleToggle(selectedIds, bulkConfirm)}
        title={`Confirm Bulk ${bulkConfirm === 'enable' ? 'Enable' : 'Disable'}`}
        message={`Are you sure you want to ${bulkConfirm} access for ${selectedIds.length} selected account(s)?`}
        confirmLabel={bulkConfirm === 'enable' ? 'Enable Selected' : 'Disable Selected'}
        danger={bulkConfirm === 'disable'}
        loading={actionBusy}
      />
    </div>
  );
}