import type { SupabaseClient } from '@supabase/supabase-js';
import { ensurePublicUserProfile } from '@/lib/auth/ensure-user-profile';

export interface FeeAutoSettings {
  auto_generate_monthly: boolean;
  generate_day: number;
  due_day: number;
  grace_days: number;
  late_fine_pkr: number;
  default_monthly_fee_pkr: number;
  auto_reminders: boolean;
  sync_to_student_app: boolean;
}

export const DEFAULT_FEE_AUTO_SETTINGS: FeeAutoSettings = {
  auto_generate_monthly: true,
  generate_day: 1,
  due_day: 10,
  grace_days: 5,
  late_fine_pkr: 0,
  default_monthly_fee_pkr: 0,
  auto_reminders: true,
  sync_to_student_app: true,
};

export function normalizeFeeSettings(raw: unknown): FeeAutoSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const clampDay = (val: unknown, fallback: number) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(28, Math.max(1, Math.round(n)));
  };
  const clampNum = (val: unknown, fallback: number) => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.round(n);
  };

  return {
    auto_generate_monthly:
      typeof obj.auto_generate_monthly === 'boolean'
        ? obj.auto_generate_monthly
        : DEFAULT_FEE_AUTO_SETTINGS.auto_generate_monthly,
    generate_day: clampDay(obj.generate_day, DEFAULT_FEE_AUTO_SETTINGS.generate_day),
    due_day: clampDay(obj.due_day, DEFAULT_FEE_AUTO_SETTINGS.due_day),
    grace_days: clampNum(obj.grace_days, DEFAULT_FEE_AUTO_SETTINGS.grace_days),
    late_fine_pkr: clampNum(obj.late_fine_pkr, DEFAULT_FEE_AUTO_SETTINGS.late_fine_pkr),
    default_monthly_fee_pkr: clampNum(
      obj.default_monthly_fee_pkr,
      DEFAULT_FEE_AUTO_SETTINGS.default_monthly_fee_pkr
    ),
    auto_reminders:
      typeof obj.auto_reminders === 'boolean'
        ? obj.auto_reminders
        : DEFAULT_FEE_AUTO_SETTINGS.auto_reminders,
    sync_to_student_app:
      typeof obj.sync_to_student_app === 'boolean'
        ? obj.sync_to_student_app
        : DEFAULT_FEE_AUTO_SETTINGS.sync_to_student_app,
  };
}

export async function getSchoolFeeSettings(
  db: SupabaseClient,
  schoolId: string
): Promise<FeeAutoSettings> {
  const { data } = await db
    .from('school_profiles')
    .select('fee_settings')
    .eq('school_id', schoolId)
    .maybeSingle();

  return normalizeFeeSettings(data?.fee_settings);
}

export async function syncOverdueVouchersForSchool(params: {
  db: SupabaseClient;
  schoolId: string;
  settings?: FeeAutoSettings;
}): Promise<number> {
  const { db, schoolId } = params;
  const settings = params.settings ?? (await getSchoolFeeSettings(db, schoolId));
  const todayMs = Date.now();
  const graceMs = Math.max(0, settings.grace_days) * 86400000;

  const { data: openVouchers } = await db
    .from('fee_vouchers')
    .select('id, due_date, status, fine_pkr, total_amount_pkr, paid_amount_pkr')
    .eq('school_id', schoolId)
    .in('status', ['unpaid', 'partial']);

  if (!openVouchers || openVouchers.length === 0) {
    return 0;
  }

  let updated = 0;
  const todayDateStr = new Date().toISOString().slice(0, 10);

  for (const v of openVouchers as Array<{
    id: string;
    due_date: string;
    status: string;
    fine_pkr: number;
    total_amount_pkr: number;
    paid_amount_pkr: number;
  }>) {
    if (!v.due_date) continue;
    const dueMs = new Date(`${v.due_date}T23:59:59Z`).getTime();
    if (!Number.isFinite(dueMs)) continue;

    if (todayMs > dueMs + graceMs && v.due_date < todayDateStr) {
      const existingFine = Number(v.fine_pkr || 0);
      const addFine = existingFine === 0 && settings.late_fine_pkr > 0 ? settings.late_fine_pkr : 0;
      const nextFine = existingFine + addFine;
      const nextTotal = Number(v.total_amount_pkr || 0) + addFine;

      const { error } = await db
        .from('fee_vouchers')
        .update({
          status: 'overdue',
          fine_pkr: nextFine,
          total_amount_pkr: nextTotal,
        })
        .eq('id', v.id)
        .eq('school_id', schoolId);

      if (!error) {
        updated++;
      }
    }
  }

  return updated;
}

export interface AutoGenerateResult {
  billingMonth: string;
  skippedDisabled: boolean;
  skippedBeforeDay: boolean;
  createdCount: number;
  skippedExisting: number;
  skippedZeroFee: number;
  notificationsSent: number;
  overdueUpdatedCount: number;
  settings: FeeAutoSettings;
}

export async function generateMonthlyChallansForSchool(params: {
  db: SupabaseClient;
  schoolId: string;
  billingMonth?: string;
  performedBy?: string;
  force?: boolean;
  studentIds?: string[];
}): Promise<AutoGenerateResult> {
  const { db, schoolId, performedBy, force = false, studentIds } = params;
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const billingMonth =
    params.billingMonth && /^\d{4}-\d{2}$/.test(params.billingMonth)
      ? params.billingMonth
      : currentMonth;

  const settings = await getSchoolFeeSettings(db, schoolId);
  const overdueUpdatedCount = await syncOverdueVouchersForSchool({ db, schoolId, settings });

  if (!force && !settings.auto_generate_monthly) {
    return {
      billingMonth,
      skippedDisabled: true,
      skippedBeforeDay: false,
      createdCount: 0,
      skippedExisting: 0,
      skippedZeroFee: 0,
      notificationsSent: 0,
      overdueUpdatedCount,
      settings,
    };
  }

  const todayDay = now.getUTCDate();
  if (!force && billingMonth === currentMonth && todayDay < settings.generate_day) {
    return {
      billingMonth,
      skippedDisabled: false,
      skippedBeforeDay: true,
      createdCount: 0,
      skippedExisting: 0,
      skippedZeroFee: 0,
      notificationsSent: 0,
      overdueUpdatedCount,
      settings,
    };
  }

  let studentQuery = db
    .from('students')
    .select(
      'id, admission_number, name_en, class_id, monthly_fee_pkr, discount_pkr, user_id, app_access_enabled, student_email, status'
    )
    .eq('school_id', schoolId)
    .in('status', ['active', 'Active']);

  if (studentIds && studentIds.length > 0) {
    studentQuery = studentQuery.in('id', studentIds);
  }

  const [
    { data: students, error: stuErr },
    { data: classes },
    { data: feeStructures },
    { data: feeCategories },
    { data: existingVouchers },
  ] = await Promise.all([
    studentQuery,
    db.from('classes').select('id, name, tuition_fee_pkr').eq('school_id', schoolId),
    db.from('fee_structures').select('class_id, category_id, amount_pkr').eq('school_id', schoolId),
    db.from('fee_categories').select('id, name, is_recurring').eq('school_id', schoolId),
    db
      .from('fee_vouchers')
      .select('student_id')
      .eq('school_id', schoolId)
      .eq('billing_month', billingMonth),
  ]);

  if (stuErr) {
    throw new Error(stuErr.message);
  }

  const existingStudentIds = new Set<string>(
    (existingVouchers ?? []).map((v: { student_id: string }) => v.student_id)
  );
  const classMap = new Map<string, { id: string; name: string; tuition_fee_pkr: number }>(
    ((classes ?? []) as Array<{ id: string; name: string; tuition_fee_pkr: number }>).map((c) => [
      c.id,
      c,
    ])
  );
  const categoryMap = new Map<string, { id: string; name: string; is_recurring: boolean }>(
    ((feeCategories ?? []) as Array<{ id: string; name: string; is_recurring: boolean }>).map(
      (cat) => [cat.id, cat]
    )
  );
  const structuresByClass = new Map<
    string,
    Array<{ category_id: string; amount_pkr: number }>
  >();
  for (const fsRow of (feeStructures ?? []) as Array<{
    class_id: string;
    category_id: string;
    amount_pkr: number;
  }>) {
    const arr = structuresByClass.get(fsRow.class_id) ?? [];
    arr.push({ category_id: fsRow.category_id, amount_pkr: Number(fsRow.amount_pkr || 0) });
    structuresByClass.set(fsRow.class_id, arr);
  }

  const issueDate = now.toISOString().slice(0, 10);
  const dueDayStr = String(Math.min(28, Math.max(1, settings.due_day))).padStart(2, '0');
  const dueDate = `${billingMonth}-${dueDayStr}`;
  const monthCode = billingMonth.replace('-', '');

  const voucherPayloads: Array<Record<string, unknown>> = [];
  const studentLookup = new Map<
    string,
    {
      id: string;
      admission_number: string;
      name_en: string;
      user_id: string | null;
      student_email: string | null;
      app_access_enabled: boolean;
    }
  >();

  let skippedExisting = 0;
  let skippedZeroFee = 0;

  const typedStudents = (students ?? []) as Array<{
    id: string;
    admission_number: string;
    name_en: string;
    class_id: string | null;
    monthly_fee_pkr: number;
    discount_pkr: number;
    user_id: string | null;
    student_email: string | null;
    app_access_enabled: boolean;
    status: string;
  }>;

  for (let i = 0; i < typedStudents.length; i++) {
    const stu = typedStudents[i];
    if (existingStudentIds.has(stu.id)) {
      skippedExisting++;
      continue;
    }

    const cls = stu.class_id ? classMap.get(stu.class_id) : undefined;
    const stuMonthly = Number(stu.monthly_fee_pkr || 0);
    const clsTuition = Number(cls?.tuition_fee_pkr || 0);
    const baseTuition =
      stuMonthly > 0
        ? stuMonthly
        : clsTuition > 0
          ? clsTuition
          : Number(settings.default_monthly_fee_pkr || 0);

    const lineItems: Array<{ label: string; amount: number }> = [];
    if (baseTuition > 0) {
      lineItems.push({ label: 'Monthly Tuition Fee', amount: baseTuition });
    }

    let otherCharges = 0;
    if (stu.class_id) {
      const classStructures = structuresByClass.get(stu.class_id) ?? [];
      for (const item of classStructures) {
        const cat = categoryMap.get(item.category_id);
        if (!cat || !cat.is_recurring || item.amount_pkr <= 0) continue;
        if (baseTuition > 0 && cat.name.toLowerCase().includes('tuition')) continue;
        otherCharges += item.amount_pkr;
        lineItems.push({ label: cat.name, amount: item.amount_pkr });
      }
    }

    if (baseTuition <= 0 && otherCharges <= 0) {
      skippedZeroFee++;
      continue;
    }

    const discount = Math.max(0, Number(stu.discount_pkr || 0));
    const totalAmount = Math.max(0, baseTuition + otherCharges - discount);
    const admClean = stu.admission_number.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase() || 'STU';
    const uniqueSuffix = Math.random().toString(36).slice(2, 5).toUpperCase();
    const voucherNumber = `CH-${monthCode}-${admClean}-${uniqueSuffix}`;

    studentLookup.set(stu.id, {
      id: stu.id,
      admission_number: stu.admission_number,
      name_en: stu.name_en,
      user_id: stu.user_id,
      student_email: stu.student_email ?? null,
      app_access_enabled: Boolean(stu.app_access_enabled),
    });

    voucherPayloads.push({
      school_id: schoolId,
      student_id: stu.id,
      voucher_number: voucherNumber,
      billing_month: billingMonth,
      issue_date: issueDate,
      due_date: dueDate,
      tuition_amount_pkr: baseTuition,
      other_charges_pkr: otherCharges,
      discount_pkr: discount,
      fine_pkr: 0,
      total_amount_pkr: totalAmount,
      paid_amount_pkr: 0,
      status: 'unpaid',
      line_items: lineItems,
    });
  }

  if (voucherPayloads.length === 0) {
    return {
      billingMonth,
      skippedDisabled: false,
      skippedBeforeDay: false,
      createdCount: 0,
      skippedExisting,
      skippedZeroFee,
      notificationsSent: 0,
      overdueUpdatedCount,
      settings,
    };
  }

  const { data: insertedVouchers, error: insertErr } = await db
    .from('fee_vouchers')
    .insert(voucherPayloads)
    .select('id, voucher_number, student_id, billing_month, due_date, total_amount_pkr');

  if (insertErr) {
    throw new Error(insertErr.message);
  }

  const createdRows = (insertedVouchers ?? []) as Array<{
    id: string;
    voucher_number: string;
    student_id: string;
    billing_month: string;
    due_date: string;
    total_amount_pkr: number;
  }>;

  let notificationsSent = 0;
  if (settings.sync_to_student_app && createdRows.length > 0) {
    for (const v of createdRows) {
      const stu = studentLookup.get(v.student_id);
      if (stu?.user_id) {
        await ensurePublicUserProfile(db, stu.user_id, stu.student_email, stu.name_en);
      }
    }

    const notifRows = createdRows.map((v) => {
      const stu = studentLookup.get(v.student_id);
      return {
        school_id: schoolId,
        recipient_user_id: stu?.user_id || null,
        target_audience: 'Students',
        category: 'fees',
        title: `Monthly Fee Challan (${v.billing_month}) — ${v.voucher_number}`,
        body: `${stu?.name_en || 'Student'} (${stu?.admission_number || ''}): Your fee challan of PKR ${Number(v.total_amount_pkr).toLocaleString()} is issued. Due date: ${v.due_date}.`,
        metadata: {
          type: 'monthly_fee_challan',
          voucher_id: v.id,
          voucher_number: v.voucher_number,
          student_id: v.student_id,
          admission_number: stu?.admission_number || null,
          billing_month: v.billing_month,
          total_amount_pkr: Number(v.total_amount_pkr),
          due_date: v.due_date,
          app_synced: true,
        },
        is_read: false,
      };
    });

    const { error: notifErr } = await db.from('notifications').insert(notifRows);
    if (!notifErr) {
      notificationsSent = notifRows.length;
    }
  }

  await db.from('audit_logs').insert({
    school_id: schoolId,
    user_id: performedBy || null,
    action: 'MONTHLY_CHALLANS_AUTO_GENERATED',
    table_name: 'fee_vouchers',
    new_values: {
      billingMonth,
      createdCount: createdRows.length,
      skippedExisting,
      skippedZeroFee,
      notificationsSent,
      overdueUpdatedCount,
    },
  });

  return {
    billingMonth,
    skippedDisabled: false,
    skippedBeforeDay: false,
    createdCount: createdRows.length,
    skippedExisting,
    skippedZeroFee,
    notificationsSent,
    overdueUpdatedCount,
    settings,
  };
}
