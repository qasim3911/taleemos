'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { PublicHeader } from '@/components/public/public-header';
import { useToast } from '@/components/providers/toast-provider';
import { CheckCircle2, Loader2, Sparkles, ShieldCheck, Eye, EyeOff } from 'lucide-react';

const PROVINCES = [
  'Punjab',
  'Sindh',
  'Khyber Pakhtunkhwa',
  'Balochistan',
  'Islamabad Capital Territory',
  'Azad Jammu & Kashmir',
  'Gilgit-Baltistan',
];

const BOARDS = [
  'Punjab Board',
  'Federal Board',
  'Sindh Board',
  'KP Board',
  'Balochistan Board',
  'Cambridge / O-A Level',
  'Custom',
];

const SCHOOL_TYPES = [
  'Private',
  'Government',
  'Public',
  'Semi-Government',
  'Trust',
  'Madrasa',
  'Cambridge',
  'Primary',
  'Middle',
  'High',
  'Higher Secondary',
  'College',
  'Academy',
];

export default function SchoolRegisterPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{
    trackingNumber: string;
    schoolCode?: string;
    applicationStatus: string;
    schoolName: string;
  } | null>(null);

  const [form, setForm] = useState({
    ownerName: '',
    ownerEmail: '',
    password: '',
    schoolCode: '',
    schoolNameEn: '',
    schoolNameUr: '',
    boardType: 'Punjab Board',
    schoolType: 'Private',
    registrationNumber: '',
    schoolEmail: '',
    phone: '',
    address: '',
    city: '',
    province: 'Punjab',
  });

  const generateSchoolId = () => {
    const acronym = form.schoolNameEn.trim()
      ? form.schoolNameEn
          .trim()
          .split(/\s+/)
          .map((w) => w[0])
          .join('')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 4)
      : 'SCH';
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `${acronym || 'SCH'}-${new Date().getFullYear().toString().slice(-2)}${rand}`;
    setForm((prev) => ({
      ...prev,
      schoolCode: code,
      registrationNumber: prev.registrationNumber || code,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register-school', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Unable to submit registration.');
        return;
      }
      setResult(data);
      toast({
        title: 'School Registered Successfully',
        description: `Unique School ID: ${data.schoolCode || data.trackingNumber}`,
        variant: 'success',
      });
    } catch {
      setErrorMsg('Network error while submitting application.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <PublicHeader />

      <div className="mx-auto max-w-3xl px-6 py-12">
        {result ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
            <div className="flex items-center gap-3 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-6 w-6" />
              <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                School Registration Submitted
              </h1>
            </div>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              Your application for <strong>{result.schoolName}</strong> is registered successfully. Multi-tenant data isolation ensures your school data is completely private and protected.
            </p>
            <div className="mt-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Assigned Unique School ID
                  </p>
                  <p className="mt-1 font-mono-tabular text-2xl font-bold text-teal-700 dark:text-teal-400">
                    {result.schoolCode || result.trackingNumber}
                  </p>
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="h-4 w-4" />
                  Isolated Tenant
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Is unique School ID ke tehat aapka data kisi doosray school ke sath kabhi share nahi hoga.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={`/status?tracking=${encodeURIComponent(result.schoolCode || result.trackingNumber)}`}
                className="rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Track Application Status
              </Link>
              <Link
                href="/login"
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200"
              >
                Go to School Login
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              Register Your School
            </h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
              Submit your school profile. Each school is assigned a unique identifier ensuring complete data isolation.
            </p>

            {errorMsg && (
              <div className="mt-5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300 font-medium">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-6">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  01. School Owner Account
                </h2>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Owner Full Name
                    </label>
                    <input
                      required
                      value={form.ownerName}
                      onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Owner Login Email
                    </label>
                    <input
                      type="email"
                      required
                      value={form.ownerEmail}
                      onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Password (min 8 chars)
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 pr-10 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 mt-0.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800 pt-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    02. Institution Particulars & Unique School ID
                  </h2>
                </div>

                {/* Unique School ID Box */}
                <div className="mt-3 rounded-xl border border-teal-200 dark:border-teal-900/60 bg-teal-50/50 dark:bg-teal-950/20 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-teal-900 dark:text-teal-200">
                        <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                        School ID / Code (Unique Identifier) *
                      </label>
                      <p className="text-[11px] text-teal-700 dark:text-teal-400 mt-0.5">
                        Har school ki ID unique honi chahiye taakay aapka data mukammal alag aur private rahay.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={generateSchoolId}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 dark:border-teal-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-slate-800 shadow-xs transition"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                      Auto-Generate Unique ID
                    </button>
                  </div>
                  <div className="mt-2.5">
                    <input
                      required
                      value={form.schoolCode}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          schoolCode: e.target.value.toUpperCase().replace(/[^A-Z0-9\-_/]/g, ''),
                          registrationNumber: form.registrationNumber || e.target.value.toUpperCase(),
                        })
                      }
                      placeholder="e.g. KIPS-SKP, AQS-7876, SCH-26X9"
                      className="w-full rounded-lg border border-teal-300 dark:border-teal-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono uppercase font-semibold text-slate-900 dark:text-white placeholder:normal-case placeholder:font-normal focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      School Name (English)
                    </label>
                    <input
                      required
                      value={form.schoolNameEn}
                      onChange={(e) => setForm({ ...form, schoolNameEn: e.target.value })}
                      placeholder="e.g. Al-Qalam Grammar School"
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      School Name (Urdu - Optional)
                    </label>
                    <input
                      dir="rtl"
                      value={form.schoolNameUr}
                      onChange={(e) => setForm({ ...form, schoolNameUr: e.target.value })}
                      placeholder="القلم گرامر سکول"
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Education Board
                    </label>
                    <select
                      value={form.boardType}
                      onChange={(e) => setForm({ ...form, boardType: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    >
                      {BOARDS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      School Type
                    </label>
                    <select
                      required
                      value={form.schoolType}
                      onChange={(e) => setForm({ ...form, schoolType: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    >
                      {SCHOOL_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Board / BISE Registration No.
                    </label>
                    <input
                      value={form.registrationNumber}
                      onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Official School Email
                    </label>
                    <input
                      type="email"
                      required
                      value={form.schoolEmail}
                      onChange={(e) => setForm({ ...form, schoolEmail: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Contact Number
                    </label>
                    <input
                      required
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="0300-1234567"
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      City
                    </label>
                    <input
                      required
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      placeholder="Lahore"
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Province / Region
                    </label>
                    <select
                      value={form.province}
                      onChange={(e) => setForm({ ...form, province: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    >
                      {PROVINCES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Campus Address
                    </label>
                    <input
                      required
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800 pt-5">
                <Link
                  href="/login"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Back to Login
                </Link>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 disabled:opacity-60 px-5 py-2 text-sm font-semibold text-white"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Submit School Application
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}