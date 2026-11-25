'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PublicHeader } from '@/components/public/public-header';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useToast } from '@/components/providers/toast-provider';
import { Loader2 } from 'lucide-react';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const initSession = async () => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setErrorMsg('Supabase is not connected yet.');
          setVerifying(false);
        }
        return;
      }
      try {
        const searchParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));

        const urlError =
          searchParams.get('error_description') ||
          hashParams.get('error_description') ||
          searchParams.get('error') ||
          hashParams.get('error');

        if (urlError) {
          if (!cancelled) {
            setErrorMsg(decodeURIComponent(urlError.replace(/\+/g, ' ')));
            setVerifying(false);
          }
          return;
        }

        const code = searchParams.get('code');
        const tokenHash = searchParams.get('token_hash');
        const type = (searchParams.get('type') || hashParams.get('type') || 'recovery') as
          | 'recovery'
          | 'invite'
          | 'email';
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            if (!cancelled) {
              setErrorMsg(error.message);
              setVerifying(false);
            }
            return;
          }
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            if (!cancelled) {
              setErrorMsg(error.message);
              setVerifying(false);
            }
            return;
          }
        } else if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type,
          });
          if (error) {
            if (!cancelled) {
              setErrorMsg(error.message);
              setVerifying(false);
            }
            return;
          }
        }

        const { data } = await supabase.auth.getSession();
        if (!cancelled) {
          if (data.session) {
            setSessionReady(true);
          } else {
            setErrorMsg(
              'Password setup link is missing or expired. Please ask your school admin to resend the link.'
            );
          }
          setVerifying(false);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Unable to verify password link.');
          setVerifying(false);
        }
      }
    };

    void initSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
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
    if (!supabase) {
      setErrorMsg('Supabase is not connected yet.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMsg(error.message);
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
          <h1 className="font-display text-2xl font-bold">Set New Password</h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Choose a strong password for your school portal account.
          </p>

          {verifying && (
            <div className="mt-6 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verifying secure setup link...
            </div>
          )}

          {errorMsg && (
            <div className="mt-4 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          {!verifying && sessionReady && (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-sm"
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
            </form>
          )}

          <div className="mt-5 text-center text-xs">
            <Link href="/login" className="font-semibold text-teal-700 dark:text-teal-400 hover:underline">
              Return to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
