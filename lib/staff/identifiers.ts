import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

/**
 * Generates a unique employee code for a new teacher/staff member in a school.
 * Pattern: EMP-001, EMP-002, ... (with collision verification & crypto fallback).
 */
export async function generateUniqueTeacherEmployeeCode(
  db: SupabaseClient,
  schoolId: string,
  options?: { forceRandomSuffix?: boolean }
): Promise<string> {
  const { data: existingRows } = await db
    .from('teachers')
    .select('employee_code')
    .eq('school_id', schoolId);

  const usedCodes = new Set<string>();
  let maxSeq = 0;

  for (const row of existingRows ?? []) {
    const code = (row as { employee_code?: string | null }).employee_code;
    if (!code) continue;
    const normalized = String(code).trim().toUpperCase();
    usedCodes.add(normalized);

    const trailingDigits = normalized.match(/(\d+)(?!.*\d)/);
    if (trailingDigits) {
      const parsedNum = Number.parseInt(trailingDigits[1], 10);
      if (Number.isFinite(parsedNum) && parsedNum < 1000000 && parsedNum > maxSeq) {
        maxSeq = parsedNum;
      }
    }
  }

  const startSeq = Math.max(maxSeq + 1, (existingRows?.length ?? 0) + 1);

  if (!options?.forceRandomSuffix) {
    for (let offset = 0; offset < 200; offset++) {
      const candidate = `EMP-${String(startSeq + offset).padStart(3, '0')}`;
      if (!usedCodes.has(candidate.toUpperCase())) {
        const { data: conflict } = await db
          .from('teachers')
          .select('id')
          .eq('school_id', schoolId)
          .ilike('employee_code', candidate)
          .maybeSingle();

        if (!conflict) {
          return candidate;
        }
        usedCodes.add(candidate.toUpperCase());
      }
    }
  }

  // Fallback with cryptographic random suffix to guarantee uniqueness under concurrency
  for (let i = 0; i < 20; i++) {
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const candidate = `EMP-${String(startSeq).padStart(3, '0')}-${suffix}`;
    if (!usedCodes.has(candidate.toUpperCase())) {
      const { data: conflict } = await db
        .from('teachers')
        .select('id')
        .eq('school_id', schoolId)
        .ilike('employee_code', candidate)
        .maybeSingle();
      if (!conflict) {
        return candidate;
      }
    }
  }

  return `EMP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function generateUniqueTeacherQrToken(): string {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `QR-TCH-${year}-${rand}`;
}
