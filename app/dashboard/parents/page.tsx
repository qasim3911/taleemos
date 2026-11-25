'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Plus,
  QrCode,
  Link2,
  Unlink,
  Check,
  Printer,
  ExternalLink,
  Users,
  Smartphone,
  ShieldCheck,
  ShieldAlert,
  Edit2,
  Clock,
  RotateCcw,
} from 'lucide-react';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { useSchool } from '@/components/dashboard/school-context-provider';

interface LinkedChild {
  id: string;
  linkId: string;
  admissionNumber: string;
  name: string;
  className: string;
  sectionName: string;
  isPrimary: boolean;
  status: string;
}

interface GuardianRecord {
  id: string;
  full_name: string;
  father_husband_name: string | null;
  relationship: string;
  phone: string;
  email: string | null;
  cnic: string | null;
  address: string | null;
  emergency_contact: string | null;
  communication_notes: string | null;
  is_verified: boolean;
  app_access_enabled: boolean;
  app_blocked: boolean;
  status: string;
  last_login_at: string | null;
  linkedChildren: LinkedChild[];
  linkedChildrenCount: number;
}

interface EnrolledStudent {
  id: string;
  name_en: string;
  admission_number: string;
  class_name?: string;
  section_name?: string;
}

export default function ParentsGuardiansPage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [guardians, setGuardians] = useState<GuardianRecord[]>([]);
  const [allStudents, setAllStudents] = useState<EnrolledStudent[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [openAdd, setOpenAdd] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [openLinkModal, setOpenLinkModal] = useState(false);
  const [openSiblingsModal, setOpenSiblingsModal] = useState(false);
  const [openQrModal, setOpenQrModal] = useState(false);

  // Active records for modals
  const [activeGuardian, setActiveGuardian] = useState<GuardianRecord | null>(null);

  // Add / Edit form
  const [guardianForm, setGuardianForm] = useState({
    full_name: '',
    father_husband_name: '',
    relationship: 'Father',
    phone: '',
    email: '',
    cnic: '',
    address: '',
    emergency_contact: '',
    communication_notes: '',
    is_verified: true,
  });

  // Link child form
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  const [linkRelationship, setLinkRelationship] = useState('Father');
  const [isPrimaryLink, setIsPrimaryLink] = useState(true);
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  // QR Modal state
  const [qrPurpose, setQrPurpose] = useState<'guardian_first_activation' | 'guardian_pin_reset'>('guardian_first_activation');
  const [qrGenerating, setQrGenerating] = useState(false);
  const [generatedQr, setGeneratedQr] = useState<{
    qrDataUrl: string;
    tokenPreview: string;
    expiresAt: string;
    status: string;
    securityNotice: string;
  } | null>(null);

  // Load Guardians
  const loadGuardians = useCallback(async () => {
    try {
      const res = await fetch('/api/guardians', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setGuardians(data.guardians ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Load Enrolled Students for linking
  const loadStudents = useCallback(async () => {
    try {
      const res = await fetch('/api/students', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.students)) {
        const clsMap = new Map((data.classes ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
        const secMap = new Map((data.sections ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));
        const mapped = data.students.map((s: { id: string; name_en: string; admission_number: string; class_id?: string; section_id?: string }) => ({
          id: s.id,
          name_en: s.name_en,
          admission_number: s.admission_number,
          class_name: s.class_id ? clsMap.get(s.class_id) || 'Class' : '',
          section_name: s.section_id ? secMap.get(s.section_id) || '' : '',
        }));
        setAllStudents(mapped);
      }
    } catch {
      // silently handle
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadGuardians();
      void loadStudents();
    });
  }, [loadGuardians, loadStudents]);

  // Handle Add Guardian
  const handleAddGuardian = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/guardians', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(guardianForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Unable to save guardian',
          description: data.error || 'Please verify form fields.',
          variant: 'error',
        });
        return;
      }
      toast({
        title: 'Guardian record registered',
        description: `${guardianForm.full_name} is now registered. You can link student siblings.`,
        variant: 'success',
      });
      setOpenAdd(false);
      resetGuardianForm();
      void loadGuardians();
    } catch {
      toast({ title: 'Network error', description: 'Failed to contact server.', variant: 'error' });
    }
  };

  // Handle Edit Guardian
  const handleEditGuardian = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGuardian) return;
    try {
      const res = await fetch('/api/guardians', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeGuardian.id,
          ...guardianForm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Update failed', description: data.error || 'Check fields.', variant: 'error' });
        return;
      }
      toast({ title: 'Guardian updated successfully', variant: 'success' });
      setOpenEdit(false);
      setActiveGuardian(null);
      void loadGuardians();
    } catch {
      toast({ title: 'Network error', variant: 'error' });
    }
  };

  // Toggle Verification
  const handleToggleVerification = async (g: GuardianRecord) => {
    try {
      const nextStatus = !g.is_verified;
      const res = await fetch('/api/guardians', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: g.id,
          is_verified: nextStatus,
        }),
      });
      if (res.ok) {
        toast({
          title: nextStatus ? 'Guardian Verified' : 'Guardian Unverified',
          description: `${g.full_name} status updated.`,
          variant: 'success',
        });
        void loadGuardians();
      }
    } catch {
      toast({ title: 'Failed to update verification', variant: 'error' });
    }
  };

  // Handle Link Student
  const handleLinkStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGuardian || !selectedStudentId) {
      toast({ title: 'Please select a student', variant: 'error' });
      return;
    }
    setLinkSubmitting(true);
    try {
      const res = await fetch('/api/guardians/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guardianId: activeGuardian.id,
          studentId: selectedStudentId,
          relationshipType: linkRelationship,
          isPrimary: isPrimaryLink,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Linking failed', description: data.error || 'Error occurred.', variant: 'error' });
        return;
      }
      toast({
        title: 'Child Linked Successfully',
        description: data.message || 'The student was linked to this guardian profile.',
        variant: 'success',
      });
      setOpenLinkModal(false);
      setSelectedStudentId('');
      setStudentSearchTerm('');
      void loadGuardians();
    } catch {
      toast({ title: 'Network error', variant: 'error' });
    } finally {
      setLinkSubmitting(false);
    }
  };

  // Handle Unlink Student
  const handleUnlinkStudent = async (guardianId: string, studentId: string, studentName: string) => {
    if (!confirm(`Are you sure you want to unlink ${studentName} from this guardian? Other linked siblings will remain intact.`)) {
      return;
    }
    try {
      const res = await fetch('/api/guardians/link', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guardianId, studentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Unlink failed', description: data.error || 'Could not unlink student.', variant: 'error' });
        return;
      }
      toast({
        title: 'Student Unlinked',
        description: `${studentName} was unlinked. Other siblings were preserved.`,
        variant: 'success',
      });
      void loadGuardians();
      if (activeGuardian && activeGuardian.id === guardianId) {
        setActiveGuardian({
          ...activeGuardian,
          linkedChildren: activeGuardian.linkedChildren.filter((c) => c.id !== studentId),
          linkedChildrenCount: Math.max(0, activeGuardian.linkedChildrenCount - 1),
        });
      }
    } catch {
      toast({ title: 'Network error', variant: 'error' });
    }
  };

  // Handle Generate QR
  const handleGenerateQr = async () => {
    if (!activeGuardian) return;
    setQrGenerating(true);
    setGeneratedQr(null);
    try {
      const res = await fetch('/api/app-access/qr/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'guardian',
          targetId: activeGuardian.id,
          purpose: qrPurpose,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'QR Generation failed', description: data.error || 'Server error.', variant: 'error' });
        return;
      }
      setGeneratedQr(data);
      toast({
        title: 'Guardian Activation QR Generated',
        description: 'Scan within Universal Student App (Guardian Mode) to set PIN.',
        variant: 'success',
      });
      void loadGuardians();
    } catch {
      toast({ title: 'Network error', variant: 'error' });
    } finally {
      setQrGenerating(false);
    }
  };

  // Revoke QR
  const handleRevokeQr = async () => {
    if (!activeGuardian) return;
    try {
      const res = await fetch('/api/app-access/qr/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'guardian',
          targetId: activeGuardian.id,
        }),
      });
      if (res.ok) {
        toast({ title: 'QR token revoked', description: 'Access revoked for this guardian.', variant: 'success' });
        setGeneratedQr(null);
        setOpenQrModal(false);
        void loadGuardians();
      }
    } catch {
      toast({ title: 'Failed to revoke token', variant: 'error' });
    }
  };

  const resetGuardianForm = () => {
    setGuardianForm({
      full_name: '',
      father_husband_name: '',
      relationship: 'Father',
      phone: '',
      email: '',
      cnic: '',
      address: '',
      emergency_contact: '',
      communication_notes: '',
      is_verified: true,
    });
  };

  const openEditModalFor = (g: GuardianRecord) => {
    setActiveGuardian(g);
    setGuardianForm({
      full_name: g.full_name,
      father_husband_name: g.father_husband_name || '',
      relationship: g.relationship || 'Father',
      phone: g.phone || '',
      email: g.email || '',
      cnic: g.cnic || '',
      address: g.address || '',
      emergency_contact: g.emergency_contact || '',
      communication_notes: g.communication_notes || '',
      is_verified: g.is_verified,
    });
    setOpenEdit(true);
  };

  const openLinkModalFor = (g: GuardianRecord) => {
    setActiveGuardian(g);
    setSelectedStudentId('');
    setStudentSearchTerm('');
    setLinkRelationship(g.relationship || 'Father');
    setIsPrimaryLink(true);
    setOpenLinkModal(true);
  };

  const openSiblingsModalFor = (g: GuardianRecord) => {
    setActiveGuardian(g);
    setOpenSiblingsModal(true);
  };

  const openQrModalFor = (g: GuardianRecord, purpose: 'guardian_first_activation' | 'guardian_pin_reset' = 'guardian_first_activation') => {
    setActiveGuardian(g);
    setQrPurpose(purpose);
    setGeneratedQr(null);
    setOpenQrModal(true);
  };

  // Filter students for search dropdown
  const filteredStudents = useMemo(() => {
    if (!activeGuardian) return allStudents;
    const linkedIds = new Set(activeGuardian.linkedChildren.map((c) => c.id));
    const term = studentSearchTerm.trim().toLowerCase();
    return allStudents.filter((s) => {
      if (linkedIds.has(s.id)) return false;
      if (!term) return true;
      return (
        s.name_en.toLowerCase().includes(term) ||
        s.admission_number.toLowerCase().includes(term) ||
        (s.class_name && s.class_name.toLowerCase().includes(term))
      );
    });
  }, [allStudents, activeGuardian, studentSearchTerm]);

  // Stats
  const stats = useMemo(() => {
    const total = guardians.length;
    const verified = guardians.filter((g) => g.is_verified).length;
    const activeApp = guardians.filter((g) => g.status === 'Activated' || g.app_access_enabled).length;
    const totalChildren = guardians.reduce((acc, g) => acc + (g.linkedChildrenCount || 0), 0);
    return { total, verified, activeApp, totalChildren };
  }, [guardians]);

  // Data Table Columns
  const columns: TableColumn<GuardianRecord>[] = [
    {
      key: 'guardian',
      header: 'Guardian / Parent',
      render: (r) => (
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-900 dark:text-white">{r.full_name}</span>
            {r.is_verified ? (
              <span title="Verified Guardian Profile" className="inline-flex items-center text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
              </span>
            ) : (
              <span title="Pending Document Verification" className="inline-flex items-center text-amber-500">
                <ShieldAlert className="h-4 w-4" />
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            {r.relationship}
            {r.father_husband_name ? ` • S/O or W/O: ${r.father_husband_name}` : ''}
          </p>
        </div>
      ),
      exportValue: (r) => `${r.full_name} (${r.relationship})`,
    },
    {
      key: 'contact',
      header: 'Mobile & CNIC',
      render: (r) => (
        <div className="space-y-0.5">
          <p className="font-mono-tabular text-xs font-semibold text-slate-900 dark:text-white">
            {r.phone}
          </p>
          <p className="font-mono-tabular text-[11px] text-slate-500">
            {r.cnic ? `CNIC: ${r.cnic}` : r.email ? r.email : 'No CNIC'}
          </p>
        </div>
      ),
      exportValue: (r) => `${r.phone} ${r.cnic || ''}`,
    },
    {
      key: 'children',
      header: 'Linked Children (Siblings)',
      render: (r) => (
        <div className="space-y-1">
          {r.linkedChildren && r.linkedChildren.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {r.linkedChildren.slice(0, 3).map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1 rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 text-[11px] font-medium text-purple-700 dark:text-purple-300"
                >
                  <Users className="h-3 w-3" />
                  {c.name}
                  <span className="text-[9px] opacity-75">({c.className})</span>
                </span>
              ))}
              {r.linkedChildren.length > 3 && (
                <button
                  type="button"
                  onClick={() => openSiblingsModalFor(r)}
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100"
                >
                  +{r.linkedChildren.length - 3} more
                </button>
              )}
            </div>
          ) : (
            <span className="text-[11px] italic text-slate-400">No children linked</span>
          )}
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => openLinkModalFor(r)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline"
            >
              <Link2 className="h-3 w-3" />
              Link Sibling
            </button>
            {r.linkedChildren && r.linkedChildren.length > 0 && (
              <button
                type="button"
                onClick={() => openSiblingsModalFor(r)}
                className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 hover:underline"
              >
                Manage ({r.linkedChildren.length})
              </button>
            )}
          </div>
        </div>
      ),
      exportValue: (r) => (r.linkedChildren || []).map((c) => `${c.name} (${c.className})`).join(', '),
    },
    {
      key: 'status',
      header: 'App Access Status',
      render: (r) => {
        const s = r.status || (r.app_access_enabled ? 'Activated' : 'Registered');
        const badgeColor =
          s === 'Activated'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300'
            : s === 'QR Generated' || s === 'Awaiting Activation'
            ? 'bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-950/50 dark:text-sky-300'
            : s === 'Access Disabled' || s === 'Access Suspended' || s === 'Access Revoked'
            ? 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/50 dark:text-rose-300'
            : 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300';

        return (
          <div className="space-y-1">
            <span className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-bold ${badgeColor}`}>
              {s}
            </span>
            <p className="text-[10px] text-slate-400">
              {r.last_login_at ? `Last: ${new Date(r.last_login_at).toLocaleDateString()}` : 'No login yet'}
            </p>
          </div>
        );
      },
      exportValue: (r) => r.status,
    },
    {
      key: 'verification',
      header: 'Verification',
      render: (r) => (
        <button
          type="button"
          onClick={() => void handleToggleVerification(r)}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition ${
            r.is_verified
              ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
              : 'border-amber-200 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100'
          }`}
        >
          {r.is_verified ? <Check className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          {r.is_verified ? 'Verified' : 'Verify Now'}
        </button>
      ),
      exportValue: (r) => (r.is_verified ? 'Verified' : 'Unverified'),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            title="Generate Guardian QR Access"
            onClick={() => openQrModalFor(r, 'guardian_first_activation')}
            className="inline-flex items-center gap-1 rounded-md border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 px-2 py-1 text-xs font-semibold hover:bg-purple-100"
          >
            <QrCode className="h-3.5 w-3.5" />
            QR
          </button>
          <button
            type="button"
            title="Edit Profile"
            onClick={() => openEditModalFor(r)}
            className="rounded border border-slate-200 dark:border-slate-700 p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Guardian & Parent Management</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Multi-child linking, guardian verification, and QR-based Guardian Login inside the Universal Student App.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/app-access/guardians"
            className="inline-flex items-center gap-1.5 rounded-lg border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 px-3.5 py-2 text-xs font-semibold hover:bg-purple-100"
          >
            <Smartphone className="h-3.5 w-3.5" />
            Guardian App Control Panel
            <ExternalLink className="h-3 w-3" />
          </Link>
          <button
            type="button"
            onClick={() => {
              resetGuardianForm();
              setOpenAdd(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-2 text-xs font-semibold text-white shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Register New Guardian
          </button>
        </div>
      </div>

      {/* Info / Rule Notice */}
      <div className="rounded-xl border border-purple-200 dark:border-purple-900 bg-purple-50/60 dark:bg-purple-950/20 p-4 text-xs text-purple-900 dark:text-purple-200 flex items-start gap-3">
        <Users className="h-5 w-5 shrink-0 mt-0.5 text-purple-700 dark:text-purple-400" />
        <div className="space-y-1">
          <p className="font-semibold">
            Universal Student App · Integrated Guardian Login Mode
          </p>
          <p className="text-[11px] text-purple-800 dark:text-purple-300">
            One verified guardian account can link to all their children across different grades (e.g. Ali in Grade 8, Ayesha in Grade 5). Unlinking one student never removes their siblings. Parents sign into the Universal Student App using their Guardian QR & PIN.
          </p>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Registered Guardians</p>
          <p className="mt-1 font-mono-tabular text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-emerald-600 dark:text-emerald-400">Verified Profiles</p>
          <p className="mt-1 font-mono-tabular text-2xl font-bold text-emerald-700 dark:text-emerald-400">{stats.verified}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-purple-600 dark:text-purple-400">Total Linked Children</p>
          <p className="mt-1 font-mono-tabular text-2xl font-bold text-purple-700 dark:text-purple-400">{stats.totalChildren}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-sky-600 dark:text-sky-400">Active App Logins</p>
          <p className="mt-1 font-mono-tabular text-2xl font-bold text-sky-700 dark:text-sky-400">{stats.activeApp}</p>
        </div>
      </div>

      {/* Main Table */}
      <DataTable
        title="Parents & Guardians Directory"
        subtitle="Manage contact records, verify national identity, link siblings, and generate mobile activation QR codes."
        rows={guardians}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.full_name} ${r.phone} ${r.cnic || ''} ${r.father_husband_name || ''} ${(r.linkedChildren || []).map((c) => c.name).join(' ')}`}
        exportFileName="school-guardians-directory"
        primaryAction={
          <button
            type="button"
            onClick={() => {
              resetGuardianForm();
              setOpenAdd(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Guardian
          </button>
        }
      />

      {/* Modal 1: Add Guardian */}
      <ModalDialog open={openAdd} onClose={() => setOpenAdd(false)} title="Register New Parent / Guardian">
        <form onSubmit={handleAddGuardian} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">Guardian Full Name *</label>
              <input
                required
                value={guardianForm.full_name}
                onChange={(e) => setGuardianForm({ ...guardianForm, full_name: e.target.value })}
                placeholder="e.g. Muhammad Tariq"
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">Father / Husband Name</label>
              <input
                value={guardianForm.father_husband_name}
                onChange={(e) => setGuardianForm({ ...guardianForm, father_husband_name: e.target.value })}
                placeholder="e.g. Abdul Rehman"
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">Relationship *</label>
              <select
                value={guardianForm.relationship}
                onChange={(e) => setGuardianForm({ ...guardianForm, relationship: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="Father">Father</option>
                <option value="Mother">Mother</option>
                <option value="Legal Guardian">Legal Guardian</option>
                <option value="Brother">Brother</option>
                <option value="Uncle">Uncle</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">
                Contact / Mobile Number * <span className="text-[10px] text-teal-600">(Login Identifier)</span>
              </label>
              <input
                required
                value={guardianForm.phone}
                onChange={(e) => setGuardianForm({ ...guardianForm, phone: e.target.value })}
                placeholder="03001234567"
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">
                Email Address <span className="text-[10px] text-slate-400">(Optional)</span>
              </label>
              <input
                type="email"
                value={guardianForm.email}
                onChange={(e) => setGuardianForm({ ...guardianForm, email: e.target.value })}
                placeholder="Optional email"
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">CNIC Number</label>
              <input
                value={guardianForm.cnic}
                onChange={(e) => setGuardianForm({ ...guardianForm, cnic: e.target.value })}
                placeholder="35201-1234567-1"
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700 dark:text-slate-300">Residential Address</label>
              <input
                value={guardianForm.address}
                onChange={(e) => setGuardianForm({ ...guardianForm, address: e.target.value })}
                placeholder="House #, Street, City"
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">Emergency Phone</label>
              <input
                value={guardianForm.emergency_contact}
                onChange={(e) => setGuardianForm({ ...guardianForm, emergency_contact: e.target.value })}
                placeholder="Secondary contact"
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={guardianForm.is_verified}
                  onChange={(e) => setGuardianForm({ ...guardianForm, is_verified: e.target.checked })}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4"
                />
                <span className="font-semibold text-slate-800 dark:text-slate-200">Mark profile as verified</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300">Communication Notes</label>
            <textarea
              rows={2}
              value={guardianForm.communication_notes}
              onChange={(e) => setGuardianForm({ ...guardianForm, communication_notes: e.target.value })}
              placeholder="Special instructions or notes"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setOpenAdd(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button type="submit" className="rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 font-semibold text-white">
              Save Guardian Record
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Modal 2: Edit Guardian */}
      <ModalDialog open={openEdit} onClose={() => setOpenEdit(false)} title="Edit Guardian Profile">
        <form onSubmit={handleEditGuardian} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">Guardian Full Name *</label>
              <input
                required
                value={guardianForm.full_name}
                onChange={(e) => setGuardianForm({ ...guardianForm, full_name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">Father / Husband Name</label>
              <input
                value={guardianForm.father_husband_name}
                onChange={(e) => setGuardianForm({ ...guardianForm, father_husband_name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">Relationship</label>
              <select
                value={guardianForm.relationship}
                onChange={(e) => setGuardianForm({ ...guardianForm, relationship: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="Father">Father</option>
                <option value="Mother">Mother</option>
                <option value="Legal Guardian">Legal Guardian</option>
                <option value="Brother">Brother</option>
                <option value="Uncle">Uncle</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">Contact Number</label>
              <input
                required
                value={guardianForm.phone}
                onChange={(e) => setGuardianForm({ ...guardianForm, phone: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">Email (Optional)</label>
              <input
                type="email"
                value={guardianForm.email}
                onChange={(e) => setGuardianForm({ ...guardianForm, email: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">CNIC</label>
              <input
                value={guardianForm.cnic}
                onChange={(e) => setGuardianForm({ ...guardianForm, cnic: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700 dark:text-slate-300">Address</label>
              <input
                value={guardianForm.address}
                onChange={(e) => setGuardianForm({ ...guardianForm, address: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={guardianForm.is_verified}
                  onChange={(e) => setGuardianForm({ ...guardianForm, is_verified: e.target.checked })}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4"
                />
                <span className="font-semibold text-slate-800 dark:text-slate-200">Verified Profile</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setOpenEdit(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button type="submit" className="rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 font-semibold text-white">
              Save Changes
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Modal 3: Link Student to Guardian */}
      <ModalDialog
        open={openLinkModal}
        onClose={() => setOpenLinkModal(false)}
        title={`Link Student to ${activeGuardian?.full_name || 'Guardian'}`}
      >
        <form onSubmit={handleLinkStudent} className="space-y-4 text-xs">
          <div className="rounded-lg bg-purple-50 dark:bg-purple-950/30 p-3 border border-purple-200 dark:border-purple-800">
            <p className="font-semibold text-purple-950 dark:text-purple-200">Guardian Details</p>
            <p className="text-purple-800 dark:text-purple-300 text-[11px]">
              {activeGuardian?.full_name} · Mobile: {activeGuardian?.phone} {activeGuardian?.cnic ? `· CNIC: ${activeGuardian?.cnic}` : ''}
            </p>
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300">Search Enrolled Student *</label>
            <input
              type="text"
              value={studentSearchTerm}
              onChange={(e) => setStudentSearchTerm(e.target.value)}
              placeholder="Search by student name or admission number..."
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300">Select Student *</label>
            <select
              required
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="">-- Choose a student to link --</option>
              {filteredStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_en} (Adm: {s.admission_number}) {s.class_name ? `• ${s.class_name}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300">Relationship to this Student</label>
              <select
                value={linkRelationship}
                onChange={(e) => setLinkRelationship(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="Father">Father</option>
                <option value="Mother">Mother</option>
                <option value="Legal Guardian">Legal Guardian</option>
                <option value="Brother">Brother</option>
                <option value="Uncle">Uncle</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPrimaryLink}
                  onChange={(e) => setIsPrimaryLink(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4"
                />
                <span className="font-semibold text-slate-800 dark:text-slate-200">Primary Contact for this student</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setOpenLinkModal(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={linkSubmitting || !selectedStudentId}
              className="rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {linkSubmitting ? 'Linking...' : 'Confirm & Link Student'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Modal 4: Manage Linked Siblings */}
      <ModalDialog
        open={openSiblingsModal}
        onClose={() => setOpenSiblingsModal(false)}
        title={`Linked Children for ${activeGuardian?.full_name || 'Guardian'}`}
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-500">
            Below are all students linked to <strong>{activeGuardian?.full_name}</strong>. Each child will appear inside this guardian&apos;s Universal Student App account. Unlinking one child does not affect other siblings.
          </p>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 border rounded-lg border-slate-200 dark:border-slate-800">
            {activeGuardian?.linkedChildren && activeGuardian.linkedChildren.length > 0 ? (
              activeGuardian.linkedChildren.map((c) => (
                <div key={c.id} className="p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-sm text-slate-900 dark:text-white">{c.name}</p>
                    <p className="text-[11px] text-slate-500">
                      Admission #{c.admissionNumber} · Class: {c.className} {c.sectionName ? `(${c.sectionName})` : ''}
                      {c.isPrimary ? ' · Primary Guardian' : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleUnlinkStudent(activeGuardian.id, c.id, c.name)}
                    className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 rounded font-semibold"
                  >
                    <Unlink className="h-3 w-3" />
                    Unlink
                  </button>
                </div>
              ))
            ) : (
              <p className="p-4 text-center text-slate-400">No students currently linked.</p>
            )}
          </div>

          <div className="flex justify-between items-center pt-2">
            <button
              type="button"
              onClick={() => {
                setOpenSiblingsModal(false);
                if (activeGuardian) openLinkModalFor(activeGuardian);
              }}
              className="inline-flex items-center gap-1 text-xs text-teal-700 dark:text-teal-400 font-semibold hover:underline"
            >
              <Plus className="h-3.5 w-3.5" />
              Link Another Child
            </button>
            <button
              type="button"
              onClick={() => setOpenSiblingsModal(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      </ModalDialog>

      {/* Modal 5: QR Code Generation & Activation */}
      <ModalDialog
        open={openQrModal}
        onClose={() => setOpenQrModal(false)}
        title={`Guardian App QR Access: ${activeGuardian?.full_name || ''}`}
      >
        <div className="space-y-4 text-xs">
          <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/70 dark:bg-purple-950/30 p-3 flex items-start gap-2.5">
            <Smartphone className="h-4 w-4 text-purple-700 dark:text-purple-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-purple-950 dark:text-purple-200">
                Universal Student App · Guardian Mode Login
              </p>
              <p className="text-[11px] text-purple-800 dark:text-purple-300">
                Guardian scans this QR inside the Universal Student App on their phone, sets their private 4-digit PIN, and gains access to all linked children.
              </p>
            </div>
          </div>

          {!generatedQr ? (
            <div className="space-y-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300">QR Generation Purpose</label>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setQrPurpose('guardian_first_activation')}
                    className={`rounded-lg border p-3 text-left transition ${
                      qrPurpose === 'guardian_first_activation'
                        ? 'border-purple-600 bg-purple-50 dark:bg-purple-950/50 text-purple-900 dark:text-purple-200'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600'
                    }`}
                  >
                    <p className="font-semibold text-xs">First Time Activation</p>
                    <p className="text-[10px] opacity-75">For initial device setup and PIN creation</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setQrPurpose('guardian_pin_reset')}
                    className={`rounded-lg border p-3 text-left transition ${
                      qrPurpose === 'guardian_pin_reset'
                        ? 'border-purple-600 bg-purple-50 dark:bg-purple-950/50 text-purple-900 dark:text-purple-200'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600'
                    }`}
                  >
                    <p className="font-semibold text-xs">Reset Forgotten PIN</p>
                    <p className="text-[10px] opacity-75">Allows parent to securely set a new PIN</p>
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => void handleGenerateQr()}
                  disabled={qrGenerating}
                  className="w-full rounded-lg bg-purple-700 hover:bg-purple-800 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {qrGenerating ? 'Generating Secure QR Code...' : 'Generate 15-Minute Activation QR'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div id="guardian-qr-print-slip" className="flex flex-col items-center bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 rounded-xl text-center space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{school.name_en}</p>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Guardian Mobile App Activation Slip
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Parent: <strong>{activeGuardian?.full_name}</strong> ({activeGuardian?.relationship}) · Mobile: <strong>{activeGuardian?.phone}</strong>
                </p>

                {activeGuardian?.linkedChildren && activeGuardian.linkedChildren.length > 0 && (
                  <p className="text-[11px] text-purple-700 dark:text-purple-400 font-medium">
                    Linked Children: {activeGuardian.linkedChildren.map((c) => `${c.name} (${c.className})`).join(', ')}
                  </p>
                )}

                <div className="p-3 bg-white border-2 border-purple-600 rounded-xl shadow-sm">
                  <Image
                    src={generatedQr.qrDataUrl}
                    alt="Guardian QR Activation"
                    width={220}
                    height={220}
                    className="mx-auto"
                    unoptimized
                  />
                </div>

                <div className="text-[11px] text-slate-500 space-y-1">
                  <p>
                    <span className="font-semibold text-rose-600">Valid for 15 minutes</span> · One-time use only
                  </p>
                  <p>
                    Expires at: <span className="font-mono-tabular font-semibold">{new Date(generatedQr.expiresAt).toLocaleTimeString()}</span>
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Security Token Hash: <span className="font-mono-tabular">{generatedQr.tokenPreview}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    const printContents = document.getElementById('guardian-qr-print-slip')?.innerHTML;
                    if (printContents) {
                      const win = window.open('', '', 'height=600,width=800');
                      if (win) {
                        win.document.write('<html><head><title>Guardian App Activation Slip</title><style>body{font-family:sans-serif;padding:24px;text-align:center;} img{margin:0 auto;}</style></head><body>');
                        win.document.write(printContents);
                        win.document.write('</body></html>');
                        win.document.close();
                        win.print();
                      }
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Activation Slip
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRevokeQr()}
                    className="rounded-lg border border-rose-300 dark:border-rose-900 text-rose-600 px-3 py-1.5 text-xs font-semibold hover:bg-rose-50"
                  >
                    Revoke Token
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleGenerateQr()}
                    className="inline-flex items-center gap-1 rounded-lg bg-purple-700 hover:bg-purple-800 px-3.5 py-1.5 text-xs font-semibold text-white"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Regenerate
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </ModalDialog>
    </div>
  );
}
