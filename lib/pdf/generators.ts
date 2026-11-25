'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';

interface SchoolBranding {
  nameEn: string;
  nameUr?: string | null;
  address?: string;
  phone?: string;
  city?: string;
}

function addDocumentHeader(doc: jsPDF, school: SchoolBranding, title: string, serial?: string) {
  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(school.nameEn || 'School Management Portal', 14, 13);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const subLine = [school.address, school.city, school.phone].filter(Boolean).join(' · ');
  if (subLine) doc.text(subLine, 14, 21);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 40);

  if (serial) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Ref: ${serial}`, doc.internal.pageSize.getWidth() - 14, 40, { align: 'right' });
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(14, 44, doc.internal.pageSize.getWidth() - 14, 44);
}

async function loadImageAsDataUrl(url: string): Promise<{ dataUrl: string; format: 'JPEG' | 'PNG' } | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const format: 'JPEG' | 'PNG' = blob.type.includes('png') ? 'PNG' : 'JPEG';
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    if (!dataUrl) return null;
    return { dataUrl, format };
  } catch {
    return null;
  }
}

export async function generateStudentIdCardPdf(
  school: SchoolBranding,
  student: {
    name_en: string;
    admission_no: string;
    roll_no?: string | null;
    student_id?: string | null;
    className?: string;
    sectionName?: string;
    b_form?: string | null;
    emergency_contact?: string | null;
    qr_token?: string | null;
    photo_url?: string | null;
  }
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [86, 54] });

  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, 86, 13, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text(school.nameEn.slice(0, 34), 4, 6.5);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.text('STUDENT IDENTITY CARD', 4, 10.5);

  const loadedPhoto = student.photo_url ? await loadImageAsDataUrl(student.photo_url) : null;
  let textX = 4;
  if (loadedPhoto) {
    doc.addImage(loadedPhoto.dataUrl, loadedPhoto.format, 4, 16, 15, 18);
    textX = 21.5;
  }

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(student.name_en.slice(0, loadedPhoto ? 22 : 30), textX, 20);

  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Adm: ${student.admission_no}${student.student_id ? ` · ID: ${student.student_id}` : ''}`,
    textX,
    25
  );
  doc.text(`Class: ${student.className || 'N/A'} ${student.sectionName ? `(${student.sectionName})` : ''}`, textX, 29.5);
  doc.text(`Roll No: ${student.roll_no || '—'}`, textX, 34);
  doc.text(`B-Form: ${student.b_form || '—'}`, textX, 38.5);
  doc.text(`Emergency: ${student.emergency_contact || '—'}`, textX, 43);

  const qrPayload = student.qr_token || student.student_id || student.admission_no;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 120 });
  doc.addImage(qrDataUrl, 'PNG', 63, 16, 19, 19);

  doc.setFontSize(5);
  doc.setTextColor(71, 85, 105);
  doc.text((student.student_id || qrPayload).slice(0, 18), 72.5, 38.5, { align: 'center' });

  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Scan at School Gate for IN/OUT Attendance', 43, 50, { align: 'center' });

  doc.save(`ID-Card-${student.admission_no}.pdf`);
}

export function generateAdmissionLetterPdf(
  school: SchoolBranding,
  student: {
    name_en: string;
    admission_no: string;
    admission_date: string;
    className?: string;
    sectionName?: string;
    b_form?: string | null;
    gender?: string;
    address?: string | null;
  }
) {
  const doc = new jsPDF();
  addDocumentHeader(doc, school, 'OFFICIAL ADMISSION LETTER', student.admission_no);

  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.text(`Date: ${student.admission_date}`, 14, 54);
  doc.text(
    `This is to certify that ${student.name_en} has been formally admitted to ${school.nameEn}.`,
    14,
    64,
    { maxWidth: 180 }
  );

  autoTable(doc, {
    startY: 74,
    head: [['Field', 'Particulars']],
    body: [
      ['Student Name', student.name_en],
      ['Admission Number', student.admission_no],
      ['Assigned Class & Section', `${student.className || '—'} ${student.sectionName ? `(${student.sectionName})` : ''}`],
      ['B-Form / CRC Number', student.b_form || '—'],
      ['Gender', student.gender || '—'],
      ['Admission Date', student.admission_date],
      ['Residential Address', student.address || '—'],
    ],
    theme: 'grid',
    headStyles: { fillColor: [15, 118, 110] },
  });

  doc.setFontSize(9.5);
  doc.text('Principal / Authorized Signatory', 14, 175);
  doc.line(14, 170, 72, 170);

  doc.save(`Admission-Letter-${student.admission_no}.pdf`);
}

export function generateFeeVoucherPdf(
  school: SchoolBranding,
  voucher: {
    voucher_no: string;
    studentName: string;
    admissionNo: string;
    className?: string;
    billing_month: string;
    due_date: string;
    gross_amount: number;
    discount_amount: number;
    fine_amount: number;
    net_amount: number;
    paid_amount: number;
    status: string;
  }
) {
  const doc = new jsPDF();
  addDocumentHeader(doc, school, 'MONTHLY FEE CHALLAN / VOUCHER', voucher.voucher_no);

  autoTable(doc, {
    startY: 52,
    head: [['Student Particulars', 'Details']],
    body: [
      ['Student Name', voucher.studentName],
      ['Admission No', voucher.admissionNo],
      ['Class', voucher.className || '—'],
      ['Billing Month', voucher.billing_month],
      ['Due Date', voucher.due_date],
      ['Status', voucher.status],
    ],
    theme: 'striped',
    headStyles: { fillColor: [15, 118, 110] },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 110;

  autoTable(doc, {
    startY: finalY + 8,
    head: [['Fee Breakdown', 'Amount (PKR)']],
    body: [
      ['Gross Fee', `PKR ${Number(voucher.gross_amount).toLocaleString()}`],
      ['Discount / Concession', `- PKR ${Number(voucher.discount_amount).toLocaleString()}`],
      ['Late Fine', `PKR ${Number(voucher.fine_amount).toLocaleString()}`],
      ['Net Payable', `PKR ${Number(voucher.net_amount).toLocaleString()}`],
      ['Paid Amount', `PKR ${Number(voucher.paid_amount).toLocaleString()}`],
      ['Balance Due', `PKR ${Math.max(0, Number(voucher.net_amount) - Number(voucher.paid_amount)).toLocaleString()}`],
    ],
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42] },
  });

  doc.save(`Fee-Voucher-${voucher.voucher_no}.pdf`);
}

export function generateFeeReceiptPdf(
  school: SchoolBranding,
  receipt: {
    receipt_no: string;
    studentName: string;
    admissionNo: string;
    voucherNo: string;
    amount_paid: number;
    payment_method: string;
    transaction_ref?: string | null;
    paid_at: string;
  }
) {
  const doc = new jsPDF();
  addDocumentHeader(doc, school, 'OFFICIAL FEE PAYMENT RECEIPT', receipt.receipt_no);

  autoTable(doc, {
    startY: 52,
    head: [['Receipt Information', 'Value']],
    body: [
      ['Receipt Number', receipt.receipt_no],
      ['Voucher Reference', receipt.voucherNo],
      ['Student Name', receipt.studentName],
      ['Admission No', receipt.admissionNo],
      ['Amount Paid', `PKR ${Number(receipt.amount_paid).toLocaleString()}`],
      ['Payment Method', receipt.payment_method],
      ['Transaction Reference', receipt.transaction_ref || 'Cash / Counter'],
      ['Payment Date', new Date(receipt.paid_at).toLocaleString()],
    ],
    theme: 'grid',
    headStyles: { fillColor: [15, 118, 110] },
  });

  doc.save(`Fee-Receipt-${receipt.receipt_no}.pdf`);
}

export function generateSalarySlipPdf(
  school: SchoolBranding,
  slip: {
    employeeName: string;
    employeeCode: string;
    designation: string;
    payroll_month: string;
    base_salary: number;
    allowances: number;
    bonuses: number;
    deductions: number;
    advance_salary: number;
    absent_days?: number;
    present_days?: number;
    late_days?: number;
    leave_days?: number;
    attendance_deduction: number;
    net_salary: number;
    status: string;
    payment_method?: string | null;
  }
) {
  const doc = new jsPDF();
  addDocumentHeader(doc, school, 'STAFF SALARY SLIP', `${slip.employeeCode}-${slip.payroll_month}`);

  const attendanceSummary =
    slip.present_days !== undefined || slip.absent_days !== undefined
      ? `Present: ${slip.present_days ?? 0} · Absent: ${slip.absent_days ?? 0} · Late: ${slip.late_days ?? 0} · Leave: ${slip.leave_days ?? 0}`
      : 'Attendance Synced';

  autoTable(doc, {
    startY: 52,
    head: [['Employee Details', 'Value']],
    body: [
      ['Staff Name', slip.employeeName],
      ['Employee Code', slip.employeeCode],
      ['Designation', slip.designation],
      ['Payroll Month', slip.payroll_month],
      ['Monthly Attendance', attendanceSummary],
      ['Payment Status', `${slip.status}${slip.payment_method ? ` (${slip.payment_method})` : ''}`],
    ],
    theme: 'striped',
    headStyles: { fillColor: [15, 118, 110] },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 108;
  autoTable(doc, {
    startY: finalY + 8,
    head: [['Earnings / Deductions', 'Amount (PKR)']],
    body: [
      ['Base Monthly Salary', `PKR ${Number(slip.base_salary).toLocaleString()}`],
      ['Allowances', `+ PKR ${Number(slip.allowances).toLocaleString()}`],
      ['Bonuses', `+ PKR ${Number(slip.bonuses).toLocaleString()}`],
      ['Standard Deductions', `- PKR ${Number(slip.deductions).toLocaleString()}`],
      ['Advance Salary Adjustment', `- PKR ${Number(slip.advance_salary).toLocaleString()}`],
      [
        `Attendance Deduction (${slip.absent_days ?? 0} Absent Day${(slip.absent_days ?? 0) === 1 ? '' : 's'})`,
        `- PKR ${Number(slip.attendance_deduction).toLocaleString()}`,
      ],
      ['Net Payable Salary', `PKR ${Number(slip.net_salary).toLocaleString()}`],
    ],
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42] },
  });

  doc.save(`Salary-Slip-${slip.employeeCode}-${slip.payroll_month}.pdf`);
}

export function generateReportCardPdf(
  school: SchoolBranding,
  report: {
    examName: string;
    studentName: string;
    admissionNo: string;
    className: string;
    position?: string;
    subjects: Array<{
      subjectName: string;
      totalMarks: number;
      obtainedMarks: number;
      grade: string;
      remarks?: string | null;
    }>;
  }
) {
  const doc = new jsPDF();
  addDocumentHeader(doc, school, `EXAMINATION REPORT CARD — ${report.examName}`, report.admissionNo);

  const totalMax = report.subjects.reduce((acc, s) => acc + s.totalMarks, 0);
  const totalObt = report.subjects.reduce((acc, s) => acc + s.obtainedMarks, 0);
  const pct = totalMax > 0 ? ((totalObt / totalMax) * 100).toFixed(2) : '0.00';

  autoTable(doc, {
    startY: 50,
    head: [['Student', 'Admission No', 'Class', 'Position', 'Overall %']],
    body: [[report.studentName, report.admissionNo, report.className, report.position || '—', `${pct}%`]],
    theme: 'plain',
    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 72;
  autoTable(doc, {
    startY: finalY + 6,
    head: [['Subject', 'Total Marks', 'Obtained Marks', 'Grade', 'Remarks']],
    body: report.subjects.map((s) => [
      s.subjectName,
      String(s.totalMarks),
      String(s.obtainedMarks),
      s.grade,
      s.remarks || '—',
    ]),
    foot: [['Total', String(totalMax), String(totalObt), `${pct}%`, '']],
    theme: 'grid',
    headStyles: { fillColor: [15, 118, 110] },
    footStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
  });

  doc.save(`Report-Card-${report.admissionNo}-${report.examName}.pdf`);
}

export function generateCertificatePdf(
  school: SchoolBranding,
  cert: {
    certificateType: 'School Leaving' | 'Character' | 'Bonafide' | 'Admission Letter';
    serialNo: string;
    studentName: string;
    fatherName?: string;
    admissionNo: string;
    className: string;
    issuedDate: string;
    remarks?: string | null;
  }
) {
  const doc = new jsPDF();
  addDocumentHeader(doc, school, `${cert.certificateType.toUpperCase()} CERTIFICATE`, cert.serialNo);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.text(`Date of Issue: ${cert.issuedDate}`, 14, 56);

  let bodyText = '';
  if (cert.certificateType === 'School Leaving') {
    bodyText = `This is to certify that ${cert.studentName}${cert.fatherName ? ` S/O or D/O ${cert.fatherName}` : ''}, bearing Admission No. ${cert.admissionNo}, was a bonafide student of Class ${cert.className} at ${school.nameEn}. All school dues have been cleared and the student is leaving the institution with a satisfactory conduct record.`;
  } else if (cert.certificateType === 'Character') {
    bodyText = `This is to certify that ${cert.studentName}${cert.fatherName ? ` S/O or D/O ${cert.fatherName}` : ''} (Admission No. ${cert.admissionNo}, Class ${cert.className}) bears a good moral character and demonstrated disciplined conduct during their stay at ${school.nameEn}.`;
  } else {
    bodyText = `This is to certify that ${cert.studentName}${cert.fatherName ? ` S/O or D/O ${cert.fatherName}` : ''} (Admission No. ${cert.admissionNo}) is a bonafide regular student currently enrolled in Class ${cert.className} at ${school.nameEn}.`;
  }

  doc.text(bodyText, 14, 72, { maxWidth: 180, lineHeightFactor: 1.6 });
  if (cert.remarks) {
    doc.text(`Remarks: ${cert.remarks}`, 14, 118, { maxWidth: 180 });
  }

  doc.line(14, 165, 70, 165);
  doc.text('Prepared By', 14, 171);

  doc.line(135, 165, 195, 165);
  doc.text('Principal Signature & Stamp', 135, 171);

  doc.save(`${cert.certificateType.replace(/\s+/g, '-')}-${cert.serialNo}.pdf`);
}

export interface PrintablePaperQuestion {
  id: string;
  type: 'mcq' | 'short' | 'long' | 'fill_blank' | 'true_false';
  prompt: string;
  marks: number;
  options?: string[];
  correctAnswer?: string;
}

export interface PrintablePaperSection {
  id: string;
  title: string;
  instructions?: string;
  questions: PrintablePaperQuestion[];
}

export function generateQuestionPaperPdf(
  school: SchoolBranding,
  paper: {
    title: string;
    paper_code?: string | null;
    paper_type?: string;
    className?: string;
    sectionName?: string;
    subjectName?: string;
    examDate?: string | null;
    timeAllowed: string;
    totalMarks: number;
    passingMarks?: number;
    academicSession?: string | null;
    instructions?: string | null;
    showStudentInfoBox?: boolean;
    showAnswerLines?: boolean;
    sections: PrintablePaperSection[];
  },
  options?: { includeAnswerKey?: boolean }
) {
  const isKey = Boolean(options?.includeAnswerKey);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;

  const ensureSpace = (neededMm: number, currentY: number) => {
    if (currentY + neededMm > pageHeight - 16) {
      doc.addPage();
      return 16;
    }
    return currentY;
  };

  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(school.nameEn || 'School Examination Board', pageWidth / 2, 10, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const sub = [school.address, school.city, school.phone].filter(Boolean).join(' · ');
  if (sub) {
    doc.text(sub.slice(0, 95), pageWidth / 2, 17, { align: 'center' });
  }

  let y = 32;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const heading = isKey ? `${paper.title} — ANSWER KEY & MARKING SCHEME` : paper.title;
  doc.text(heading, pageWidth / 2, y, { align: 'center' });
  y += 6;

  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(marginX, y, contentWidth, 16, 1.5, 1.5, 'FD');

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(
    `Class: ${paper.className || 'All'}${paper.sectionName ? ` (${paper.sectionName})` : ''}`,
    marginX + 3,
    y + 5.5
  );
  doc.text(`Subject: ${paper.subjectName || 'General'}`, pageWidth / 2, y + 5.5, { align: 'center' });
  doc.text(`Total Marks: ${paper.totalMarks}`, pageWidth - marginX - 3, y + 5.5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.text(
    `Type: ${paper.paper_type || 'Exam'}${paper.paper_code ? ` · Code: ${paper.paper_code}` : ''}`,
    marginX + 3,
    y + 12
  );
  doc.text(`Time Allowed: ${paper.timeAllowed || '—'}`, pageWidth / 2, y + 12, { align: 'center' });
  doc.text(`Date: ${paper.examDate || '____________'}`, pageWidth - marginX - 3, y + 12, { align: 'right' });
  y += 20;

  if (!isKey && paper.showStudentInfoBox !== false) {
    doc.setDrawColor(148, 163, 184);
    doc.rect(marginX, y, contentWidth, 10);
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text('Student Name: ________________________________', marginX + 3, y + 6.5);
    doc.text('Roll No: ______________', marginX + 102, y + 6.5);
    doc.text('Invigilator Sign: __________', pageWidth - marginX - 3, y + 6.5, { align: 'right' });
    y += 14;
  }

  if (!isKey && paper.instructions?.trim()) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(71, 85, 105);
    const instrLines = doc.splitTextToSize(`Instructions: ${paper.instructions.trim()}`, contentWidth);
    doc.text(instrLines, marginX, y);
    y += instrLines.length * 4.2 + 3;
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 6;

  let globalQNum = 1;

  for (const sec of paper.sections) {
    const secTotal = sec.questions.reduce((acc, q) => acc + (Number(q.marks) || 0), 0);
    y = ensureSpace(16, y);

    doc.setFillColor(241, 245, 249);
    doc.rect(marginX, y - 4, contentWidth, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 118, 110);
    doc.text(sec.title, marginX + 2.5, y + 1.2);
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8.5);
    doc.text(`[${secTotal} Marks]`, pageWidth - marginX - 2.5, y + 1.2, { align: 'right' });
    y += 7;

    if (sec.instructions?.trim()) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      const secNote = doc.splitTextToSize(sec.instructions.trim(), contentWidth - 4);
      doc.text(secNote, marginX + 2, y);
      y += secNote.length * 4 + 2;
    }

    for (const q of sec.questions) {
      const qLabel = `Q${globalQNum++}. `;
      const marksLabel = `[${q.marks} ${Number(q.marks) === 1 ? 'Mark' : 'Marks'}]`;
      const promptLines = doc.splitTextToSize(`${qLabel}${q.prompt}`, contentWidth - 24);
      const approxHeight =
        promptLines.length * 4.5 +
        (q.type === 'mcq' ? 12 : 0) +
        (isKey ? 7 : 0) +
        (!isKey && paper.showAnswerLines && (q.type === 'short' || q.type === 'long')
          ? q.type === 'long'
            ? 24
            : 12
          : 0) +
        4;

      y = ensureSpace(Math.min(approxHeight, 55), y);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(promptLines, marginX + 1, y);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(marksLabel, pageWidth - marginX - 1, y, { align: 'right' });

      y += promptLines.length * 4.6 + 1;

      if (q.type === 'mcq' && Array.isArray(q.options) && q.options.length > 0) {
        const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
        const formatted = q.options
          .map((opt, idx) => `(${optionLetters[idx] || idx + 1}) ${opt || '—'}`)
          .filter(Boolean);

        const maxOptLen = Math.max(...formatted.map((s) => s.length));
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(30, 41, 59);

        if (maxOptLen <= 34 && formatted.length <= 4) {
          for (let i = 0; i < formatted.length; i += 2) {
            y = ensureSpace(6, y);
            doc.text(formatted[i], marginX + 6, y);
            if (formatted[i + 1]) {
              doc.text(formatted[i + 1], marginX + contentWidth / 2 + 2, y);
            }
            y += 5;
          }
        } else {
          for (const optText of formatted) {
            const optLines = doc.splitTextToSize(optText, contentWidth - 10);
            y = ensureSpace(optLines.length * 4.5 + 1, y);
            doc.text(optLines, marginX + 6, y);
            y += optLines.length * 4.5;
          }
        }
      } else if (q.type === 'true_false' && !isKey) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(71, 85, 105);
        doc.text('[   ] True      [   ] False', marginX + 6, y);
        y += 5.5;
      }

      if (isKey && q.correctAnswer?.trim()) {
        y = ensureSpace(7, y);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(15, 118, 110);
        const ansLines = doc.splitTextToSize(
          `Answer / Key: ${q.correctAnswer.trim()}`,
          contentWidth - 8
        );
        doc.text(ansLines, marginX + 6, y);
        y += ansLines.length * 4.3 + 1;
      } else if (!isKey && paper.showAnswerLines && (q.type === 'short' || q.type === 'long')) {
        const lineCount = q.type === 'long' ? 4 : 2;
        doc.setDrawColor(203, 213, 225);
        for (let l = 0; l < lineCount; l++) {
          y = ensureSpace(6, y);
          doc.line(marginX + 6, y + 3, pageWidth - marginX - 2, y + 3);
          y += 5.5;
        }
      }

      y += 2.5;
    }

    y += 3;
  }

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`${paper.title} · ${school.nameEn}`, marginX, pageHeight - 8);
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 8, {
      align: 'right',
    });
  }

  const safeSlug = paper.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 45) || 'Question-Paper';
  doc.save(`${safeSlug}${isKey ? '-Answer-Key' : ''}.pdf`);
}

export function generateClassResultSheetPdf(
  school: SchoolBranding,
  sheet: {
    examTitle: string;
    className: string;
    rows: Array<{
      position: string;
      admissionNo: string;
      studentName: string;
      subjectsSummary: string;
      totalMarks: number;
      obtainedMarks: number;
      percentage: number;
      grade: string;
      status: 'Pass' | 'Fail';
    }>;
  }
) {
  const doc = new jsPDF({ orientation: 'landscape' });
  addDocumentHeader(
    doc,
    school,
    `EXAMINATION RESULT SHEET — ${sheet.examTitle}`,
    sheet.className
  );

  autoTable(doc, {
    startY: 50,
    head: [['Pos', 'Adm No', 'Student Name', 'Subject Breakdown', 'Total', 'Obtained', '%', 'Grade', 'Result']],
    body: sheet.rows.map((r) => [
      r.position,
      r.admissionNo,
      r.studentName,
      r.subjectsSummary,
      String(r.totalMarks),
      String(r.obtainedMarks),
      `${r.percentage.toFixed(1)}%`,
      r.grade,
      r.status,
    ]),
    theme: 'grid',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [15, 118, 110] },
  });

  const safeExam = sheet.examTitle.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'Exam';
  doc.save(`Result-Sheet-${safeExam}.pdf`);
}
