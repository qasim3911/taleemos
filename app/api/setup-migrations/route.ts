import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase/config';

export async function GET() {
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
  let schemaSql = '';
  let rlsSql = '';
  let studentIdSql = '';
  let leaveRlsSql = '';
  let questionPapersSql = '';
  let qrAccessSql = '';
  let guardianChildrenRlsSql = '';

  try {
    schemaSql = await readFile(path.join(migrationsDir, '001_initial_school_saas_schema.sql'), 'utf8');
    rlsSql = await readFile(path.join(migrationsDir, '002_rls_and_storage.sql'), 'utf8');
    studentIdSql = await readFile(path.join(migrationsDir, '003_add_student_id_column.sql'), 'utf8');
    leaveRlsSql = await readFile(path.join(migrationsDir, '004_leave_requests_and_rls.sql'), 'utf8');
    questionPapersSql = await readFile(path.join(migrationsDir, '005_question_papers.sql'), 'utf8');
    qrAccessSql = await readFile(path.join(migrationsDir, '006_qr_access_and_guardians.sql'), 'utf8');
    guardianChildrenRlsSql = await readFile(path.join(migrationsDir, '013_guardian_app_children_rls.sql'), 'utf8');
  } catch {
    // Migrations directory unavailable
  }

  return NextResponse.json({
    supabaseConfigured: isSupabaseConfigured(),
    adminConfigured: isSupabaseAdminConfigured(),
    schemaSql,
    rlsSql,
    studentIdSql,
    leaveRlsSql,
    questionPapersSql,
    qrAccessSql,
    guardianChildrenRlsSql,
  });
}
