export function isLeaveRelatedTicketOrComplaint(row: {
  category?: string | null;
  subject?: string | null;
  description?: string | null;
}): boolean {
  const cat = String(row.category || '').trim().toLowerCase();
  const sub = String(row.subject || '').trim().toLowerCase();
  const desc = String(row.description || '').trim().toLowerCase();

  return (
    cat === 'leave' ||
    cat === 'leave request' ||
    cat.includes('leave') ||
    sub.startsWith('leave request') ||
    /^leave(\s+(request|application))?$/.test(sub) ||
    desc.startsWith('leave dates:')
  );
}

export function parseSupportTicketLeaveDetails(row: {
  subject?: string | null;
  description?: string | null;
  created_at?: string | null;
}) {
  const subject = String(row.subject || '').trim();
  const description = String(row.description || '').trim();
  const createdDate = String(row.created_at || new Date().toISOString()).slice(0, 10);

  const typeMatch = subject.match(/leave\s*request\s*\(([^)]+)\)/i);
  const rawType = typeMatch?.[1]?.trim();
  const leaveType = rawType
    ? rawType.charAt(0).toUpperCase() + rawType.slice(1)
    : 'Leave';

  const dateRangeMatch =
    description.match(
      /leave\s*dates:\s*(\d{4}-\d{2}-\d{2})(?:\s*(?:to|-|→)\s*(\d{4}-\d{2}-\d{2}))?/i
    ) || subject.match(/(\d{4}-\d{2}-\d{2})(?:\s*(?:to|-|→)\s*(\d{4}-\d{2}-\d{2}))?/i);

  const startDate = dateRangeMatch?.[1] || createdDate;
  const rawEnd = dateRangeMatch?.[2] || startDate;
  const endDate = rawEnd >= startDate ? rawEnd : startDate;

  const cleanedReason = description
    .replace(
      /^leave\s*dates:\s*\d{4}-\d{2}-\d{2}(?:\s*(?:to|-|→)\s*\d{4}-\d{2}-\d{2})?\s*/i,
      ''
    )
    .trim();

  return {
    leaveType,
    startDate,
    endDate,
    reason: cleanedReason || description || subject || '—',
  };
}
