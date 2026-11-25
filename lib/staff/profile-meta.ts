export type StaffGender = 'Male' | 'Female' | 'Other';

interface StaffProfileDocEntry {
  type: 'staff_profile';
  date_of_birth: string | null;
  gender: StaffGender;
}

export function normalizeStaffGender(raw: unknown): StaffGender {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'female') return 'Female';
  if (val === 'other') return 'Other';
  return 'Male';
}

export function extractTeacherProfileMeta(row: {
  date_of_birth?: unknown;
  gender?: unknown;
  documents?: unknown;
}): { date_of_birth: string | null; gender: StaffGender | null } {
  const docs = Array.isArray(row.documents) ? row.documents : [];
  const meta = docs.find(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && (item as Record<string, unknown>).type === 'staff_profile'
  );

  const rawDob =
    (typeof row.date_of_birth === 'string' && row.date_of_birth) ||
    (meta && typeof meta.date_of_birth === 'string' && meta.date_of_birth) ||
    null;

  const rawGender =
    (typeof row.gender === 'string' && row.gender) ||
    (meta && typeof meta.gender === 'string' && meta.gender) ||
    null;

  return {
    date_of_birth: rawDob ? String(rawDob).slice(0, 10) : null,
    gender: rawGender ? normalizeStaffGender(rawGender) : null,
  };
}

export function mergeTeacherProfileDocuments(
  existingDocs: unknown,
  updates: { date_of_birth?: string | null; gender?: StaffGender | null }
): unknown[] {
  const docs = Array.isArray(existingDocs) ? existingDocs : [];
  const otherDocs = docs.filter(
    (item) =>
      !(Boolean(item) && typeof item === 'object' && (item as Record<string, unknown>).type === 'staff_profile')
  );
  const prevMeta = docs.find(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && (item as Record<string, unknown>).type === 'staff_profile'
  );

  const nextDob =
    updates.date_of_birth !== undefined
      ? updates.date_of_birth?.trim() || null
      : typeof prevMeta?.date_of_birth === 'string'
        ? prevMeta.date_of_birth
        : null;

  const nextGender: StaffGender =
    updates.gender !== undefined && updates.gender !== null
      ? normalizeStaffGender(updates.gender)
      : prevMeta?.gender
        ? normalizeStaffGender(prevMeta.gender)
        : 'Male';

  const entry: StaffProfileDocEntry = {
    type: 'staff_profile',
    date_of_birth: nextDob,
    gender: nextGender,
  };

  return [...otherDocs, entry];
}
