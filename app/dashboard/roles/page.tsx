'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';

const MODULE_KEYS = [
  'dashboard',
  'admissions',
  'students',
  'parents',
  'staff',
  'app_access',
  'academics',
  'attendance',
  'fees',
  'payroll',
  'exams',
  'homework',
  'timetable',
  'online_classes',
  'library',
  'transport',
  'inventory',
  'certificates',
  'communication',
  'reports',
  'roles',
  'audit_logs',
  'subscription',
  'support',
  'settings',
];

interface MemberRow {
  id: string;
  source: 'legacy' | 'membership';
  user_id: string;
  role_id?: string;
  full_name: string;
  email: string;
  role_name: string;
  permissions: Record<string, boolean>;
  is_active: boolean;
}

export default function RolesPermissionsPage() {
  const { school } = useSchool();
  const { toast } = useToast();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [permDraft, setPermDraft] = useState<Record<string, boolean>>({});
  const [roleDraft, setRoleDraft] = useState('Admin');

  const loadData = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const [{ data: legacyRows }, { data: msRows }, { data: roleRows }] = await Promise.all([
      supabase.from('school_members').select('*').eq('school_id', school.id),
      supabase.from('school_memberships').select('*').eq('school_id', school.id),
      supabase.from('roles').select('id, name, slug').eq('school_id', school.id),
    ]);

    const typedLegacy = ((legacyRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      source: 'legacy' as const,
      user_id: String(r.user_id),
      full_name: String(r.full_name),
      email: String(r.email),
      role_name: String(r.role_name),
      permissions: (r.permissions as Record<string, boolean>) || {},
      is_active: Boolean(r.is_active),
    }));

    const roleMap = new Map<string, { id: string; name: string; slug: string }>(
      ((roleRows ?? []) as Array<{ id: string; name: string; slug: string }>).map((r) => [r.id, r])
    );

    const legacyUsers = new Set(typedLegacy.map((m) => m.user_id));
    const membershipRows = ((msRows ?? []) as Array<Record<string, unknown>>).filter(
      (m) => !legacyUsers.has(String(m.user_id))
    );

    const mergedMemberships: MemberRow[] = membershipRows.map((m) => {
      const role = roleMap.get(String(m.role_id));
      const isOwner = String(m.member_type).toLowerCase() === 'owner' || role?.slug === 'owner';
      return {
        id: String(m.id),
        source: 'membership',
        user_id: String(m.user_id),
        role_id: String(m.role_id),
        full_name: isOwner ? school.owner_name : String(m.member_type),
        email: isOwner ? school.email : 'Staff Member',
        role_name: role?.name || String(m.member_type),
        permissions: (isOwner ? { '*': true } : {}) as Record<string, boolean>,
        is_active: String(m.status).toLowerCase() === 'active',
      };
    });

    setMembers([...typedLegacy, ...mergedMemberships]);
    setLoading(false);
  }, [school.id, school.owner_name, school.email]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    if (editing.source === 'legacy') {
      const { error } = await supabase
        .from('school_members')
        .update({ role_name: roleDraft, permissions: permDraft })
        .eq('id', editing.id)
        .eq('school_id', school.id);
      if (error) {
        toast({ title: 'Unable to update permissions', description: error.message, variant: 'error' });
        return;
      }
    } else {
      const { error } = await supabase.from('school_members').insert({
        school_id: school.id,
        user_id: editing.user_id,
        role_name: roleDraft,
        full_name: editing.full_name,
        email: editing.email,
        permissions: permDraft,
        is_active: editing.is_active,
      });
      if (error) {
        toast({ title: 'Unable to save permissions', description: error.message, variant: 'error' });
        return;
      }
    }

    toast({ title: 'Role & permissions updated', variant: 'success' });
    setEditing(null);
    loadData();
  };

  const columns: TableColumn<MemberRow>[] = [
    { key: 'name', header: 'Staff Member', render: (r) => <div><p className="font-semibold">{r.full_name}</p><p className="text-[11px] text-slate-500">{r.email}</p></div> },
    { key: 'role', header: 'Role', render: (r) => r.role_name },
    {
      key: 'perms',
      header: 'Enabled Modules',
      render: (r) => (r.permissions?.['*'] ? 'Full Access (Owner)' : Object.keys(r.permissions || {}).filter((k) => r.permissions[k]).join(', ') || 'None'),
    },
    { key: 'active', header: 'Active', render: (r) => (r.is_active ? 'Active' : 'Suspended') },
    {
      key: 'act',
      header: 'Configure',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          onClick={() => {
            setEditing(r);
            setRoleDraft(r.role_name);
            setPermDraft(r.permissions || {});
          }}
          className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium"
        >
          Edit Permissions
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="School Roles & Module Permissions"
        subtitle="Control granular module access for Principal, Admin, Accountant, Teacher, Receptionist, Attendance Operator, and custom staff roles."
        rows={members}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.full_name} ${r.email} ${r.role_name}`}
      />

      <ModalDialog open={Boolean(editing)} onClose={() => setEditing(null)} title={`Edit Permissions — ${editing?.full_name || ''}`} maxWidthClass="max-w-2xl">
        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium">Role Preset</label>
            <select value={roleDraft} onChange={(e) => setRoleDraft(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              {['School Owner', 'Principal', 'Admin', 'Accountant', 'Teacher', 'Receptionist', 'Attendance Operator', 'Custom'].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {MODULE_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-2">
                <input
                  type="checkbox"
                  checked={Boolean(permDraft['*'] || permDraft[key])}
                  onChange={(e) => setPermDraft((prev) => ({ ...prev, '*': false, [key]: e.target.checked }))}
                />
                <span className="capitalize">{key.replace(/_/g, ' ')}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Permissions</button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
