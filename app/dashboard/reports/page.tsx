'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type ReportType =
  | 'students'
  | 'teachers'
  | 'admissions'
  | 'attendance'
  | 'fees'
  | 'payments'
  | 'payroll'
  | 'exams'
  | 'library'
  | 'transport'
  | 'inventory';

export default function ReportsAnalyticsPage() {
  const { school } = useSchool();
  const [reportType, setReportType] = useState<ReportType>('students');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);

  const loadReport = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const tableMap: Record<ReportType, string> = {
      students: 'students',
      teachers: 'teachers',
      admissions: 'students',
      attendance: 'student_attendance',
      fees: 'fee_vouchers',
      payments: 'fee_payments',
      payroll: 'salary_slips',
      exams: 'exam_marks',
      library: 'library_issues',
      transport: 'transport_routes',
      inventory: 'inventory_items',
    };

    const { data } = await supabase
      .from(tableMap[reportType])
      .select('*')
      .eq('school_id', school.id)
      .limit(250);

    let list = (data ?? []) as Array<Record<string, unknown>>;
    if (dateFrom) {
      list = list.filter((r) => String(r.created_at || r.attendance_date || r.admission_date || '').slice(0, 10) >= dateFrom);
    }
    if (dateTo) {
      list = list.filter((r) => String(r.created_at || r.attendance_date || r.admission_date || '').slice(0, 10) <= dateTo);
    }
    setRows(list);
    setLoading(false);
  }, [reportType, dateFrom, dateTo, school.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadReport();
    });
  }, [loadReport]);

  const keys = rows.length > 0 ? Object.keys(rows[0]).filter((k) => k !== 'school_id' && k !== 'id').slice(0, 6) : ['status'];

  const columns: TableColumn<Record<string, unknown>>[] = keys.map((k) => ({
    key: k,
    header: k.replace(/_/g, ' ').toUpperCase(),
    render: (r) => <span className="font-mono-tabular">{String(r[k] ?? '—')}</span>,
    exportValue: (r) => String(r[k] ?? ''),
  }));

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text(`${school.name_en} — ${reportType.toUpperCase()} REPORT`, 14, 16);
    autoTable(doc, {
      startY: 24,
      head: [keys.map((k) => k.replace(/_/g, ' ').toUpperCase())],
      body: rows.map((r) => keys.map((k) => String(r[k] ?? '—'))),
      styles: { fontSize: 8 },
    });
    doc.save(`${reportType}-report.pdf`);
  };

  return (
    <div className="space-y-6">
      <DataTable
        title="Reports & Analytics"
        subtitle="Filter live Supabase records across all school modules and export to PDF, Excel, or Print."
        rows={rows}
        columns={columns}
        loading={loading}
        getRowKey={(r, ) => String(r.id || Math.random())}
        getSearchText={(r) => JSON.stringify(r)}
        exportFileName={`${reportType}-report`}
        primaryAction={
          rows.length > 0 ? (
            <button type="button" onClick={exportPdf} className="rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white">
              PDF Export
            </button>
          ) : null
        }
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-medium"
            >
              <option value="students">Students</option>
              <option value="teachers">Teachers & Staff</option>
              <option value="admissions">Admissions</option>
              <option value="attendance">Attendance</option>
              <option value="fees">Fees & Vouchers</option>
              <option value="payments">Payments</option>
              <option value="payroll">Payroll</option>
              <option value="exams">Examinations & Results</option>
              <option value="library">Library</option>
              <option value="transport">Transport</option>
              <option value="inventory">Inventory</option>
            </select>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs" />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs" />
          </div>
        }
      />
    </div>
  );
}
