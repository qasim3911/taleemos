import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export type QuestionType = 'mcq' | 'short' | 'long' | 'fill_blank' | 'true_false';

export interface PaperQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  marks: number;
  options?: string[];
  correctAnswer?: string;
  isRtl?: boolean;
}

export interface PaperSection {
  id: string;
  title: string;
  instructions?: string;
  questions: PaperQuestion[];
}

export interface QuestionPaperRecord {
  id: string;
  school_id: string;
  exam_id: string | null;
  class_id: string | null;
  section_id: string | null;
  subject_id: string | null;
  title: string;
  paper_code: string | null;
  paper_type: 'Test' | 'Quiz' | 'Monthly' | 'Midterm' | 'Final' | 'Exam';
  exam_date: string | null;
  time_allowed: string;
  total_marks: number;
  passing_marks: number;
  academic_session: string | null;
  instructions: string | null;
  language: 'en' | 'ur' | 'bilingual';
  show_student_info_box: boolean;
  show_answer_lines: boolean;
  sections: PaperSection[];
  status: 'draft' | 'finalized';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const STORAGE_BUCKET = 'documents';

function getStorageFolder(schoolId: string): string {
  return `${schoolId}/question-papers`;
}

function getStoragePath(schoolId: string, paperId: string): string {
  return `${getStorageFolder(schoolId)}/${paperId}.json`;
}

export function calculatePaperTotalMarks(sections: PaperSection[]): number {
  let sum = 0;
  for (const sec of sections) {
    for (const q of sec.questions) {
      sum += Number(q.marks) || 0;
    }
  }
  return Math.round(sum * 100) / 100;
}

export async function hasQuestionPapersTable(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from('question_papers').select('id').limit(1);
  return !error;
}

export async function listQuestionPapers(
  db: SupabaseClient,
  schoolId: string
): Promise<{ papers: QuestionPaperRecord[]; storageMode: 'table' | 'storage' }> {
  const useTable = await hasQuestionPapersTable(db);
  if (useTable) {
    const { data, error } = await db
      .from('question_papers')
      .select('*')
      .eq('school_id', schoolId)
      .order('updated_at', { ascending: false });

    if (!error && data) {
      return {
        papers: data as QuestionPaperRecord[],
        storageMode: 'table',
      };
    }
  }

  const folder = getStorageFolder(schoolId);
  const { data: files, error: listErr } = await db.storage
    .from(STORAGE_BUCKET)
    .list(folder, { limit: 200, sortBy: { column: 'updated_at', order: 'desc' } });

  if (listErr || !files || files.length === 0) {
    return { papers: [], storageMode: 'storage' };
  }

  const jsonFiles = files.filter((f) => f.name.endsWith('.json'));
  const downloaded = await Promise.all(
    jsonFiles.map(async (f) => {
      const { data: blob } = await db.storage
        .from(STORAGE_BUCKET)
        .download(`${folder}/${f.name}`);
      if (!blob) return null;
      try {
        const text = await blob.text();
        const parsed = JSON.parse(text) as QuestionPaperRecord;
        if (parsed && parsed.school_id === schoolId) {
          return parsed;
        }
        return null;
      } catch {
        return null;
      }
    })
  );

  const papers = downloaded
    .filter((item): item is QuestionPaperRecord => Boolean(item))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

  return { papers, storageMode: 'storage' };
}

export async function saveQuestionPaper(
  db: SupabaseClient,
  input: Omit<QuestionPaperRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }
): Promise<{ paper: QuestionPaperRecord | null; error: string | null; storageMode: 'table' | 'storage' }> {
  const now = new Date().toISOString();
  const paperId = input.id || crypto.randomUUID();
  const useTable = await hasQuestionPapersTable(db);

  if (useTable) {
    if (input.id) {
      const { data, error } = await db
        .from('question_papers')
        .update({
          exam_id: input.exam_id,
          class_id: input.class_id,
          section_id: input.section_id,
          subject_id: input.subject_id,
          title: input.title,
          paper_code: input.paper_code,
          paper_type: input.paper_type,
          exam_date: input.exam_date,
          time_allowed: input.time_allowed,
          total_marks: input.total_marks,
          passing_marks: input.passing_marks,
          academic_session: input.academic_session,
          instructions: input.instructions,
          language: input.language,
          show_student_info_box: input.show_student_info_box,
          show_answer_lines: input.show_answer_lines,
          sections: input.sections,
          status: input.status,
          updated_at: now,
        })
        .eq('id', input.id)
        .eq('school_id', input.school_id)
        .select('*')
        .single();

      if (!error && data) {
        return { paper: data as QuestionPaperRecord, error: null, storageMode: 'table' };
      }
      if (error) {
        return { paper: null, error: error.message, storageMode: 'table' };
      }
    } else {
      const { data, error } = await db
        .from('question_papers')
        .insert({
          id: paperId,
          school_id: input.school_id,
          exam_id: input.exam_id,
          class_id: input.class_id,
          section_id: input.section_id,
          subject_id: input.subject_id,
          title: input.title,
          paper_code: input.paper_code,
          paper_type: input.paper_type,
          exam_date: input.exam_date,
          time_allowed: input.time_allowed,
          total_marks: input.total_marks,
          passing_marks: input.passing_marks,
          academic_session: input.academic_session,
          instructions: input.instructions,
          language: input.language,
          show_student_info_box: input.show_student_info_box,
          show_answer_lines: input.show_answer_lines,
          sections: input.sections,
          status: input.status,
          created_by: input.created_by,
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single();

      if (!error && data) {
        return { paper: data as QuestionPaperRecord, error: null, storageMode: 'table' };
      }
      if (error) {
        return { paper: null, error: error.message, storageMode: 'table' };
      }
    }
  }

  let existingCreatedAt = now;
  if (input.id) {
    const { data: prevBlob } = await db.storage
      .from(STORAGE_BUCKET)
      .download(getStoragePath(input.school_id, input.id));
    if (prevBlob) {
      try {
        const prev = JSON.parse(await prevBlob.text()) as QuestionPaperRecord;
        if (prev?.created_at) existingCreatedAt = prev.created_at;
      } catch {
        // Ignore parse failure
      }
    }
  }

  const record: QuestionPaperRecord = {
    id: paperId,
    school_id: input.school_id,
    exam_id: input.exam_id,
    class_id: input.class_id,
    section_id: input.section_id,
    subject_id: input.subject_id,
    title: input.title,
    paper_code: input.paper_code,
    paper_type: input.paper_type,
    exam_date: input.exam_date,
    time_allowed: input.time_allowed,
    total_marks: input.total_marks,
    passing_marks: input.passing_marks,
    academic_session: input.academic_session,
    instructions: input.instructions,
    language: input.language,
    show_student_info_box: input.show_student_info_box,
    show_answer_lines: input.show_answer_lines,
    sections: input.sections,
    status: input.status,
    created_by: input.created_by,
    created_at: existingCreatedAt,
    updated_at: now,
  };

  const payload = Buffer.from(JSON.stringify(record, null, 2), 'utf8');
  const { error: upErr } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(getStoragePath(input.school_id, paperId), payload, {
      contentType: 'application/json',
      upsert: true,
    });

  if (upErr) {
    return { paper: null, error: upErr.message, storageMode: 'storage' };
  }

  return { paper: record, error: null, storageMode: 'storage' };
}

export async function deleteQuestionPaper(
  db: SupabaseClient,
  schoolId: string,
  paperId: string
): Promise<{ error: string | null }> {
  const useTable = await hasQuestionPapersTable(db);
  if (useTable) {
    const { error } = await db
      .from('question_papers')
      .delete()
      .eq('id', paperId)
      .eq('school_id', schoolId);

    if (error) {
      return { error: error.message };
    }
    return { error: null };
  }

  const { error } = await db.storage
    .from(STORAGE_BUCKET)
    .remove([getStoragePath(schoolId, paperId)]);

  return { error: error ? error.message : null };
}
