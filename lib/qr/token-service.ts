import crypto from 'node:crypto';
import QRCode from 'qrcode';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { ensureTeacherAuthLinked } from '@/lib/auth/teacher-link';

export type ActivationRole = 'teacher' | 'student' | 'guardian';

export type ActivationPurpose =
  | 'teacher_first_activation'
  | 'student_first_activation'
  | 'guardian_first_activation'
  | 'teacher_pin_reset'
  | 'student_pin_reset'
  | 'guardian_pin_reset';

export interface QRPayload {
  app: 'TaleemOS-Universal';
  v: 1;
  school_id: string;
  target_type: ActivationRole;
  role: ActivationRole;
  purpose: ActivationPurpose;
  token: string;
  expires_at: string;
}

export interface GeneratedQRResult {
  tokenId?: string;
  rawToken: string;
  tokenPreview: string;
  tokenHash: string;
  qrDataUrl: string;
  qrPayloadJson: string;
  expiresAt: string;
  purpose: ActivationPurpose;
  role: ActivationRole;
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Creates a cryptographically secure, short-lived, one-time activation QR token
 * and stores its SHA-256 hash in the database.
 */
export async function createActivationQR(
  db: SupabaseClient,
  params: {
    schoolId: string;
    targetType: ActivationRole;
    targetId: string;
    role: ActivationRole;
    purpose: ActivationPurpose;
    createdBy?: string;
    expiresInMinutes?: number;
    skipAuthLink?: boolean;
  }
): Promise<GeneratedQRResult> {
  const { schoolId, targetType, targetId, role, purpose, createdBy, skipAuthLink } = params;
  const adminDb = createSupabaseAdminClient() ?? db;
  const expiresInMinutes = params.expiresInMinutes || 15;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000).toISOString();

  // For teachers, admin_generate_teacher_qr_token and verify_teacher_qr_token require:
  // 1) teacher status is active, app_access_enabled = true, app_blocked = false
  // 2) teacher user_id is linked to a valid auth.users + public.users row
  if (targetType === 'teacher') {
    const { data: teacherRow, error: teacherErr } = await adminDb
      .from('teachers')
      .select('id, status')
      .eq('id', targetId)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (teacherErr || !teacherRow) {
      throw new Error('Teacher record not found in this school.');
    }

    const normalizedStatus = String(teacherRow.status || 'active').toLowerCase();
    if (['inactive', 'resigned', 'terminated', 'archived', 'withdrawn', 'left_school'].includes(normalizedStatus)) {
      throw new Error('Cannot generate QR code for resigned or inactive staff. Set status to Active first.');
    }

    const { error: enableErr } = await adminDb
      .from('teachers')
      .update({
        app_access_enabled: true,
        app_blocked: false,
        updated_at: now.toISOString(),
      })
      .eq('id', targetId)
      .eq('school_id', schoolId);

    if (enableErr) {
      throw new Error(`Unable to enable teacher app access: ${enableErr.message}`);
    }

    if (!skipAuthLink) {
      const linkedUserId = await ensureTeacherAuthLinked(adminDb, { schoolId, teacherId: targetId });
      if (!linkedUserId) {
        throw new Error('Unable to link teacher login account. Please check teacher details and try again.');
      }
    }
  }

  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const tokenPreview = `${rawToken.slice(0, 4)}...${rawToken.slice(-4)}`;

  const payload: QRPayload = {
    app: 'TaleemOS-Universal',
    v: 1,
    school_id: schoolId,
    target_type: targetType,
    role,
    purpose,
    token: rawToken,
    expires_at: expiresAt,
  };

  const qrPayloadJson = JSON.stringify(payload);
  const qrDataUrl = await QRCode.toDataURL(qrPayloadJson, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });

  // 1. Revoke any prior active tokens for this user & target
  try {
    await adminDb
      .from('app_qr_tokens')
      .update({ status: 'revoked' })
      .eq('school_id', schoolId)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .eq('status', 'active');
  } catch {
    // Graceful if table not yet migrated
  }

  // 2. Insert new token record
  let tokenId: string | undefined;
  try {
    const { data: inserted, error: insertErr } = await adminDb
      .from('app_qr_tokens')
      .insert({
        school_id: schoolId,
        target_type: targetType,
        target_id: targetId,
        role,
        purpose,
        token_hash: tokenHash,
        token_preview: tokenPreview,
        status: 'active',
        expires_at: expiresAt,
        created_by: createdBy || null,
      })
      .select('id')
      .maybeSingle();

    if (!insertErr && inserted) {
      tokenId = inserted.id;
    }
  } catch {
    // Graceful fallback
  }

  // 3. Sync with target app activation tables
  if (targetType === 'student' || targetType === 'guardian') {
    const upperRole = targetType === 'guardian' ? 'GUARDIAN' : 'STUDENT';
    const actPurpose = purpose.includes('reset') ? 'PIN_RESET' : 'ACTIVATE';
    try {
      await adminDb
        .from('app_activation_tokens')
        .update({ is_used: true })
        .eq('school_id', schoolId)
        .eq('account_id', targetId)
        .eq('role', upperRole)
        .eq('is_used', false);

      const { error: actErr } = await adminDb.from('app_activation_tokens').insert({
        token: rawToken,
        account_id: targetId,
        school_id: schoolId,
        role: upperRole,
        purpose: actPurpose,
        is_used: false,
        expires_at: expiresAt,
      });
      if (actErr) {
        throw new Error(`Failed to sync activation token: ${actErr.message}`);
      }
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to sync activation token.');
    }
  } else if (targetType === 'teacher') {
    const { data: tRpcData, error: tRpcErr } = await adminDb.rpc('admin_generate_teacher_qr_token', {
      p_school_id: schoolId,
      p_teacher_id: targetId,
      p_token_hash: tokenHash,
      p_purpose: purpose.includes('reset') ? 'pin_reset' : 'activation',
      p_ttl_minutes: expiresInMinutes,
      p_created_by: createdBy || null,
    });

    const rpcResult = (tRpcData && typeof tRpcData === 'object' ? tRpcData : null) as
      | { ok?: boolean; message?: string; error_code?: string }
      | null;

    if (tRpcErr || !rpcResult?.ok) {
      if (tokenId) {
        await adminDb.from('app_qr_tokens').update({ status: 'revoked' }).eq('id', tokenId);
      }
      throw new Error(
        rpcResult?.message ||
          tRpcErr?.message ||
          'Failed to register Teacher App QR activation token.'
      );
    }

    const { data: syncedRow } = await adminDb
      .from('teacher_qr_activation_tokens')
      .select('id')
      .eq('token_hash', tokenHash)
      .eq('teacher_id', targetId)
      .is('revoked_at', null)
      .maybeSingle();

    if (!syncedRow) {
      if (tokenId) {
        await adminDb.from('app_qr_tokens').update({ status: 'revoked' }).eq('id', tokenId);
      }
      throw new Error('Teacher QR token failed persistence verification. Please try again.');
    }
  }

  // 4. Update target record safely (do not violate students/teachers status check constraints)
  const table = targetType === 'teacher' ? 'teachers' : targetType === 'student' ? 'students' : 'guardians';
  try {
    await adminDb
      .from(table)
      .update({
        app_access_enabled: true,
        app_blocked: false,
      })
      .eq('id', targetId)
      .eq('school_id', schoolId);

    if (targetType === 'guardian') {
      const { data: existingGuardian } = await adminDb
        .from('guardians')
        .select('pin_hash, app_account_status')
        .eq('id', targetId)
        .eq('school_id', schoolId)
        .maybeSingle();

      const nextAccountStatus =
        existingGuardian?.pin_hash || existingGuardian?.app_account_status === 'active'
          ? 'active'
          : 'pending_invite';

      await adminDb
        .from('guardians')
        .update({
          status: 'active',
          access_state: 'ACTIVE',
          is_verified: true,
          app_account_status: nextAccountStatus,
          qr_token_expires_at: expiresAt,
        })
        .eq('id', targetId)
        .eq('school_id', schoolId);
    } else if (targetType === 'student') {
      await adminDb
        .from('students')
        .update({
          access_state: 'ACTIVE',
          qr_token_expires_at: expiresAt,
        })
        .eq('id', targetId)
        .eq('school_id', schoolId);
    }
  } catch {
    // Non-fatal
  }

  // 5. Log in app_invitation_logs
  try {
    await adminDb.from('app_invitation_logs').insert({
      school_id: schoolId,
      target_type: targetType === 'guardian' ? 'student' : targetType, // Schema constraint
      target_id: targetId,
      email: `qr-${purpose}@activation.local`,
      action: purpose.includes('reset') ? 'password_reset_sent' : 'invited',
      status: 'QR Generated',
      performed_by: createdBy || null,
    });
  } catch {
    // Non-fatal
  }

  return {
    tokenId,
    rawToken,
    tokenPreview,
    tokenHash,
    qrDataUrl,
    qrPayloadJson,
    expiresAt,
    purpose,
    role,
  };
}

/**
 * Revokes any active QR token for a target user
 */
export async function revokeActiveQRToken(
  db: SupabaseClient,
  params: {
    schoolId: string;
    targetType: ActivationRole;
    targetId: string;
  }
): Promise<boolean> {
  const { schoolId, targetType, targetId } = params;

  try {
    const { error } = await db
      .from('app_qr_tokens')
      .update({ status: 'revoked' })
      .eq('school_id', schoolId)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .eq('status', 'active');

    if (targetType === 'student' || targetType === 'guardian') {
      const upperRole = targetType === 'guardian' ? 'GUARDIAN' : 'STUDENT';
      await db
        .from('app_activation_tokens')
        .update({ is_used: true })
        .eq('school_id', schoolId)
        .eq('account_id', targetId)
        .eq('role', upperRole)
        .eq('is_used', false);
    } else if (targetType === 'teacher') {
      await db
        .from('teacher_qr_activation_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('school_id', schoolId)
        .eq('teacher_id', targetId)
        .is('revoked_at', null);
    }

    return !error;
  } catch {
    return true;
  }
}
