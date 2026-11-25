import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export interface GeneratedStudentIdentifiers {
  admissionNumber: string;
  studentId: string;
  rollNumber: string;
}

export async function hasStudentsColumn(
  db: SupabaseClient,
  columnName: string
): Promise<boolean> {
  const { error } = await db.from('students').select(columnName).limit(1);
  return !error;
}

export async function generateUniqueStudentIdentifiers(
  db: SupabaseClient,
  schoolId: string,
  schoolName?: string | null
): Promise<GeneratedStudentIdentifiers> {
  const supportsStudentId = await hasStudentsColumn(db, 'student_id');
  const selectCols = supportsStudentId
    ? 'admission_number, roll_number, student_id'
    : 'admission_number, roll_number';

  const { data: existingRows } = await db
    .from('students')
    .select(selectCols)
    .eq('school_id', schoolId);

  const usedAdmissions = new Set<string>();
  const usedRolls = new Set<string>();
  const usedStudentIds = new Set<string>();

  let maxAdmSeq = 0;
  let maxRollSeq = 0;

  for (const rawRow of existingRows ?? []) {
    const row = rawRow as unknown as {
      admission_number?: string | null;
      roll_number?: string | null;
      student_id?: string | null;
    };
    if (row.admission_number) {
      usedAdmissions.add(String(row.admission_number).trim().toUpperCase());
      const matches = String(row.admission_number).match(/(\d+)(?!.*\d)/);
      if (matches) {
        const num = Number.parseInt(matches[1], 10);
        if (Number.isFinite(num) && num < 1000000 && num > maxAdmSeq) {
          maxAdmSeq = num;
        }
      }
    }
    if (row.roll_number) {
      usedRolls.add(String(row.roll_number).trim().toUpperCase());
      const rollMatches = String(row.roll_number).match(/^\d+$/);
      if (rollMatches) {
        const num = Number.parseInt(rollMatches[0], 10);
        if (Number.isFinite(num) && num < 1000000 && num > maxRollSeq) {
          maxRollSeq = num;
        }
      }
    }
    if (row.student_id) {
      usedStudentIds.add(String(row.student_id).trim().toUpperCase());
    }
  }

  const year = new Date().getFullYear();
  const shortYear = String(year).slice(-2);
  const schoolPrefix =
    (schoolName || 'SCH')
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 3)
      .toUpperCase() || 'SCH';

  const admSeq = Math.max(maxAdmSeq + 1, (existingRows?.length ?? 0) + 1);
  let admissionNumber = '';
  for (let i = 0; i < 100; i++) {
    const candidate = `ADM-${year}-${String(admSeq + i).padStart(4, '0')}`;
    if (!usedAdmissions.has(candidate.toUpperCase())) {
      admissionNumber = candidate;
      break;
    }
  }
  if (!admissionNumber) {
    admissionNumber = `ADM-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }

  const rollSeq = Math.max(maxRollSeq + 1, (existingRows?.length ?? 0) + 1);
  let rollNumber = '';
  for (let i = 0; i < 100; i++) {
    const candidate = String(rollSeq + i).padStart(3, '0');
    if (!usedRolls.has(candidate.toUpperCase())) {
      rollNumber = candidate;
      break;
    }
  }
  if (!rollNumber) {
    rollNumber = `${Date.now().toString().slice(-4)}`;
  }

  let studentId = '';
  for (let i = 0; i < 20; i++) {
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const candidate = `STD-${schoolPrefix}${shortYear}-${String(admSeq).padStart(3, '0')}${suffix}`;
    if (!usedStudentIds.has(candidate.toUpperCase())) {
      if (supportsStudentId) {
        const { data: conflict } = await db
          .from('students')
          .select('id')
          .eq('student_id', candidate)
          .maybeSingle();
        if (!conflict) {
          studentId = candidate;
          break;
        }
      } else {
        studentId = candidate;
        break;
      }
    }
  }
  if (!studentId) {
    studentId = `STD-${shortYear}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  }

  return { admissionNumber, studentId, rollNumber };
}
