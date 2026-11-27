'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PublicHeader } from '@/components/public/public-header';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useToast } from '@/components/providers/toast-provider';
import { Loader2 } from 'lucide-react';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // STEP 1 - Email pe Code bhejo
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setMessage(null);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setErrorMsg('Supabase is not connected yet.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: false },
      });
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setStep(2);
      setMessage('6-digit code has been sent to your email.');
    } finally {
      setLoading(false);
    }
  };

  // STEP 2 - Code verify + Naya Password set karo
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    try {
      // 1. Code verify karo
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: 'email',
      });
      if (verifyError) {
        setErrorMsg(verifyError.message);
        return;
      }

      // 2. Password update karo
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setErrorMsg(updateError.message);
        return;
      }

      await supabase.auth.signOut();
      await fetch('/api/auth/session', { method: 'DELETE' });
      toast({ title: 'Password updated successfully. Please sign in.', variant: 'success' });
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <PublicHeader />
      <div className="mx-auto max-w-md px-6 py-14">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
          <h1 className="font-display text-2xl font-bold">Forgot Password</h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            {step === 1
              ? 'Enter your registered email to receive a 6-digit code.'
              : `Enter the code sent to ${email} and choose a new password.`}
          </p>

          {errorMsg && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {errorMsg}
            </div>
          )}
          {message && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              {message}
            </div>
          )}

          {step === 1 ? (
            <form onSubmit={handleSendCode} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold">Registered Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border px-3.5 py-2.5 text-sm bg-white dark:bg-slate-950"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Send 6-Digit Code
              </button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold">6-Digit Code</label>
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="mt-1.5 w-full rounded-lg border px-3.5 py-2.5 text-sm tracking-[0.3em] text-center font-bold bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold">New Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border px-3.5 py-2.5 text-sm bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold">Confirm New Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border px-3.5 py-2.5 text-sm bg-white dark:bg-slate-950"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Update Password
              </button>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="w-full text-center text-xs font-semibold text-teal-700 hover:underline"
              >
                Change Email / Resend Code
              </button>
            </form>
          )}

          <div className="mt-5 text-center text-xs">
            <Link href="/login" className="font-semibold text-teal-700 hover:underline">
              Return to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}