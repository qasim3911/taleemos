'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PublicHeader } from '@/components/public/public-header';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { useToast } from '@/components/providers/toast-provider';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';

function LoginFormContent() {
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const configured = isSupabaseConfigured();
  const setupPending = searchParams.get('setup') === 'pending' || !configured;
  const explicitNext = searchParams.get('next');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setErrorMsg(
        'Login service is not connected yet. Please try again later.'
      );
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error || !data.session) {
        // Generic message - email sahi hai ya password galat, ye nahi batana
        setErrorMsg('Invalid email or password. Please try again.');
        return;
      }

      let targetRedirect = explicitNext || '/dashboard';

      if (data.session?.access_token && data.session?.refresh_token) {
        const sessionRes = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            preferredPortal: 'school_admin',
          }),
        });

        const payload = await sessionRes.json().catch(() => ({}));
        if (!sessionRes.ok) {
          setErrorMsg('Unable to establish browser session. Please try again.');
          return;
        }

        if (!explicitNext && payload.redirectTo) {
          targetRedirect = payload.redirectTo;
        }
      }

      toast({ title: 'Signed in successfully', variant: 'success' });
      window.location.assign(targetRedirect);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-6 py-14">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          School Sign In
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          Sign in with your School Admin email to open the School Dashboard.
        </p>

        {setupPending && (
          <div className="mt-5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-4 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Supabase Connection Pending</p>
                <p className="mt-1 leading-relaxed">
                  Authentication and live school records will activate automatically once your
                  Supabase environment secrets are added.
                </p>
              </div>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="mt-5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="login-email"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              Email Address (School Admin)
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@email.com"
              className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Password
              </label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative mt-1.5">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 pr-10 text-sm text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 disabled:opacity-60 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign In to School Portal
          </button>
        </form>

        <div className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-5 text-center text-xs text-slate-600 dark:text-slate-400">
          New school on the platform?{' '}
          <Link href="/register" className="font-semibold text-teal-700 dark:text-teal-400 hover:underline">
            Register your school
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SchoolLoginPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <PublicHeader />
      <Suspense fallback={<div className="p-12 text-center text-sm text-slate-500">Loading...</div>}>
        <LoginFormContent />
      </Suspense>
    </div>
  );
}