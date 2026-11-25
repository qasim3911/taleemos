'use client';

import React, { useState } from 'react';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_PRIORITIES,
  type ComplaintItem,
  type ComplaintPriority,
} from '@/lib/complaints/complaint-service';
import { MessageSquareWarning, Send } from 'lucide-react';

interface PortalComplaintsTabProps {
  roleLabel: 'Teacher' | 'Student';
  endpoint: '/api/teacher-portal' | '/api/student-portal';
  complaints: ComplaintItem[];
  onRefresh: () => Promise<void>;
  onFeedback: (fb: { type: 'success' | 'error'; text: string }) => void;
}

export function PortalComplaintsTab({
  roleLabel,
  endpoint,
  complaints,
  onRefresh,
  onFeedback,
}: PortalComplaintsTabProps) {
  const [form, setForm] = useState({
    category: COMPLAINT_CATEGORIES[0] as string,
    priority: 'normal' as ComplaintPriority,
    subject: '',
    description: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingId, setReplyingId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_complaint',
          category: form.category,
          priority: form.priority,
          subject: form.subject.trim(),
          description: form.description.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onFeedback({ type: 'error', text: data.error || 'Unable to submit complaint.' });
        return;
      }
      onFeedback({
        type: 'success',
        text: 'Your complaint has been submitted to the School Administration.',
      });
      setForm({
        category: COMPLAINT_CATEGORIES[0],
        priority: 'normal',
        subject: '',
        description: '',
      });
      await onRefresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (complaintId: string) => {
    const message = (replyDrafts[complaintId] || '').trim();
    if (!message) return;
    setReplyingId(complaintId);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reply_complaint',
          complaintId,
          message,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onFeedback({ type: 'error', text: data.error || 'Unable to send follow-up message.' });
        return;
      }
      setReplyDrafts((prev) => ({ ...prev, [complaintId]: '' }));
      onFeedback({ type: 'success', text: 'Follow-up message sent.' });
      await onRefresh();
    } finally {
      setReplyingId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <form
        onSubmit={handleSubmit}
        className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs h-fit"
      >
        <div className="flex items-center gap-2">
          <MessageSquareWarning className="h-4 w-4 text-teal-700 dark:text-teal-400" />
          <h2 className="font-display text-sm font-bold">Submit a Complaint ({roleLabel})</h2>
        </div>
        <p className="text-[11px] text-slate-500">
          Your complaint goes directly to the School Admin dashboard with real-time tracking.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-medium">Category *</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
            >
              {COMPLAINT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-medium">Priority *</label>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as ComplaintPriority })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
            >
              {COMPLAINT_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block font-medium">Subject *</label>
          <input
            required
            minLength={3}
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="Short title of your complaint"
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
          />
        </div>

        <div>
          <label className="block font-medium">Complaint Details *</label>
          <textarea
            required
            minLength={5}
            rows={4}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Explain your issue clearly so the school admin can resolve it quickly..."
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 px-4 py-2 font-semibold text-white"
        >
          <Send className="h-3.5 w-3.5" />
          {submitting ? 'Submitting...' : 'Submit Complaint'}
        </button>
      </form>

      <div className="lg:col-span-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <h2 className="font-display text-sm font-bold">
          My Submitted Complaints ({complaints.length})
        </h2>

        {complaints.length === 0 ? (
          <p className="text-xs text-slate-500">
            No complaints submitted yet. If you face any issue, use the form on the left to notify the School Admin.
          </p>
        ) : (
          <div className="space-y-4">
            {complaints.map((c) => {
              const statusBadge =
                c.status === 'resolved' || c.status === 'closed'
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
                  : c.status === 'in_progress'
                    ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900'
                    : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900';

              const statusLabel =
                c.status === 'in_progress'
                  ? 'In Progress'
                  : c.status.charAt(0).toUpperCase() + c.status.slice(1);

              return (
                <div
                  key={c.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 p-4 space-y-3 text-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{c.subject}</p>
                      <p className="text-[11px] text-slate-500">
                        {c.category} · Priority:{' '}
                        <span className="capitalize font-medium">{c.priority}</span> ·{' '}
                        {new Date(c.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${statusBadge}`}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {c.description}
                  </p>

                  {c.replies.length > 0 && (
                    <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-2.5">
                      <p className="text-[11px] font-semibold text-slate-500">
                        Conversation ({c.replies.length})
                      </p>
                      {c.replies.map((rep) => (
                        <div
                          key={rep.id}
                          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 space-y-1"
                        >
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-semibold text-teal-700 dark:text-teal-400">
                              {rep.senderName}
                            </span>
                            <span>{new Date(rep.createdAt).toLocaleString()}</span>
                          </div>
                          <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                            {rep.message}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {c.status !== 'closed' && (
                    <div className="flex gap-2 pt-1">
                      <input
                        value={replyDrafts[c.id] || ''}
                        onChange={(e) =>
                          setReplyDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))
                        }
                        placeholder="Add a follow-up message..."
                        className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        disabled={replyingId === c.id || !(replyDrafts[c.id] || '').trim()}
                        onClick={() => void handleReply(c.id)}
                        className="rounded-lg bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 disabled:opacity-50 px-3 py-1.5 text-[11px] font-semibold text-white"
                      >
                        {replyingId === c.id ? 'Sending...' : 'Reply'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
