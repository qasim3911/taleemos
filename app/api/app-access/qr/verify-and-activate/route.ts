import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { hashToken } from '@/lib/qr/token-service';
import { ensureTeacherAuthLinked } from '@/lib/auth/teacher-link';

const ActivateSchema = z.object({
  rawToken: z.string().min(16),
  schoolId: z.string().uuid(),
  role: z.enum(['teacher', 'student', 'guardian']),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be between 4 and 6 numeric digits'),
  device: z.object({
    deviceId: z.string().min(3),
    deviceName: z.string().optional(),
    deviceModel: z.string().optional(),
    osVersion: z.string().optional(),
    appVersion: z.string().optional(),
  }),
});

function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(`taleemos_pin_salt_${pin.trim()}`).digest('hex');
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonCors(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, { status: init?.status ?? 200, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = ActivateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonCors(
        { error: 'Invalid activation payload.', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { rawToken, schoolId, role, pin, device } = parsed.data;
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return jsonCors({ error: 'Database service unavailable.' }, { status: 503 });
    }

    const tokenHash = hashToken(rawToken);

    // 1. Lookup QR token
    const { data: tokenRecord, error: tokenErr } = await admin
      .from('app_qr_tokens')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (tokenErr || !tokenRecord) {
      return jsonCors(
        { error: 'Invalid QR code or token not recognized. Please request a new QR code from your school admin.' },
        { status: 404 }
      );
    }

    if (tokenRecord.school_id !== schoolId) {
      return jsonCors(
        { error: 'Security mismatch: QR code is not bound to this school.' },
        { status: 403 }
      );
    }

    if (tokenRecord.role !== role) {
      return jsonCors(
        {
          error: `Cross-role activation rejected: A ${tokenRecord.role} QR cannot be scanned in the ${role} app.`,
        },
        { status: 403 }
      );
    }

    if (tokenRecord.status !== 'active') {
      return jsonCors(
        {
          error: `This QR code has already been ${tokenRecord.status}. Please ask your school admin to regenerate a new QR code.`,
        },
        { status: 409 }
      );
    }

    const now = new Date();
    if (new Date(tokenRecord.expires_at) < now) {
      await admin.from('app_qr_tokens').update({ status: 'expired' }).eq('id', tokenRecord.id);
      return jsonCors(
        { error: 'This QR code has expired (15-minute validity limit). Please ask your school admin for a fresh QR code.' },
        { status: 410 }
      );
    }

    // 2. Consume Token
    await admin
      .from('app_qr_tokens')
      .update({
        status: 'consumed',
        consumed_at: now.toISOString(),
        consumed_by_device_id: device.deviceId,
      })
      .eq('id', tokenRecord.id);

    if (role === 'student' || role === 'guardian') {
      try {
        await admin
          .from('app_activation_tokens')
          .update({ is_used: true, used_device_id: device.deviceId })
          .eq('token', rawToken);
      } catch {
        // Non-fatal
      }
    }

    const pinHashValue = hashPin(pin);
    const table = role === 'teacher' ? 'teachers' : role === 'student' ? 'students' : 'guardians';

    let authUserId: string | null = null;
    if (role === 'teacher') {
      authUserId = await ensureTeacherAuthLinked(admin, {
        schoolId,
        teacherId: tokenRecord.target_id,
      });
    }

    await admin
      .from(table)
      .update({
        pin_hash: pinHashValue,
        app_access_enabled: true,
        app_blocked: false,
        last_login_at: now.toISOString(),
        ...(authUserId ? { user_id: authUserId } : {}),
      })
      .eq('id', tokenRecord.target_id)
      .eq('school_id', schoolId);

    if (role === 'guardian') {
      await admin
        .from('guardians')
        .update({
          status: 'active',
          access_state: 'ACTIVE',
          app_account_status: 'active',
        })
        .eq('id', tokenRecord.target_id)
        .eq('school_id', schoolId);
    } else if (role === 'student') {
      await admin
        .from('students')
        .update({
          access_state: 'ACTIVE',
        })
        .eq('id', tokenRecord.target_id)
        .eq('school_id', schoolId);
    }

    // 4. Register device
    try {
      await admin.from('app_devices').upsert(
        {
          school_id: schoolId,
          target_type: role,
          target_id: tokenRecord.target_id,
          device_id: device.deviceId,
          device_name: device.deviceName || 'Mobile Device',
          device_model: device.deviceModel || 'Smartphone',
          os_version: device.osVersion || 'Android',
          app_version: device.appVersion || '1.0.0',
          status: 'authorized',
          last_active_at: now.toISOString(),
        },
        { onConflict: 'target_type,target_id,device_id' }
      );
    } catch {
      // Graceful
    }

    // 5. Audit log
    try {
      await admin.from('app_invitation_logs').insert({
        school_id: schoolId,
        target_type: role === 'guardian' ? 'student' : role,
        target_id: tokenRecord.target_id,
        email: `pin-${tokenRecord.purpose}@device.local`,
        action: tokenRecord.purpose.includes('reset') ? 'password_reset_sent' : 'activated',
        status: 'Activated',
      });
    } catch {
      // Non-fatal
    }

    return jsonCors({
      success: true,
      message: 'Mobile app account activated successfully. You can now use your PIN to log in.',
      role,
      schoolId,
      targetId: tokenRecord.target_id,
      purpose: tokenRecord.purpose,
      activatedAt: now.toISOString(),
    });
  } catch (err) {
    return jsonCors(
      { error: err instanceof Error ? err.message : 'Activation failed.' },
      { status: 500 }
    );
  }
}