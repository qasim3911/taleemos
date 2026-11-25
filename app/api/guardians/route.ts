import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

const GuardianCreateSchema = z.object({
  full_name: z.string().min(2, 'Full name is required'),
  father_husband_name: z.string().optional(),
  relationship: z.string().default('Father'),
  phone: z.string().min(7, 'Valid contact number is required'),
  email: z.string().email().optional().or(z.literal('')),
  cnic: z.string().optional(),
  address: z.string().optional(),
  emergency_contact: z.string().optional(),
  communication_notes: z.string().optional(),
  is_verified: z.boolean().default(true),
});

const GuardianPatchSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().min(2).optional(),
  father_husband_name: z.string().optional(),
  relationship: z.string().optional(),
  phone: z.string().min(7).optional(),
  email: z.string().email().optional().or(z.literal('')),
  cnic: z.string().optional(),
  address: z.string().optional(),
  emergency_contact: z.string().optional(),
  communication_notes: z.string().optional(),
  is_verified: z.boolean().optional(),
  app_access_enabled: z.boolean().optional(),
  app_blocked: z.boolean().optional(),
  app_account_status: z.enum(['not_provisioned', 'pending_invite', 'active', 'blocked', 'deactivated']).optional(),
  access_state: z.string().optional(),
  status: z.string().optional(),
});

export async function GET(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;
  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.trim().toLowerCase();
  const phoneQuery = url.searchParams.get('phone')?.trim();
  const cnicQuery = url.searchParams.get('cnic')?.trim();

  // If looking up specifically for admissions auto-matching:
  if (phoneQuery || cnicQuery) {
    let query = db.from('guardians').select('*').eq('school_id', context.school.id);
    if (phoneQuery) query = query.eq('phone', phoneQuery);
    else if (cnicQuery) query = query.eq('cnic', cnicQuery);

    const { data: matched } = await query.maybeSingle();
    return NextResponse.json({ guardian: matched || null });
  }

  const [{ data: guardians, error: gErr }, { data: links }, { data: students }, { data: classes }, { data: sections }] =
    await Promise.all([
      db
        .from('guardians')
        .select('*')
        .eq('school_id', context.school.id)
        .order('created_at', { ascending: false }),
      db
        .from('student_guardians')
        .select('id, student_id, guardian_id, is_primary')
        .eq('school_id', context.school.id),
      db
        .from('students')
        .select('id, admission_number, name_en, class_id, section_id, status')
        .eq('school_id', context.school.id),
      db.from('classes').select('id, name').eq('school_id', context.school.id),
      db.from('sections').select('id, name').eq('school_id', context.school.id),
    ]);

  if (gErr) {
    return NextResponse.json({ error: gErr.message }, { status: 400 });
  }

  const classMap = new Map((classes ?? []).map((c) => [c.id as string, c.name as string]));
  const sectionMap = new Map((sections ?? []).map((s) => [s.id as string, s.name as string]));
  const studentMap = new Map((students ?? []).map((s) => [s.id as string, s]));

  // Group linked students by guardian_id
  const guardianChildrenMap = new Map<
    string,
    Array<{
      id: string;
      linkId: string;
      admissionNumber: string;
      name: string;
      className: string;
      sectionName: string;
      isPrimary: boolean;
      status: string;
    }>
  >();

  for (const l of links ?? []) {
    const stu = studentMap.get(String(l.student_id));
    if (stu) {
      const clsName = stu.class_id ? classMap.get(String(stu.class_id)) || 'Class' : 'Unassigned';
      const secName = stu.section_id ? sectionMap.get(String(stu.section_id)) || '' : '';
      const list = guardianChildrenMap.get(String(l.guardian_id)) ?? [];
      list.push({
        id: String(stu.id),
        linkId: String(l.id),
        admissionNumber: String(stu.admission_number),
        name: String(stu.name_en),
        className: clsName,
        sectionName: secName,
        isPrimary: Boolean(l.is_primary),
        status: String(stu.status || 'active'),
      });
      guardianChildrenMap.set(String(l.guardian_id), list);
    }
  }

  const result = (guardians ?? []).map((g) => {
    const linkedChildren = guardianChildrenMap.get(String(g.id)) ?? [];
    const displayStatus = g.app_blocked
      ? 'Access Suspended'
      : g.app_account_status === 'active' || Boolean(g.pin_hash) || (g.app_access_enabled && g.last_login_at) || g.status === 'Activated'
      ? 'Activated'
      : g.app_account_status === 'pending_invite' || g.app_access_enabled || g.status === 'QR Generated'
      ? 'QR Generated'
      : g.app_account_status === 'deactivated' || g.status === 'Access Revoked'
      ? 'Access Revoked'
      : 'Registered';
    return {
      ...g,
      father_husband_name: g.father_husband_name ?? null,
      app_access_enabled: Boolean(g.app_access_enabled),
      app_blocked: Boolean(g.app_blocked),
      status: displayStatus,
      is_verified: g.is_verified !== false,
      last_login_at: g.last_login_at ?? null,
      linkedChildren,
      linkedChildrenCount: linkedChildren.length,
    };
  });

  const filtered = search
    ? result.filter((g) =>
        `${g.full_name} ${g.phone} ${g.cnic || ''} ${g.relationship}`.toLowerCase().includes(search)
      )
    : result;

  return NextResponse.json({ guardians: filtered });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'parents') && !hasModulePermission(context.member, 'students')) {
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = GuardianCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid guardian data.', issues: parsed.error.issues }, { status: 400 });
    }

    const input = parsed.data;
    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    // Check if an existing guardian already has this phone or CNIC in this school
    let query = db.from('guardians').select('id, full_name, phone').eq('school_id', context.school.id);
    if (input.cnic && input.cnic.trim()) {
      query = query.or(`phone.eq.${input.phone.trim()},cnic.eq.${input.cnic.trim()}`);
    } else {
      query = query.eq('phone', input.phone.trim());
    }

    const { data: existing } = await query.maybeSingle();
    if (existing) {
      return NextResponse.json(
        {
          error: `Guardian "${existing.full_name}" is already registered with this contact number. You can link students directly to this existing guardian.`,
          existingGuardianId: existing.id,
        },
        { status: 409 }
      );
    }

    const insertPayload: Record<string, unknown> = {
      school_id: context.school.id,
      full_name: input.full_name.trim(),
      relationship: input.relationship || 'Father',
      phone: input.phone.trim(),
      email: input.email ? input.email.trim().toLowerCase() : null,
      cnic: input.cnic ? input.cnic.trim() : null,
      address: input.address ? input.address.trim() : null,
      emergency_contact: input.emergency_contact ? input.emergency_contact.trim() : null,
      communication_notes: input.communication_notes ? input.communication_notes.trim() : null,
    };

    // Include extended columns if database supports them
    if (input.father_husband_name) insertPayload.father_husband_name = input.father_husband_name.trim();
    insertPayload.status = 'active';
    insertPayload.access_state = 'ACTIVE';
    insertPayload.app_account_status = 'not_provisioned';
    insertPayload.is_verified = input.is_verified;
    insertPayload.app_access_enabled = false;
    insertPayload.app_blocked = false;

    let guardian: Record<string, unknown> | null = null;
    const res = await db.from('guardians').insert(insertPayload).select('*').single();

    if (res.error) {
      // Graceful fallback if extended columns not yet in DB schema
      const corePayload = {
        school_id: context.school.id,
        full_name: input.full_name.trim(),
        relationship: input.relationship || 'Father',
        phone: input.phone.trim(),
        email: input.email ? input.email.trim().toLowerCase() : null,
        cnic: input.cnic ? input.cnic.trim() : null,
        address: input.address ? input.address.trim() : null,
        emergency_contact: input.emergency_contact ? input.emergency_contact.trim() : null,
        communication_notes: input.communication_notes ? input.communication_notes.trim() : null,
      };
      const retry = await db.from('guardians').insert(corePayload).select('*').single();
      if (retry.error) {
        return NextResponse.json({ error: retry.error.message }, { status: 400 });
      }
      guardian = retry.data;
    } else {
      guardian = res.data;
    }

    await db.from('audit_logs').insert({
      school_id: context.school.id,
      user_id: context.userId,
      action: 'GUARDIAN_CREATED',
      table_name: 'guardians',
      record_id: String(guardian?.id),
      new_values: { full_name: input.full_name, phone: input.phone },
    });

    return NextResponse.json({ guardian }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to create guardian.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'parents') && !hasModulePermission(context.member, 'app_access')) {
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = GuardianPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid update payload.', issues: parsed.error.issues }, { status: 400 });
    }

    const { id, ...updates } = parsed.data;
    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.full_name !== undefined) payload.full_name = updates.full_name.trim();
    if (updates.father_husband_name !== undefined) payload.father_husband_name = updates.father_husband_name?.trim() || null;
    if (updates.relationship !== undefined) payload.relationship = updates.relationship;
    if (updates.phone !== undefined) payload.phone = updates.phone.trim();
    if (updates.email !== undefined) payload.email = updates.email ? updates.email.trim().toLowerCase() : null;
    if (updates.cnic !== undefined) payload.cnic = updates.cnic ? updates.cnic.trim() : null;
    if (updates.address !== undefined) payload.address = updates.address ? updates.address.trim() : null;
    if (updates.emergency_contact !== undefined) payload.emergency_contact = updates.emergency_contact ? updates.emergency_contact.trim() : null;
    if (updates.communication_notes !== undefined) payload.communication_notes = updates.communication_notes ? updates.communication_notes.trim() : null;
    if (updates.is_verified !== undefined) payload.is_verified = updates.is_verified;
    if (updates.app_access_enabled !== undefined) payload.app_access_enabled = updates.app_access_enabled;
    if (updates.app_blocked !== undefined) payload.app_blocked = updates.app_blocked;
    if (updates.app_account_status !== undefined) payload.app_account_status = updates.app_account_status;
    if (updates.access_state !== undefined) payload.access_state = updates.access_state;
    // Keep DB status 'active' unless explicitly archived/inactive; derive UI label from app_account_status
    if (updates.status === 'active' || updates.status === 'inactive') {
      payload.status = updates.status;
    } else if (updates.app_blocked !== undefined || updates.app_access_enabled !== undefined) {
      payload.status = 'active';
      if (updates.app_account_status === undefined) {
        payload.app_account_status = updates.app_blocked
          ? 'blocked'
          : updates.app_access_enabled
          ? 'active'
          : 'deactivated';
      }
      if (updates.access_state === undefined) {
        payload.access_state = updates.app_blocked ? 'SUSPENDED' : 'ACTIVE';
      }
    }

    let updatedGuardian: Record<string, unknown> | null = null;
    const res = await db.from('guardians').update(payload).eq('id', id).eq('school_id', context.school.id).select('*').single();

    if (res.error) {
      // Safe fallback if some extended columns not in schema yet
      const safeCorePayload: Record<string, unknown> = {};
      if (updates.full_name !== undefined) safeCorePayload.full_name = updates.full_name.trim();
      if (updates.relationship !== undefined) safeCorePayload.relationship = updates.relationship;
      if (updates.phone !== undefined) safeCorePayload.phone = updates.phone.trim();
      if (updates.email !== undefined) safeCorePayload.email = updates.email ? updates.email.trim().toLowerCase() : null;
      if (updates.cnic !== undefined) safeCorePayload.cnic = updates.cnic ? updates.cnic.trim() : null;

      const retry = await db.from('guardians').update(safeCorePayload).eq('id', id).eq('school_id', context.school.id).select('*').single();
      if (retry.error) {
        return NextResponse.json({ error: retry.error.message }, { status: 400 });
      }
      updatedGuardian = retry.data;
    } else {
      updatedGuardian = res.data;
    }

    if (updates.is_verified !== undefined) {
      await db
        .from('student_guardians')
        .update({
          is_verified: updates.is_verified,
          verified_by: updates.is_verified ? context.userId : null,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('guardian_id', id)
        .eq('school_id', context.school.id);
    }

    return NextResponse.json({ guardian: updatedGuardian });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Update failed.' },
      { status: 500 }
    );
  }
}
