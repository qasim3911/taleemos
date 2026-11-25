'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { Plus } from 'lucide-react';

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  category: string;
  total_copies: number;
  available_copies: number;
  rack_number: string | null;
}

interface IssueRow {
  id: string;
  book_id: string;
  student_id: string;
  issued_at: string;
  due_date: string;
  returned_at: string | null;
  fine_pkr: number;
  status: string;
}

export default function LibraryPage() {
  const { school } = useSchool();
  const { toast } = useToast();
  const [books, setBooks] = useState<BookRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [students, setStudents] = useState<Array<{ id: string; name_en: string; admission_number: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [openBook, setOpenBook] = useState(false);
  const [openIssue, setOpenIssue] = useState(false);

  const [bookForm, setBookForm] = useState({ title: '', author: '', isbn: '', category: 'Science', total_copies: '5', rack_number: '' });
  const [issueForm, setIssueForm] = useState({ book_id: '', student_id: '', due_date: '' });

  const loadData = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const [{ data: bRows }, { data: iRows }, { data: sRows }] = await Promise.all([
      supabase.from('library_books').select('*').eq('school_id', school.id).order('title'),
      supabase.from('library_issues').select('*').eq('school_id', school.id).order('issued_at', { ascending: false }),
      supabase.from('students').select('id, name_en, admission_number').eq('school_id', school.id).in('status', ['active', 'Active']),
    ]);
    setBooks(bRows ?? []);
    setIssues(iRows ?? []);
    setStudents(sRows ?? []);
    setLoading(false);
  }, [school.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const handleAddBook = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const qty = Number(bookForm.total_copies) || 1;
    const { error } = await supabase.from('library_books').insert({
      school_id: school.id,
      title: bookForm.title,
      author: bookForm.author || 'Unknown',
      isbn: bookForm.isbn || null,
      category: bookForm.category,
      total_copies: qty,
      available_copies: qty,
      rack_number: bookForm.rack_number || null,
    });
    if (error) {
      toast({ title: 'Error saving book', description: error.message, variant: 'error' });
      return;
    }
    toast({ title: 'Book added to inventory', variant: 'success' });
    setOpenBook(false);
    loadData();
  };

  const handleIssueBook = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const book = books.find((b) => b.id === issueForm.book_id);
    if (!book || book.available_copies <= 0) {
      toast({ title: 'No copies available', variant: 'error' });
      return;
    }
    const { error } = await supabase.from('library_issues').insert({
      school_id: school.id,
      book_id: issueForm.book_id,
      student_id: issueForm.student_id,
      issued_at: new Date().toISOString().slice(0, 10),
      due_date: issueForm.due_date,
      fine_pkr: 0,
      status: 'issued',
    });
    if (error) {
      toast({ title: 'Unable to issue book', description: error.message, variant: 'error' });
      return;
    }
    await supabase
      .from('library_books')
      .update({ available_copies: book.available_copies - 1 })
      .eq('id', book.id)
      .eq('school_id', school.id);
    toast({ title: 'Book issued to student', variant: 'success' });
    setOpenIssue(false);
    loadData();
  };

  const handleReturnBook = async (issue: IssueRow) => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const today = new Date().toISOString().slice(0, 10);
    const daysLate = Math.max(0, Math.floor((new Date(today).getTime() - new Date(issue.due_date).getTime()) / 86400000));
    const fine = daysLate * 20;
    await supabase
      .from('library_issues')
      .update({ returned_at: today, fine_pkr: fine, status: 'returned' })
      .eq('id', issue.id)
      .eq('school_id', school.id);

    const book = books.find((b) => b.id === issue.book_id);
    if (book) {
      await supabase
        .from('library_books')
        .update({ available_copies: book.available_copies + 1 })
        .eq('id', book.id)
        .eq('school_id', school.id);
    }
    toast({ title: fine > 0 ? `Book returned (Late fine: PKR ${fine})` : 'Book returned', variant: 'success' });
    loadData();
  };

  const bookMap = new Map(books.map((b) => [b.id, b.title]));
  const studentMap = new Map(students.map((s) => [s.id, `${s.name_en} (${s.admission_number})`]));

  const bookColumns: TableColumn<BookRow>[] = [
    { key: 'title', header: 'Book Title', render: (r) => <span className="font-semibold">{r.title}</span>, exportValue: (r) => r.title },
    { key: 'author', header: 'Author', render: (r) => r.author || '—', exportValue: (r) => r.author || '' },
    { key: 'cat', header: 'Category', render: (r) => r.category, exportValue: (r) => r.category },
    { key: 'rack', header: 'Rack', render: (r) => r.rack_number || '—' },
    { key: 'stock', header: 'Available / Total', align: 'right', render: (r) => <span className="font-mono-tabular">{r.available_copies} / {r.total_copies}</span> },
  ];

  const issueColumns: TableColumn<IssueRow>[] = [
    { key: 'book', header: 'Book', render: (r) => bookMap.get(r.book_id) || 'Book' },
    { key: 'stu', header: 'Student', render: (r) => studentMap.get(r.student_id) || 'Student' },
    { key: 'due', header: 'Due Date', render: (r) => <span className="font-mono-tabular">{r.due_date}</span> },
    { key: 'fine', header: 'Late Fine (PKR)', align: 'right', render: (r) => <span className="font-mono-tabular">{Number(r.fine_pkr || 0).toLocaleString()}</span> },
    { key: 'status', header: 'Status', render: (r) => r.status },
    {
      key: 'act',
      header: 'Action',
      align: 'right',
      render: (r) =>
        r.status?.toLowerCase() !== 'returned' ? (
          <button type="button" onClick={() => handleReturnBook(r)} className="rounded bg-teal-700 px-2.5 py-1 text-[11px] font-semibold text-white">
            Mark Returned
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">Returned</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Library Inventory & Books"
        rows={books}
        columns={bookColumns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.title} ${r.author || ''} ${r.category}`}
        exportFileName="library-books"
        primaryAction={
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpenBook(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white">
              <Plus className="h-3.5 w-3.5" />
              Add Book
            </button>
            <button
              type="button"
              onClick={() => {
                setIssueForm({ book_id: books[0]?.id || '', student_id: students[0]?.id || '', due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) });
                setOpenIssue(true);
              }}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-1.5 text-xs font-semibold"
            >
              Issue Book
            </button>
          </div>
        }
      />

      <DataTable
        title="Book Issues, Returns & Late Fines"
        rows={issues}
        columns={issueColumns}
        loading={loading}
        getRowKey={(r) => r.id}
        exportFileName="library-issues"
      />

      <ModalDialog open={openBook} onClose={() => setOpenBook(false)} title="Add Book to Library">
        <form onSubmit={handleAddBook} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Book Title *</label>
            <input required value={bookForm.title} onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Author</label>
              <input value={bookForm.author} onChange={(e) => setBookForm({ ...bookForm, author: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Category</label>
              <input value={bookForm.category} onChange={(e) => setBookForm({ ...bookForm, category: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Total Copies</label>
              <input type="number" min="1" value={bookForm.total_copies} onChange={(e) => setBookForm({ ...bookForm, total_copies: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Rack / Shelf Location</label>
              <input value={bookForm.rack_number} onChange={(e) => setBookForm({ ...bookForm, rack_number: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenBook(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Book</button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog open={openIssue} onClose={() => setOpenIssue(false)} title="Issue Library Book">
        <form onSubmit={handleIssueBook} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Book *</label>
            <select required value={issueForm.book_id} onChange={(e) => setIssueForm({ ...issueForm, book_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              {books.filter((b) => b.available_copies > 0).map((b) => <option key={b.id} value={b.id}>{b.title} ({b.available_copies} left)</option>)}
            </select>
          </div>
          <div>
            <label className="block font-medium">Student *</label>
            <select required value={issueForm.student_id} onChange={(e) => setIssueForm({ ...issueForm, student_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              {students.map((s) => <option key={s.id} value={s.id}>{s.name_en} ({s.admission_number})</option>)}
            </select>
          </div>
          <div>
            <label className="block font-medium">Due Return Date *</label>
            <input type="date" required value={issueForm.due_date} onChange={(e) => setIssueForm({ ...issueForm, due_date: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenIssue(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Issue Book</button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
