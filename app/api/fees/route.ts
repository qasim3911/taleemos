import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { ensurePublicUserProfile } from '@/lib/auth/ensure-user-profile';
import {
  generateMonthlyChallansForSchool,
  getSchoolFeeSettings,
} from '@/lib/fees/auto-challan';

const FeeActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_voucher'),
    student_id: z.string().uuid(),
    billing_month: z.string().regex(/^\d{4}-\d{2}$/),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fee_category: z.string().trim().min(2).max(80).default('Monthly Tuition Fee'),
    custom_category: z.string().trim().max(100).optional().nullable(),
    tuition_amount_pkr: z.coerce.number().min(0).max(5000000),
    other_charges_pkr: z.coerce.number().min(0).max(5000000).default(0),
    discount_pkr: z.coerce.number().min(0).max(5000000).default(0),
    fine_pkr: z.coerce.number().min(0).max(5000000).default(0),
  }),
  z.object({
    action: z.literal('record_payment'),
    voucher_id: z.string().uuid(),
    amount_paid: z.coerce.number().positive().max(5000000),
    payment_method: z.enum(['Cash', 'Bank', 'JazzCash', 'Easypaisa']).default('Cash'),
    transaction_ref: z.string().max(120).optional().nullable(),
  }),
  z.object({
    action: z.literal('mark_unpaid'),
    voucher_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal('send_reminder'),
    voucher_id: z.string().uuid().optional(),
    target: z.enum(['single', 'all_unpaid']).default('single'),
  }),
  z.object({
    action: z.literal('update_fee_rates'),
    target_type: z.enum(['class', 'student']),
    target_id: z.string().uuid(),
    monthly_fee_pkr: z.coerce.number().min(0).max(5000000),
    discount_pkr: z.coerce.number().min(0).max(5000000).optional(),
  }),
]);

export async function GET() {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'fees')) {
    return NextResponse.json({ error: 'Insufficient permissions for Fees module.' }, { status: 403 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

  let autoResult = null;
  try {
    autoResult = await generateMonthlyChallansForSchool({
      db,
      schoolId: context.school.id,
      performedBy: context.userId,
      force: false,
    });
  } catch {
    autoResult = null;
  }

  const [
    { data: vouchers, error: vErr },
    { data: payments, error: pErr },
    { data: students, error: sErr },
    { data: classes },
    settings,
  ] = await Promise.all([
    db
      .from('fee_vouchers')
      .select('*')
      .eq('school_id', context.school.id)
      .order('billing_month', { ascending: false })
      .order('created_at', { ascending: false }),
    db
      .from('fee_payments')
      .select('*')
      .eq('school_id', context.school.id)
      .order('paid_at', { ascending: false })
      .limit(400),
    db
      .from('students')
      .select(
        'id, admission_number, name_en, class_id, user_id, app_access_enabled, app_blocked, student_email, monthly_fee_pkr, discount_pkr, status'
      )
      .eq('school_id', context.school.id)
      .in('status', ['active', 'Active'])
      .order('admission_number'),
    db
      .from('classes')
      .select('id, name, level_order, tuition_fee_pkr')
      .eq('school_id', context.school.id)
      .order('level_order'),
    getSchoolFeeSettings(db, context.school.id),
  ]);

  if (vErr || pErr || sErr) {
    return NextResponse.json(
      { error: vErr?.message || pErr?.message || sErr?.message || 'Unable to load fees.' },
      { status: 400 }
    );
  }

  return NextResponse.json({
    vouchers: vouchers ?? [],
    payments: payments ?? [],
    students: students ?? [],
    classes: classes ?? [],
    settings,
    autoSummary: autoResult
      ? {
          createdCount: autoResult.createdCount,
          notificationsSent: autoResult.notificationsSent,
          overdueUpdatedCount: autoResult.overdueUpdatedCount,
          billingMonth: autoResult.billingMonth,
        }
      : null,
  });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'fees')) {
    return NextResponse.json({ error: 'Insufficient permissions for Fees module.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = FeeActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid fee request payload.' }, { status: 400 });
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
    const settings = await getSchoolFeeSettings(db, context.school.id);

    if (parsed.data.action === 'create_voucher') {
      const { data: stu, error: stuErr } = await db
        .from('students')
        .select('id, admission_number, name_en, user_id, student_email')
        .eq('id', parsed.data.student_id)
        .eq('school_id', context.school.id)
        .maybeSingle();

      if (stuErr || !stu) {
        return NextResponse.json({ error: 'Student not found in your school.' }, { status: 404 });
      }

      const categoryLabel =
        parsed.data.fee_category === 'Custom Fund / Item' && parsed.data.custom_category?.trim()
          ? parsed.data.custom_category.trim()
          : parsed.data.fee_category;

      const tuition = Number(parsed.data.tuition_amount_pkr || 0);
      const otherCharges = Number(parsed.data.other_charges_pkr || 0);
      const discount = Number(parsed.data.discount_pkr || 0);
      const fine = Number(parsed.data.fine_pkr || 0);
      const total = Math.max(0, tuition + otherCharges - discount + fine);
      const voucherNo = `CH-${parsed.data.billing_month.replace('-', '')}-${Date.now().toString().slice(-5)}`;
      const today = new Date().toISOString().slice(0, 10);

      const lineItems: Array<{ label: string; amount: number }> = [
        { label: categoryLabel, amount: tuition + otherCharges },
      ];

      const isMonthlyTuition = parsed.data.fee_category === 'Monthly Tuition Fee';

      if (isMonthlyTuition) {
        const { data: existingMonthly } = await db
          .from('fee_vouchers')
          .select('id, voucher_number, billing_month')
          .eq('school_id', context.school.id)
          .eq('student_id', stu.id)
          .eq('billing_month', parsed.data.billing_month)
          .maybeSingle();

        if (existingMonthly) {
          return NextResponse.json(
            {
              error: `Monthly Tuition Fee for ${parsed.data.billing_month} has already been issued for this student (Voucher: ${existingMonthly.voucher_number}). You can issue other funds (Paper Funds, Uniform, etc.) freely.`,
            },
            { status: 409 }
          );
        }
      }

      const uniqueBillingMonth = isMonthlyTuition
        ? parsed.data.billing_month
        : `${parsed.data.billing_month}-${categoryLabel.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)}-${Date.now().toString().slice(-4)}`;

      const { data: createdVoucher, error: createErr } = await db
        .from('fee_vouchers')
        .insert({
          school_id: context.school.id,
          student_id: stu.id,
          voucher_number: voucherNo,
          billing_month: uniqueBillingMonth,
          issue_date: today,
          due_date: parsed.data.due_date,
          tuition_amount_pkr: tuition + otherCharges,
          other_charges_pkr: 0,
          discount_pkr: discount,
          fine_pkr: fine,
          total_amount_pkr: total,
          paid_amount_pkr: 0,
          status: 'unpaid',
          line_items: lineItems,
        })
        .select('*')
        .single();

      if (createErr || !createdVoucher) {
        return NextResponse.json(
          { error: createErr?.message || 'Unable to create fee voucher.' },
          { status: 400 }
        );
      }

      if (settings.sync_to_student_app) {
        if (stu.user_id) {
          await ensurePublicUserProfile(db, stu.user_id, stu.student_email, stu.name_en);
        }
        await db.from('notifications').insert({
          school_id: context.school.id,
          recipient_user_id: stu.user_id || null,
          target_audience: 'Students',
          category: 'fees',
          title: `${categoryLabel} (${parsed.data.billing_month}) — ${voucherNo}`,
          body: `${stu.name_en} (${stu.admission_number}): ${categoryLabel} challan of PKR ${total.toLocaleString()} issued. Due date: ${parsed.data.due_date}.`,
          metadata: {
            type: 'monthly_fee_challan',
            voucher_id: createdVoucher.id,
            voucher_number: voucherNo,
            student_id: stu.id,
            billing_month: parsed.data.billing_month,
            total_amount_pkr: total,
            due_date: parsed.data.due_date,
            app_synced: true,
          },
          is_read: false,
        });
      }

      return NextResponse.json({ success: true, voucher: createdVoucher });
    }

    if (parsed.data.action === 'record_payment') {
      const { data: voucher, error: vLookupErr } = await db
        .from('fee_vouchers')
        .select('*')
        .eq('id', parsed.data.voucher_id)
        .eq('school_id', context.school.id)
        .maybeSingle();

      if (vLookupErr || !voucher) {
        return NextResponse.json({ error: 'Fee voucher not found.' }, { status: 404 });
      }

      await ensurePublicUserProfile(db, context.userId, context.userEmail, context.member.full_name);

      const receiptNo = `RCP-${Date.now().toString().slice(-6)}`;
      const amount = Number(parsed.data.amount_paid);

      const { data: paymentRow, error: payErr } = await db
        .from('fee_payments')
        .insert({
          school_id: context.school.id,
          voucher_id: voucher.id,
          student_id: voucher.student_id,
          receipt_no: receiptNo,
          amount_paid: amount,
          payment_method: parsed.data.payment_method,
          transaction_ref: parsed.data.transaction_ref?.trim() || null,
          is_verified: true,
          received_by: context.userId,
        })
        .select('*')
        .single();

      if (payErr || !paymentRow) {
        return NextResponse.json(
          { error: payErr?.message || 'Unable to record payment.' },
          { status: 400 }
        );
      }

      const newPaid = Number(voucher.paid_amount_pkr || 0) + amount;
      const newStatus = newPaid >= Number(voucher.total_amount_pkr || 0) ? 'paid' : 'partial';

      const { data: updatedVoucher, error: updErr } = await db
        .from('fee_vouchers')
        .update({
          paid_amount_pkr: newPaid,
          status: newStatus,
        })
        .eq('id', voucher.id)
        .eq('school_id', context.school.id)
        .select('*')
        .single();

      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 400 });
      }

      const { data: stu } = await db
        .from('students')
        .select('id, name_en, admission_number, user_id, student_email')
        .eq('id', voucher.student_id)
        .maybeSingle();

      if (settings.sync_to_student_app && stu) {
        if (stu.user_id) {
          await ensurePublicUserProfile(db, stu.user_id, stu.student_email, stu.name_en);
        }
        await db.from('notifications').insert({
          school_id: context.school.id,
          recipient_user_id: stu.user_id || null,
          target_audience: 'Students',
          category: 'fees',
          title: `Fee ${newStatus === 'paid' ? 'Paid' : 'Partial Payment'} — ${voucher.voucher_number}`,
          body: `Payment of PKR ${amount.toLocaleString()} (${parsed.data.payment_method}) received for ${stu.name_en}. Receipt: ${receiptNo}.`,
          metadata: {
            type: 'fee_payment_receipt',
            voucher_id: voucher.id,
            voucher_number: voucher.voucher_number,
            receipt_no: receiptNo,
            student_id: stu.id,
            status: newStatus,
            amount_paid: amount,
          },
          is_read: false,
        });
      }

      await db.from('audit_logs').insert({
        school_id: context.school.id,
        user_id: context.userId,
        action: 'FEE_PAYMENT_RECORDED',
        table_name: 'fee_payments',
        record_id: paymentRow.id,
        new_values: {
          voucher_number: voucher.voucher_number,
          receipt_no: receiptNo,
          amount_paid: amount,
          payment_method: parsed.data.payment_method,
          new_status: newStatus,
        },
      });

      return NextResponse.json({
        success: true,
        payment: paymentRow,
        voucher: updatedVoucher,
      });
    }

    if (parsed.data.action === 'mark_unpaid') {
      const { data: voucher, error: vLookupErr } = await db
        .from('fee_vouchers')
        .select('*')
        .eq('id', parsed.data.voucher_id)
        .eq('school_id', context.school.id)
        .maybeSingle();

      if (vLookupErr || !voucher) {
        return NextResponse.json({ error: 'Fee voucher not found.' }, { status: 404 });
      }

      await db
        .from('fee_payments')
        .delete()
        .eq('voucher_id', voucher.id)
        .eq('school_id', context.school.id);

      const todayStr = new Date().toISOString().slice(0, 10);
      const graceMs = Math.max(0, settings.grace_days) * 86400000;
      const dueMs = voucher.due_date ? new Date(`${voucher.due_date}T23:59:59Z`).getTime() : NaN;
      const resetStatus =
        Number.isFinite(dueMs) && Date.now() > dueMs + graceMs && voucher.due_date < todayStr
          ? 'overdue'
          : 'unpaid';

      const { data: updatedVoucher, error: resetErr } = await db
        .from('fee_vouchers')
        .update({
          paid_amount_pkr: 0,
          status: resetStatus,
        })
        .eq('id', voucher.id)
        .eq('school_id', context.school.id)
        .select('*')
        .single();

      if (resetErr) {
        return NextResponse.json({ error: resetErr.message }, { status: 400 });
      }

      await db.from('audit_logs').insert({
        school_id: context.school.id,
        user_id: context.userId,
        action: 'FEE_VOUCHER_RESET_UNPAID',
        table_name: 'fee_vouchers',
        record_id: voucher.id,
        new_values: { voucher_number: voucher.voucher_number, status: resetStatus },
      });

      return NextResponse.json({ success: true, voucher: updatedVoucher });
    }

    if (parsed.data.action === 'send_reminder') {
      let targetVouchersQuery = db
        .from('fee_vouchers')
        .select('id, voucher_number, student_id, billing_month, due_date, total_amount_pkr, paid_amount_pkr, status')
        .eq('school_id', context.school.id)
        .in('status', ['unpaid', 'partial', 'overdue']);

      if (parsed.data.target === 'single' && parsed.data.voucher_id) {
        targetVouchersQuery = targetVouchersQuery.eq('id', parsed.data.voucher_id);
      }

      const { data: targetVouchers } = await targetVouchersQuery;
      if (!targetVouchers || targetVouchers.length === 0) {
        return NextResponse.json({ success: true, remindersSent: 0 });
      }

      const studentIds = Array.from(new Set(targetVouchers.map((v) => v.student_id)));
      const { data: stuRows } = await db
        .from('students')
        .select('id, name_en, admission_number, user_id, student_email')
        .in('id', studentIds);

      const stuMap = new Map(
        (stuRows ?? []).map((s) => [s.id, s])
      );

      for (const stu of stuRows ?? []) {
        if (stu.user_id) {
          await ensurePublicUserProfile(db, stu.user_id, stu.student_email, stu.name_en);
        }
      }

      const notifPayloads = targetVouchers.map((v) => {
        const stu = stuMap.get(v.student_id);
        const balance = Math.max(0, Number(v.total_amount_pkr) - Number(v.paid_amount_pkr));
        return {
          school_id: context.school.id,
          recipient_user_id: stu?.user_id || null,
          target_audience: 'Students',
          category: 'fees',
          title: `Fee Reminder (${v.billing_month}) — ${v.voucher_number}`,
          body: `${stu?.name_en || 'Student'}: PKR ${balance.toLocaleString()} is ${v.status.toUpperCase()} for ${v.billing_month} (Due: ${v.due_date}).`,
          metadata: {
            type: 'fee_reminder',
            voucher_id: v.id,
            voucher_number: v.voucher_number,
            student_id: v.student_id,
            balance_pkr: balance,
          },
          is_read: false,
        };
      });

      const { error: notifErr } = await db.from('notifications').insert(notifPayloads);
      if (notifErr) {
        return NextResponse.json({ error: notifErr.message }, { status: 400 });
      }

      await db
        .from('fee_vouchers')
        .update({ last_reminder_at: new Date().toISOString() })
        .in(
          'id',
          targetVouchers.map((v) => v.id)
        );

      return NextResponse.json({ success: true, remindersSent: notifPayloads.length });
    }

    // update_fee_rates
    if (parsed.data.target_type === 'class') {
      const { error } = await db
        .from('classes')
        .update({ tuition_fee_pkr: parsed.data.monthly_fee_pkr })
        .eq('id', parsed.data.target_id)
        .eq('school_id', context.school.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    const stuUpdate: Record<string, number> = {
      monthly_fee_pkr: parsed.data.monthly_fee_pkr,
    };
    if (typeof parsed.data.discount_pkr === 'number') {
      stuUpdate.discount_pkr = parsed.data.discount_pkr;
    }
    const { error } = await db
      .from('students')
      .update(stuUpdate)
      .eq('id', parsed.data.target_id)
      .eq('school_id', context.school.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to process fee action.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'fees')) {
    return NextResponse.json({ error: 'Insufficient permissions for Fees module.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const voucherId = url.searchParams.get('id');
  if (!voucherId) {
    return NextResponse.json({ error: 'Voucher ID is required.' }, { status: 400 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const { data: existing } = await db
    .from('fee_vouchers')
    .select('id, paid_amount_pkr, voucher_number')
    .eq('id', voucherId)
    .eq('school_id', context.school.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'Voucher not found.' }, { status: 404 });
  }

  if (Number(existing.paid_amount_pkr || 0) > 0) {
    return NextResponse.json(
      { error: 'Mark voucher as Unpaid before deleting a paid challan.' },
      { status: 400 }
    );
  }

  const { error } = await db
    .from('fee_vouchers')
    .delete()
    .eq('id', voucherId)
    .eq('school_id', context.school.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
