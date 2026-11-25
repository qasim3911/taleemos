import type { SupabaseClient } from '@supabase/supabase-js';

export const ALL_WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const DEFAULT_WORKING_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const UTC_WEEKDAY_MAP = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface SchoolHolidayEvent {
  id: string;
  title: string;
  event_type: string;
  start_date: string;
  end_date: string | null;
  description: string | null;
}

export interface DateHolidayInfo {
  isHoliday: boolean;
  kind: 'calendar_holiday' | 'weekly_off' | null;
  title: string | null;
  description: string | null;
  eventId: string | null;
  weekdayShort: string;
}

export function getWeekdayShort(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const dt = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return '';
  return UTC_WEEKDAY_MAP[dt.getUTCDay()] ?? '';
}

export function normalizeWorkingDays(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_WORKING_DAYS];
  }
  const allowed = new Set<string>(ALL_WEEK_DAYS);
  const cleaned = raw
    .map((d) => String(d).trim().slice(0, 3))
    .map((d) => d.charAt(0).toUpperCase() + d.slice(1).toLowerCase())
    .filter((d) => allowed.has(d));
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : [...DEFAULT_WORKING_DAYS];
}

export function getDateHolidayInfo(
  dateStr: string,
  workingDays: string[] | null | undefined,
  holidayEvents: SchoolHolidayEvent[]
): DateHolidayInfo {
  const weekdayShort = getWeekdayShort(dateStr);

  for (const ev of holidayEvents) {
    if (String(ev.event_type || '').toLowerCase() !== 'holiday') continue;
    const start = String(ev.start_date || '').slice(0, 10);
    const end = String(ev.end_date || ev.start_date || '').slice(0, 10);
    if (start && dateStr >= start && dateStr <= end) {
      return {
        isHoliday: true,
        kind: 'calendar_holiday',
        title: ev.title || 'School Holiday',
        description: ev.description || null,
        eventId: ev.id,
        weekdayShort,
      };
    }
  }

  const normalizedWorking = normalizeWorkingDays(workingDays);
  if (weekdayShort && !normalizedWorking.includes(weekdayShort)) {
    const fullName = weekdayShort === 'Sun' ? 'Sunday' : weekdayShort === 'Sat' ? 'Saturday' : weekdayShort;
    return {
      isHoliday: true,
      kind: 'weekly_off',
      title: `Weekly Off (${fullName})`,
      description: 'Configured as a non-working day in School Working Days.',
      eventId: null,
      weekdayShort,
    };
  }

  return {
    isHoliday: false,
    kind: null,
    title: null,
    description: null,
    eventId: null,
    weekdayShort,
  };
}

export async function getSchoolHolidayContext(
  db: SupabaseClient,
  schoolId: string
): Promise<{
  workingDays: string[];
  holidays: SchoolHolidayEvent[];
}> {
  const [{ data: profile }, { data: events }] = await Promise.all([
    db
      .from('school_profiles')
      .select('working_days')
      .eq('school_id', schoolId)
      .maybeSingle(),
    db
      .from('school_calendar_events')
      .select('id, title, event_type, start_date, end_date, description')
      .eq('school_id', schoolId)
      .eq('event_type', 'Holiday')
      .order('start_date', { ascending: true }),
  ]);

  return {
    workingDays: normalizeWorkingDays(profile?.working_days),
    holidays: (events ?? []) as SchoolHolidayEvent[],
  };
}
