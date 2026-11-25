import { NextResponse } from 'next/server';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'app_access')) {
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const targetType = url.searchParams.get('targetType');
  const targetId = url.searchParams.get('targetId');

  if (!targetType || !targetId) {
    return NextResponse.json({ error: 'targetType and targetId are required query parameters.' }, { status: 400 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

  // 1. Fetch QR token history
  let tokens: Array<Record<string, unknown>> = [];
  try {
    const { data: tokenRows } = await db
      .from('app_qr_tokens')
      .select('id, purpose, token_preview, status, expires_at, consumed_at, created_at')
      .eq('school_id', context.school.id)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .order('created_at', { ascending: false })
      .limit(20);
    tokens = tokenRows ?? [];
  } catch {
    // Graceful if table not yet migrated
  }

  // 2. Fetch authorized devices
  let devices: Array<Record<string, unknown>> = [];
  try {
    const { data: deviceRows } = await db
      .from('app_devices')
      .select('id, device_id, device_name, device_model, os_version, app_version, status, last_active_at, created_at')
      .eq('school_id', context.school.id)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .order('last_active_at', { ascending: false });
    devices = deviceRows ?? [];
  } catch {
    // Graceful if table not yet migrated
  }

  // 3. Fetch app invitation logs as supplemental audit
  let invitationLogs: Array<Record<string, unknown>> = [];
  try {
    const { data: logs } = await db
      .from('app_invitation_logs')
      .select('id, action, status, email, created_at')
      .eq('school_id', context.school.id)
      .eq('target_id', targetId)
      .order('created_at', { ascending: false })
      .limit(20);
    invitationLogs = logs ?? [];
  } catch {
    // Non-fatal
  }

  return NextResponse.json({
    tokens,
    devices,
    invitationLogs,
  });
}
