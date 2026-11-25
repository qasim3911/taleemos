'use client';

import React, { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';

interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
}

export default function AuditLogsPage() {
  const { school } = useSchool();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    supabase
      .from('audit_logs')
      .select('*')
      .eq('school_id', school.id)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }: { data: AuditRow[] | null }) => {
        setRows(data ?? []);
        setLoading(false);
      });
  }, [school.id]);

  const columns: TableColumn<AuditRow>[] = [
    { key: 'action', header: 'Event Action', render: (r) => <span className="font-mono-tabular font-semibold">{r.action}</span>, exportValue: (r) => r.action },
    { key: 'table', header: 'Module / Table', render: (r) => r.table_name, exportValue: (r) => r.table_name },
    {
      key: 'details',
      header: 'Details',
      render: (r) => (
        <span className="text-xs text-slate-600 dark:text-slate-300">
          {r.new_values ? JSON.stringify(r.new_values).slice(0, 80) : r.record_id || '—'}
        </span>
      ),
      exportValue: (r) => (r.new_values ? JSON.stringify(r.new_values) : r.record_id || ''),
    },
    { key: 'time', header: 'Timestamp', render: (r) => <span className="font-mono-tabular">{new Date(r.created_at).toLocaleString()}</span>, exportValue: (r) => r.created_at },
  ];

  return (
    <DataTable
      title="School Audit Logs"
      subtitle="Immutable trail of student admissions, staff onboarding, app access toggles, and subscription actions."
      rows={rows}
      columns={columns}
      loading={loading}
      getRowKey={(r) => r.id}
      getSearchText={(r) => `${r.action} ${r.table_name} ${r.record_id || ''}`}
      exportFileName="school-audit-logs"
    />
  );
}
