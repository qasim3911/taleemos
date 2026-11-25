'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { Plus } from 'lucide-react';

interface TicketRow {
  id: string;
  ticket_number: string;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  created_at: string;
  student_id?: string | null;
  source_type?: 'student_app' | 'school_support';
  student_name?: string | null;
  student_admission_number?: string | null;
  student_class_label?: string | null;
}

interface TicketMsgRow {
  id: string;
  sender_role: string;
  sender_name: string;
  message: string;
  created_at: string;
}

const TICKET_STATUS_OPTIONS = ['Open', 'In Progress', 'Resolved', 'Closed'] as const;

export default function HelpSupportPage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'student_app' | 'school_support'>('all');
  const [loading, setLoading] = useState(true);
  const [openCreate, setOpenCreate] = useState(false);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [activeTicket, setActiveTicket] = useState<TicketRow | null>(null);
  const [messages, setMessages] = useState<TicketMsgRow[]>([]);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const [form, setForm] = useState({
    category: 'technical',
    subject: '',
    description: '',
    priority: 'medium',
  });

  const loadTickets = useCallback(async () => {
    try {
      const res = await fetch('/api/support', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const list = (data.tickets ?? []) as TicketRow[];
        setTickets(list);
        setActiveTicket((prev) =>
          prev ? list.find((t) => t.id === prev.id) ?? prev : null
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (ticketId: string) => {
    const res = await fetch(`/api/support?ticketId=${encodeURIComponent(ticketId)}`, {
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMessages(data.messages ?? []);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadTickets();
    });
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const ch = supabase
      .channel(`tickets-rt-${school.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_ticket_messages', filter: `school_id=eq.${school.id}` },
        () => {
          if (activeTicket) void loadMessages(activeTicket.id);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_tickets', filter: `school_id=eq.${school.id}` },
        () => void loadTickets()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadTickets, loadMessages, activeTicket, school.id]);

  const studentCount = useMemo(
    () => tickets.filter((t) => Boolean(t.student_id)).length,
    [tickets]
  );
  const schoolSupportCount = useMemo(
    () => tickets.filter((t) => !t.student_id).length,
    [tickets]
  );

  const filteredTickets = useMemo(() => {
    if (sourceFilter === 'student_app') {
      return tickets.filter((t) => Boolean(t.student_id));
    }
    if (sourceFilter === 'school_support') {
      return tickets.filter((t) => !t.student_id);
    }
    return tickets;
  }, [tickets, sourceFilter]);

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingTicket(true);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_ticket',
          ...form,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Error creating ticket',
          description: data.error || 'Could not create ticket.',
          variant: 'error',
        });
        return;
      }
      toast({
        title: `Support ticket ${data.ticket?.ticket_number || ''} submitted`,
        variant: 'success',
      });
      setOpenCreate(false);
      setForm({ category: 'technical', subject: '', description: '', priority: 'medium' });
      await loadTickets();
    } finally {
      setCreatingTicket(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !replyText.trim()) return;
    setSendingReply(true);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reply',
          ticketId: activeTicket.id,
          message: replyText.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Failed to send reply',
          description: data.error || 'Could not send message.',
          variant: 'error',
        });
        return;
      }
      setReplyText('');
      await Promise.all([loadMessages(activeTicket.id), loadTickets()]);
    } finally {
      setSendingReply(false);
    }
  };

  const handleStatusChange = async (ticketId: string, nextStatus: string) => {
    setUpdatingStatus(true);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_status',
          ticketId,
          status: nextStatus,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: 'Status update failed',
          description: data.error || 'Could not update ticket status.',
          variant: 'error',
        });
        return;
      }
      toast({ title: `Ticket marked as ${nextStatus}`, variant: 'success' });
      await loadTickets();
    } finally {
      setUpdatingStatus(false);
    }
  };

  const columns: TableColumn<TicketRow>[] = [
    {
      key: 'no',
      header: 'Ticket No',
      render: (r) => (
        <div>
          <p className="font-mono-tabular font-semibold">{r.ticket_number}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {r.student_id ? 'Student App' : 'Super Admin Ticket'}
          </p>
        </div>
      ),
    },
    {
      key: 'from',
      header: 'From / Student',
      render: (r) =>
        r.student_id ? (
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">
              {r.student_name || 'Student'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-mono-tabular">{r.student_admission_number || '—'}</span>
              {r.student_class_label ? ` · ${r.student_class_label}` : ''}
            </p>
          </div>
        ) : (
          <span className="text-slate-500 dark:text-slate-400">School Administration</span>
        ),
    },
    {
      key: 'sub',
      header: 'Subject & Message',
      render: (r) => (
        <div className="max-w-xs">
          <p className="font-semibold text-slate-900 dark:text-white truncate">{r.subject}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {r.category} · {r.description}
          </p>
        </div>
      ),
    },
    {
      key: 'prio',
      header: 'Priority',
      render: (r) => <span className="capitalize">{r.priority}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className="font-semibold capitalize">{r.status}</span>
      ),
    },
    {
      key: 'act',
      header: 'Conversation',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          onClick={() => {
            setActiveTicket(r);
            void loadMessages(r.id);
          }}
          className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          Open Thread
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Help & Support Messages"
        subtitle="View and reply to Student App support messages as well as Super Admin support tickets."
        rows={filteredTickets}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) =>
          `${r.ticket_number} ${r.subject} ${r.description} ${r.category} ${r.status} ${r.student_name ?? ''} ${r.student_admission_number ?? ''} ${r.student_class_label ?? ''}`
        }
        filters={
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5">
            {[
              { id: 'all', label: `All (${tickets.length})` },
              { id: 'student_app', label: `Student App (${studentCount})` },
              { id: 'school_support', label: `Super Admin (${schoolSupportCount})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSourceFilter(tab.id as typeof sourceFilter)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  sourceFilter === tab.id
                    ? 'bg-teal-700 text-white dark:bg-teal-600'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
        primaryAction={
          <button
            type="button"
            onClick={() => setOpenCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Support Ticket
          </button>
        }
      />

      <ModalDialog open={openCreate} onClose={() => setOpenCreate(false)} title="Create Support Ticket">
        <form onSubmit={handleCreateTicket} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm [color-scheme:light] dark:[color-scheme:dark]"
              >
                <option value="technical">Technical Support</option>
                <option value="billing">Billing &amp; Subscription</option>
                <option value="general">Mobile App / General</option>
              </select>
            </div>
            <div>
              <label className="block font-medium">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm [color-scheme:light] dark:[color-scheme:dark]"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block font-medium">Subject *</label>
            <input
              required
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-medium">Description *</label>
            <textarea
              required
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpenCreate(false)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creatingTicket}
              className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {creatingTicket ? 'Submitting...' : 'Submit Ticket'}
            </button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        open={Boolean(activeTicket)}
        onClose={() => setActiveTicket(null)}
        title={activeTicket ? `${activeTicket.ticket_number} — ${activeTicket.subject}` : ''}
        subtitle={
          activeTicket
            ? [
                activeTicket.student_name
                  ? `Student: ${activeTicket.student_name} (${activeTicket.student_admission_number || '—'})`
                  : 'Super Admin Support',
                activeTicket.student_class_label,
                `Priority: ${activeTicket.priority}`,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
      >
        {activeTicket && (
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Initial Message
                </p>
                <p className="mt-1 text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                  {activeTicket.description}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-semibold text-slate-500">Status:</span>
                <select
                  disabled={updatingStatus}
                  value={
                    TICKET_STATUS_OPTIONS.find(
                      (s) => s.toLowerCase() === activeTicket.status.toLowerCase()
                    ) ?? 'Open'
                  }
                  onChange={(e) => void handleStatusChange(activeTicket.id, e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-semibold [color-scheme:light] dark:[color-scheme:dark]"
                >
                  {TICKET_STATUS_OPTIONS.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
              {messages.length === 0 ? (
                <p className="text-center py-4 text-slate-500">
                  No replies yet. Send a message below.
                </p>
              ) : (
                messages.map((m) => {
                  const isSuperAdmin = m.sender_role === 'super_admin' || m.sender_role === 'admin';
                  return (
                    <div
                      key={m.id}
                      className={`rounded-lg p-3 ${
                        isSuperAdmin
                          ? 'bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900'
                          : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex justify-between text-[11px] text-slate-500">
                        <span className="font-semibold">
                          {m.sender_name || (isSuperAdmin ? 'Super Admin Support' : 'School Team')}
                        </span>
                        <span className="font-mono-tabular">
                          {new Date(m.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                        {m.message}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
            <form onSubmit={handleSendReply} className="flex gap-2">
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write a reply..."
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                disabled={sendingReply || !replyText.trim()}
                className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                {sendingReply ? 'Sending...' : 'Send Reply'}
              </button>
            </form>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}
