export function computeExamGrade(obtained: number, total: number): string {
  const pct = total > 0 ? (obtained / total) * 100 : 0;
  if (pct >= 80) return 'A+';
  if (pct >= 70) return 'A';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 40) return 'D';
  if (pct >= 33) return 'E';
  return 'F';
}

export function formatOrdinalPosition(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

export interface StudentExamMarkLike {
  student_id: string;
  total_marks: number | string;
  obtained_marks: number | string;
  attendance_status?: string | null;
}

export function computeExamPositions(
  marks: StudentExamMarkLike[],
  studentClassMap?: Map<string, string | null>
): Map<string, string> {
  const totalsByStudent = new Map<string, { obtained: number; total: number }>();

  for (const m of marks) {
    const prev = totalsByStudent.get(m.student_id) ?? { obtained: 0, total: 0 };
    const max = Number(m.total_marks) || 0;
    const obt = m.attendance_status === 'absent' ? 0 : Number(m.obtained_marks) || 0;
    totalsByStudent.set(m.student_id, {
      obtained: prev.obtained + obt,
      total: prev.total + max,
    });
  }

  const buckets = new Map<string, Array<{ studentId: string; pct: number; obtained: number }>>();
  for (const [studentId, agg] of totalsByStudent.entries()) {
    const bucketKey = studentClassMap?.get(studentId) || 'ALL';
    const pct = agg.total > 0 ? (agg.obtained / agg.total) * 100 : 0;
    const list = buckets.get(bucketKey) ?? [];
    list.push({ studentId, pct, obtained: agg.obtained });
    buckets.set(bucketKey, list);
  }

  const positions = new Map<string, string>();
  for (const list of buckets.values()) {
    list.sort((a, b) => {
      if (Math.abs(b.pct - a.pct) > 0.0001) return b.pct - a.pct;
      return b.obtained - a.obtained;
    });

    let currentRank = 0;
    let prevPct = -1;
    let prevObt = -1;

    list.forEach((item, index) => {
      if (
        index === 0 ||
        Math.abs(item.pct - prevPct) > 0.0001 ||
        Math.abs(item.obtained - prevObt) > 0.0001
      ) {
        currentRank = index + 1;
        prevPct = item.pct;
        prevObt = item.obtained;
      }
      positions.set(item.studentId, formatOrdinalPosition(currentRank));
    });
  }

  return positions;
}
