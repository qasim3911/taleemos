'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PublicHeader } from '@/components/public/public-header';
import { Search, Loader2 } from 'lucide-react';

interface ApplicationData {
  name_en: string;
  name_ur: string | null;
  city: string;
  province: string;
  board_type: string;
  tracking_number: string;
  application_status: string;
  status_reason: string | null;
  created_at: string;
  updated_at: string;
}

function StatusLookupContent() {
  const searchParams = useSearchParams();
  const initialTracking = searchParams.get('tracking') || '';
  const [tracking, setTracking] = useState(initialTracking);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [application, setApplication] = useState<ApplicationData | null>(null);

  const lookup = async (trackVal: string) => {
    setErrorMsg(null);
    setLoading(true);
    try {
      const qs = trackVal.trim() ? `?tracking=${encodeURIComponent(trackVal.trim())}` : '';
      const res = await fetch(`/api/auth/application-status${qs}`);
      const data = await res.json();
      if (!res.ok) {
        setApplication(null);
        setErrorMsg(data.error || 'Unable to find application.');
        return;
      }
      setApplication(data.application);
    } catch {
      setErrorMsg('Unable to check status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialTracking) return;
    let active = true;
    fetch(`/api/auth/application-status?tracking=${encodeURIComponent(initialTracking.trim())}`)
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (!active) return;
        if (!ok) {
          setApplication(null);
          setErrorMsg(data.error || 'Unable to find application.');
        } else {
          setApplication(data.application);
        }
      })
      .catch(() => {
        if (active) setErrorMsg('Unable to check status.');
      });
    return () => {
      active = false;
    };
  }, [initialTracking]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          School Application Status
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          Enter your Application ID, Registration Number, or School Email to verify Super Admin approval status.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            lookup(tracking);
          }}
          className="mt-6 flex flex-col sm:flex-row gap-3"
        >
          <input
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            placeholder="Application ID, Reg No (e.g. SCH-...), or School Email"
            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 font-mono-tabular text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white whitespace-nowrap shrink-0"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Check Status
          </button>
        </form>

        {errorMsg && (
          <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-xs text-slate-600 dark:text-slate-300">
            {errorMsg}
          </div>
        )}

        {application && (
          <div className="mt-6 space-y-4 border-t border-slate-200 dark:border-slate-800 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  {application.name_en}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {application.city}, {application.province} · {application.board_type}
                </p>
              </div>
              <span className="font-mono-tabular text-sm font-semibold text-teal-700 dark:text-teal-400">
                Status: {application.application_status}
              </span>
            </div>

            {application.status_reason && (
              <p className="text-sm text-slate-700 dark:text-slate-300">
                Review Note: {application.status_reason}
              </p>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs text-slate-600 dark:text-slate-400">
              <div>
                <span className="block font-semibold text-slate-800 dark:text-slate-200">
                  Tracking Number
                </span>
                <span className="font-mono-tabular">{application.tracking_number}</span>
              </div>
              <div>
                <span className="block font-semibold text-slate-800 dark:text-slate-200">
                  Submitted On
                </span>
                <span className="font-mono-tabular">
                  {new Date(application.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>

            {application.application_status === 'Approved' && (
              <div className="pt-2">
                <Link
                  href="/dashboard"
                  className="inline-flex rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2 text-sm font-semibold text-white"
                >
                  Enter School Dashboard
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ApplicationStatusPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <PublicHeader />
      <Suspense fallback={<div className="p-12 text-center text-sm text-slate-500">Loading...</div>}>
        <StatusLookupContent />
      </Suspense>
    </div>
  );
}
