'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export function ModalDialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidthClass = 'max-w-xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 print:static print:block print:bg-white print:p-0">
      <div
        className={`w-full ${maxWidthClass} max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl print:max-h-none print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none`}
      >
        <div className="no-print flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 px-6 py-4">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6 print:p-0">{children}</div>
      </div>
    </div>
  );
}
