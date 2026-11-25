import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

const SubscriptionRequestSchema = z.object({
  requested_plan_id: z.string().uuid(),
  billing_period: z.enum(['Monthly', 'Quarterly', '6 Months', 'Yearly']),
  request_type: z.enum(['New', 'Renewal', 'Upgrade']).default('Renewal'),
  payment_method: z.enum(['Bank Transfer', 'JazzCash', 'Easypaisa', 'Cash', 'Other']),
  transaction_ref: z.string().min(3),
  amount_pkr: z.coerce.number().min(0),
  proof_url: z.string().optional(),
});

function mapMethodForPayments(method: string) {
  const m = method.toLowerCase().replace(/\s+/g, '_');
  if (m === 'bank_transfer') return 'bank_transfer';
  if (m === 'jazzcash') return 'jazzcash';
  if (m === 'easypaisa') return 'easypaisa';
  return 'other';
}

function generatePaymentCode() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `PAY-${ymd}-${rand}`;
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'subscription')) {
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = SubscriptionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid subscription request details.' }, { status: 400 });
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    // ✅ FIX 1: Sahi price columns - Video me yehi hain
    const { data: plan } = await db
      .from('subscription_plans')
      .select('id, name, is_active, price_monthly_pkr, price_yearly_pkr')
      .eq('id', parsed.data.requested_plan_id)
      .eq('is_active', true)
      .maybeSingle();

    if (!plan) {
      return NextResponse.json({ error: 'Selected plan is unavailable.' }, { status: 404 });
    }

    let planPrice = 0;
    if (parsed.data.billing_period === 'Yearly') {
      planPrice = Number(plan.price_yearly_pkr || 0);
    } else if (parsed.data.billing_period === '6 Months') {
      planPrice = Number(plan.price_monthly_pkr || 0) * 6;
    } else if (parsed.data.billing_period === 'Quarterly') {
      planPrice = Number(plan.price_monthly_pkr || 0) * 3;
    } else {
      planPrice = Number(plan.price_monthly_pkr || 0);
    }

    const finalAmount = parsed.data.amount_pkr > 0 ? parsed.data.amount_pkr : planPrice;

    // 1. subscription_requests me save - Ye sahi tha, isko nahi chhera
    const { data: subRequest, error } = await db
      .from('subscription_requests')
      .insert({
        school_id: context.school.id,
        requested_plan_id: plan.id,
        billing_period: parsed.data.billing_period,
        request_type: parsed.data.request_type,
        payment_method: parsed.data.payment_method,
        transaction_ref: parsed.data.transaction_ref,
        amount_pkr: finalAmount,
        proof_url: parsed.data.proof_url || null,
        status: 'Pending',
        submitted_by: context.userId,
      })
      .select('*')
      .single();

    if (error || !subRequest) {
      return NextResponse.json({ error: error?.message || 'Unable to submit request.' }, { status: 400 });
    }

    // ✅ FIX 3: Sahi table = payments (Video me yehi table hai)
    // subscription_payments naam ki table hai hi nahi
    const { error: paymentError } = await db.from('payments').insert({
      school_id: context.school.id,
      receipt_number: generatePaymentCode(),
      amount_pkr: finalAmount,
      payment_method: mapMethodForPayments(parsed.data.payment_method),
      transaction_ref: parsed.data.transaction_ref,
      paid_at: new Date().toISOString(),
      notes: `Subscription Request: ${plan.name} - ${parsed.data.billing_period}`,
    });

    if (paymentError) {
      console.error('Failed to mirror to payments:', paymentError.message);
    }

    // ✅ FIX 4: GALAT subscriptions.update HATA DIYA
    // Request par Subscription nahi banti, sirf Approve par banti hai.
    // Pehle wala code galat columns se update kar ke fail ho raha tha.
    // Isliye isko yahan se bilkul hata diya hai.

    await db.from('audit_logs').insert({
      school_id: context.school.id,
      user_id: context.userId,
      action: 'SUBSCRIPTION_REQUEST_SUBMITTED',
      table_name: 'subscription_requests',
      record_id: subRequest.id,
      new_values: { plan: plan.name, billing_period: parsed.data.billing_period, amount_pkr: finalAmount },
    });

    return NextResponse.json({ request: subRequest }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected server error.' },
      { status: 500 }
    );
  }
}