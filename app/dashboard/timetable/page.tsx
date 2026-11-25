'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { Plus } from 'lucide-react';

interface TimetableRow {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string | null;
  day_of_week: string;
  start_time: string;
  end_time: string;
  room_no: string | null;
}

interface EventRow {
  id: string;
  title: string;
  event_type: string;
  start_date: string;
  end_date: string | null;
  description: string | null;
}

export default function TimetablePage() {
  const { school } = useSchool();
  const { toast } = useToast();

  const [entries, setEntries] = useState<TimetableRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [teachers, setTeachers] = useState<Array<{ id: string; full_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [openAdd, setOpenAdd] = useState(false);
  const [openEvent, setOpenEvent] = useState(false);

  const [form, setForm] = useState({
    class_id: '',
    subject_id: '',
    teacher_id: '',
    day_of_week: 'Monday',
    start_time: '08:00',
    end_time: '08:45',
    room_no: '',
  });
  const [eventForm, setEventForm] = useState({
    title: '',
    event_type: 'Holiday',
    start_date: '',
    end_date: '',
    description: '',
  });

  const loadData = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const [{ data: tt }, { data: ev }, { data: cls }, { data: sub }, { data: tch }] = await Promise.all([
      supabase.from('timetable_entries').select('*').eq('school_id', school.id),
      supabase.from('school_calendar_events').select('*').eq('school_id', school.id).order('start_date'),
      supabase.from('classes').select('id, name').eq('school_id', school.id),
      supabase.from('subjects').select('id, name').eq('school_id', school.id),
      supabase.from('teachers').select('id, full_name').eq('school_id', school.id),
    ]);
    setEntries(tt ?? []);
    setEvents(ev ?? []);
    setClasses(cls ?? []);
    setSubjects(sub ?? []);
    setTeachers(tch ?? []);
    setLoading(false);
  }, [school.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const classMap = new Map(classes.map((c) => [c.id, c.name]));
  const subjectMap = new Map(subjects.map((s) => [s.id, s.name]));
  const teacherMap = new Map(teachers.map((t) => [t.id, t.full_name]));

  const handleAddPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.from('timetable_entries').insert({
      school_id: school.id,
      ...form,
      teacher_id: form.teacher_id || null,
    });
    if (error) {
      toast({ title: 'Error saving period', description: error.message, variant: 'error' });
      return;
    }
    toast({ title: 'Timetable period saved', variant: 'success' });
    setOpenAdd(false);
    loadData();
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const effectiveEnd =
      eventForm.end_date && eventForm.end_date >= eventForm.start_date
        ? eventForm.end_date
        : eventForm.start_date;
    const { error } = await supabase.from('school_calendar_events').insert({
      school_id: school.id,
      title: eventForm.title,
      event_type: eventForm.event_type,
      start_date: eventForm.start_date,
      end_date: effectiveEnd,
      description: eventForm.description || null,
    });
    if (error) {
      toast({ title: 'Error saving event', description: error.message, variant: 'error' });
      return;
    }
    toast({
      title: eventForm.event_type === 'Holiday' ? 'Holiday saved & synced to Attendance' : 'Calendar event saved',
      variant: 'success',
    });
    setOpenEvent(false);
    setEventForm({ title: '', event_type: 'Holiday', start_date: '', end_date: '', description: '' });
    loadData();
  };

  const columns: TableColumn<TimetableRow>[] = [
    { key: 'day', header: 'Day', render: (r) => <span className="font-semibold">{r.day_of_week}</span>, exportValue: (r) => r.day_of_week },
    { key: 'time', header: 'Timing', render: (r) => <span className="font-mono-tabular">{r.start_time} – {r.end_time}</span>, exportValue: (r) => `${r.start_time}-${r.end_time}` },
    { key: 'cls', header: 'Class', render: (r) => classMap.get(r.class_id) || '—', exportValue: (r) => classMap.get(r.class_id) || '' },
    { key: 'sub', header: 'Subject', render: (r) => subjectMap.get(r.subject_id) || '—', exportValue: (r) => subjectMap.get(r.subject_id) || '' },
    { key: 'tch', header: 'Teacher', render: (r) => (r.teacher_id && teacherMap.get(r.teacher_id)) || '—', exportValue: (r) => (r.teacher_id && teacherMap.get(r.teacher_id)) || '' },
    { key: 'room', header: 'Room', render: (r) => r.room_no || '—' },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Class & Teacher Timetable"
        subtitle="Manage weekly period schedules alongside school holidays and academic calendar events."
        rows={entries}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.day_of_week} ${classMap.get(r.class_id) || ''} ${subjectMap.get(r.subject_id) || ''}`}
        exportFileName="school-timetable"
        primaryAction={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setForm({ ...form, class_id: classes[0]?.id || '', subject_id: subjects[0]?.id || '', teacher_id: teachers[0]?.id || '' });
                setOpenAdd(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Period
            </button>
            <button type="button" onClick={() => setOpenEvent(true)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-1.5 text-xs font-semibold">
              Add Holiday / Event
            </button>
          </div>
        }
      />

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-sm font-bold">School Holidays & Events</h2>
          <p className="text-[11px] text-slate-500">
            Holidays added here automatically lock attendance & protect teacher salary on those dates.
          </p>
        </div>
        {events.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No holidays or calendar events scheduled.</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {events.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="font-semibold">{ev.title} · <span className="text-slate-500">{ev.event_type}</span></p>
                  {ev.description && <p className="text-slate-500">{ev.description}</p>}
                </div>
                <span className="font-mono-tabular">
                  {ev.start_date}
                  {ev.end_date && ev.end_date !== ev.start_date ? ` → ${ev.end_date}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <ModalDialog open={openAdd} onClose={() => setOpenAdd(false)} title="Add Timetable Period">
        <form onSubmit={handleAddPeriod} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Day</label>
              <select value={form.day_of_week} onChange={(e) => setForm({ ...form, day_of_week: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-medium">Room No</label>
              <input value={form.room_no} onChange={(e) => setForm({ ...form, room_no: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Start Time</label>
              <input type="time" required value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">End Time</label>
              <input type="time" required value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block font-medium">Class *</label>
            <select required value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-medium">Subject *</label>
            <select required value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-medium">Teacher</label>
            <select value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              <option value="">Unassigned</option>
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenAdd(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Period</button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog open={openEvent} onClose={() => setOpenEvent(false)} title="Add Holiday / Calendar Event">
        <form onSubmit={handleAddEvent} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Title *</label>
            <input required value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block font-medium">Type</label>
              <select value={eventForm.event_type} onChange={(e) => setEventForm({ ...eventForm, event_type: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                <option value="Holiday">Holiday</option>
                <option value="Event">Event</option>
                <option value="Exam Calendar">Exam Calendar</option>
                <option value="Parent Meeting">Parent Meeting</option>
              </select>
            </div>
            <div>
              <label className="block font-medium">From Date *</label>
              <input
                type="date"
                required
                value={eventForm.start_date}
                onChange={(e) =>
                  setEventForm({
                    ...eventForm,
                    start_date: e.target.value,
                    end_date: !eventForm.end_date || eventForm.end_date < e.target.value ? e.target.value : eventForm.end_date,
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium">To Date</label>
              <input
                type="date"
                min={eventForm.start_date || undefined}
                value={eventForm.end_date}
                onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenEvent(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Event</button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
