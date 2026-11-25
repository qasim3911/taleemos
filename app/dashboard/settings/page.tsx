'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { useToast } from '@/components/providers/toast-provider';
import { Building2, Eye, EyeOff, ImagePlus, KeyRound, Loader2, Lock, Trash2, Upload } from 'lucide-react';

export default function SchoolSettingsPage() {
  const router = useRouter();
  const { school, member, userEmail } = useSchool();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>(school.logo_url || '');
  const [logoUrlInput, setLogoUrlInput] = useState<string>(school.logo_url || '');
  const [removeLogo, setRemoveLogo] = useState(false);

  const [form, setForm] = useState({
    name_en: school.name_en || '',
    name_ur: school.name_ur || '',
    mobile_number: school.mobile_number || '',
    email: school.email || '',
    address: school.address || '',
    district: school.district || '',
    tehsil: school.tehsil || '',
    province: school.province || 'Punjab',
    principal_name: school.principal_name || '',
    bise_peira_number: school.bise_peira_number || '',
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Logo too large', description: 'Please choose an image under 5 MB.', variant: 'error' });
      return;
    }
    setLogoFile(file);
    setRemoveLogo(false);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoPreview('');
    setLogoUrlInput('');
    setRemoveLogo(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name_en', form.name_en);
      fd.append('name_ur', form.name_ur);
      fd.append('mobile_number', form.mobile_number);
      fd.append('email', form.email);
      fd.append('address', form.address);
      fd.append('district', form.district);
      fd.append('tehsil', form.tehsil || form.district);
      fd.append('province', form.province);
      fd.append('principal_name', form.principal_name);
      fd.append('bise_peira_number', form.bise_peira_number);
      fd.append('remove_logo', removeLogo ? 'true' : 'false');
      if (logoFile) {
        fd.append('logo_file', logoFile);
      } else if (!removeLogo && logoUrlInput.trim()) {
        fd.append('logo_url', logoUrlInput.trim());
      }

      const res = await fetch('/api/school/settings', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast({ title: 'Unable to update settings', description: data.error, variant: 'error' });
        return;
      }

      const savedLogoUrl = data.school?.logo_url || '';
      setLogoFile(null);
      setRemoveLogo(false);
      setLogoPreview(savedLogoUrl);
      setLogoUrlInput(savedLogoUrl);

      toast({ title: 'School settings & logo updated', variant: 'success' });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);

    if (!currentPassword) {
      setPwError('Please enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('New password and confirm password do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setPwError('New password must be different from your current password.');
      return;
    }

    setChangingPw(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data.error || 'Unable to update password.';
        setPwError(msg);
        toast({ title: 'Password update failed', description: msg, variant: 'error' });
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowCurrentPw(false);
      setShowNewPw(false);
      setShowConfirmPw(false);
      toast({ title: 'Password updated successfully', variant: 'success' });
    } catch {
      const msg = 'Network error while updating password.';
      setPwError(msg);
      toast({ title: 'Password update failed', description: msg, variant: 'error' });
    } finally {
      setChangingPw(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-2xl font-bold">School Settings</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Update school logo, bilingual branding, campus address, and institutional details.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-6 text-xs"
      >
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {logoPreview ? (
                <img
                  src={logoPreview}
                  alt={form.name_en || 'School Logo'}
                  referrerPolicy="no-referrer"
                  className="h-16 w-16 rounded-xl object-cover border border-slate-200 dark:border-slate-700 bg-white"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-400">
                  <Building2 className="h-7 w-7" />
                </div>
              )}

              <div>
                <p className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  School Logo
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Displayed in School Sidebar, Portal Header, and Student Portal (PNG, JPG, WebP, SVG · Max 5 MB).
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-2 text-xs font-semibold text-white transition-colors">
                <Upload className="h-3.5 w-3.5" />
                {logoPreview ? 'Change Logo' : 'Upload Logo'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              {logoPreview && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-900 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300">
              <ImagePlus className="h-3.5 w-3.5" />
              Or Paste Logo Image URL (optional)
            </label>
            <input
              type="url"
              value={logoUrlInput}
              onChange={(e) => {
                setLogoFile(null);
                setRemoveLogo(false);
                setLogoUrlInput(e.target.value);
                setLogoPreview(e.target.value);
              }}
              placeholder="https://example.com/school-logo.png"
              className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block font-medium">School Name (English) *</label>
            <input
              required
              value={form.name_en}
              onChange={(e) => setForm({ ...form, name_en: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">School Name (Urdu)</label>
            <input
              dir="rtl"
              value={form.name_ur}
              onChange={(e) => setForm({ ...form, name_ur: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">Official Email *</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">Mobile / Contact Number</label>
            <input
              value={form.mobile_number}
              onChange={(e) => setForm({ ...form, mobile_number: e.target.value })}
              placeholder="03XX-XXXXXXX"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">Principal Name</label>
            <input
              value={form.principal_name}
              onChange={(e) => setForm({ ...form, principal_name: e.target.value })}
              placeholder="Principal / Owner Name"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">BISE / PEIRA / Board Number</label>
            <input
              value={form.bise_peira_number}
              onChange={(e) => setForm({ ...form, bise_peira_number: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">District / City</label>
            <input
              value={form.district}
              onChange={(e) => setForm({ ...form, district: e.target.value })}
              placeholder="e.g., Sheikhupura"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">Tehsil</label>
            <input
              value={form.tehsil}
              onChange={(e) => setForm({ ...form, tehsil: e.target.value })}
              placeholder="e.g., Sheikhupura"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block font-medium">Campus Address</label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save School Settings
          </button>
        </div>
      </form>

      <form
        onSubmit={handlePasswordChange}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5 text-xs"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Account Security &amp; Change Password
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Update the login password for{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {userEmail || member.email || school.email}
                </span>
                .
              </p>
            </div>
          </div>
        </div>

        {pwError && (
          <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
            {pwError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block font-medium">Current Password *</label>
            <div className="relative mt-1">
              <input
                type={showCurrentPw ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  if (pwError) setPwError(null);
                }}
                placeholder="Enter current password"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 pr-9 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPw((v) => !v)}
                aria-label={showCurrentPw ? 'Hide current password' : 'Show current password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block font-medium">New Password *</label>
            <div className="relative mt-1">
              <input
                type={showNewPw ? 'text' : 'password'}
                required
                minLength={8}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (pwError) setPwError(null);
                }}
                placeholder="Min 8 characters"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 pr-9 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowNewPw((v) => !v)}
                aria-label={showNewPw ? 'Hide new password' : 'Show new password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block font-medium">Confirm New Password *</label>
            <div className="relative mt-1">
              <input
                type={showConfirmPw ? 'text' : 'password'}
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (pwError) setPwError(null);
                }}
                placeholder="Re-enter new password"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 pr-9 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPw((v) => !v)}
                aria-label={showConfirmPw ? 'Hide confirm password' : 'Show confirm password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showConfirmPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Use at least 8 characters with a mix of letters, numbers, or symbols.
          </p>
          <button
            type="submit"
            disabled={changingPw}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-teal-700 dark:hover:bg-teal-800 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {changingPw ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Update Password
          </button>
        </div>
      </form>
    </div>
  );
}
