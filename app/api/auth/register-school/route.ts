import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isSupabaseAdminConfigured } from '@/lib/supabase/config';

const RegisterSchoolSchema = z.object({
  ownerName: z.string().min(2),
  ownerEmail: z.string().email(),
  password: z.string().min(8),
  schoolCode: z
    .string()
    .min(2, 'School ID must be at least 2 characters')
    .max(50, 'School ID cannot exceed 50 characters')
    .regex(/^[A-Za-z0-9\-_/]+$/, 'School ID can only contain letters, numbers, hyphens, underscores, and slashes')
    .optional()
    .or(z.literal('')),
  schoolNameEn: z.string().min(3),
  schoolNameUr: z.string().optional(),
  boardType: z.string().min(2),
  schoolType: z.string().min(2).optional(),
  registrationNumber: z.string().optional(),
  principalName: z.string().optional(),
  schoolEmail: z.string().email(),
  phone: z.string().min(7),
  address: z.string().min(5),
  city: z.string().min(2),
  tehsil: z.string().optional(),
  province: z.string().min(2),
  requestedPlanId: z.string().uuid().optional(),
});

const DEFAULT_CLASSES = [
  'Playgroup',
  'Nursery',
  'KG',
  'Grade 1',
  'Grade 2',
  'Grade 3',
  'Grade 4',
  'Grade 5',
  'Grade 6',
  'Grade 7',
  'Grade 8',
  'Matric (9th)',
  'Matric (10th)',
  'Intermediate (11th)',
  'Intermediate (12th)',
  'ICS',
];

const DEFAULT_FEE_CATEGORIES = [
  { name: 'Admission Fee', is_recurring: false },
  { name: 'Monthly Tuition Fee', is_recurring: true },
  { name: 'Annual Charges', is_recurring: false },
  { name: 'Examination Fee', is_recurring: false },
  { name: 'Computer Fee', is_recurring: true },
  { name: 'Transport Fee', is_recurring: true },
  { name: 'Other Charges', is_recurring: false },
];

export async function POST(request: Request) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      {
        error:
          'Supabase is not connected yet. Add NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in environment secrets first.',
      },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const parsed = RegisterSchoolSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Please provide valid school and owner details.', issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const admin = createSupabaseAdminClient()!;

    // 1. Determine unique school code / ID
    const rawInputCode = (data.schoolCode?.trim() || data.registrationNumber?.trim() || '').toUpperCase();
    let uniqueSchoolCode = rawInputCode;
    if (!uniqueSchoolCode) {
      const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
      uniqueSchoolCode = `SCH-${new Date().getFullYear()}-${rnd}`;
    }

    // 2. Strict Uniqueness Check: Check if School ID/Code collides with any existing school
    const { data: duplicateSchool } = await admin
      .from('schools')
      .select('id, name_en, school_code, registration_number, tracking_number')
      .or(
        `school_code.ilike.${uniqueSchoolCode},registration_number.ilike.${uniqueSchoolCode},tracking_number.ilike.${uniqueSchoolCode}`
      )
      .limit(1)
      .maybeSingle();

    if (duplicateSchool) {
      return NextResponse.json(
        {
          error: `School ID / Code "${uniqueSchoolCode}" pehle se doosray school (${duplicateSchool.name_en}) ke pas registered hai. Barah-e-karam unique School ID muntakhib karein. (School ID must be globally unique across all schools).`,
          field: 'schoolCode',
        },
        { status: 400 }
      );
    }

    // 3. Multi-Tenant Email Isolation: Check if school email is already registered to another school
    const normalizedOwnerEmail = data.ownerEmail.trim().toLowerCase();
    const normalizedSchoolEmail = data.schoolEmail.trim().toLowerCase();

    const { data: existingSchoolEmail } = await admin
      .from('schools')
      .select('id, name_en')
      .ilike('email', normalizedSchoolEmail)
      .limit(1)
      .maybeSingle();

    if (existingSchoolEmail) {
      return NextResponse.json(
        {
          error: `School official email "${data.schoolEmail}" pehle se "${existingSchoolEmail.name_en}" ke pas darj hai. Har school ka data alag rakhne ke liye alag email darj karein.`,
          field: 'schoolEmail',
        },
        { status: 400 }
      );
    }

    // 4. Resolve or create owner auth account
    const { data: existingUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    let ownerUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === normalizedOwnerEmail
    );

    if (ownerUser) {
      // Tenant Isolation Check: Does this user already own or belong to another school?
      const [{ data: existingOwnedSchool }, { data: existingMember }] = await Promise.all([
        admin
          .from('schools')
          .select('id, name_en')
          .eq('owner_user_id', ownerUser.id)
          .limit(1)
          .maybeSingle(),
        admin
          .from('school_memberships')
          .select('id, school_id')
          .eq('user_id', ownerUser.id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle(),
      ]);

      if (existingOwnedSchool || existingMember) {
        return NextResponse.json(
          {
            error: `Owner email "${data.ownerEmail}" pehle se aik school (${existingOwnedSchool?.name_en || 'Registered School'}) ke sath munsalik hai. Data ko doosray school se mukammal alag rakhne ke liye barah-e-karam alag owner email istemal karein ya login karein.`,
            field: 'ownerEmail',
          },
          { status: 400 }
        );
      }
    }

    if (!ownerUser) {
      const { data: createdAuth, error: createAuthError } = await admin.auth.admin.createUser({
        email: normalizedOwnerEmail,
        password: data.password,
        email_confirm: true,
        user_metadata: {
          full_name: data.ownerName.trim(),
          role: 'school_owner',
        },
      });
      if (createAuthError || !createdAuth.user) {
        return NextResponse.json(
          { error: createAuthError?.message || 'Unable to create owner authentication account.' },
          { status: 400 }
        );
      }
      ownerUser = createdAuth.user;
    } else if (!ownerUser.email_confirmed_at) {
      const { data: updatedAuth } = await admin.auth.admin.updateUserById(ownerUser.id, {
        email_confirm: true,
      });
      if (updatedAuth?.user) {
        ownerUser = updatedAuth.user;
      }
    }

    await admin.from('users').upsert(
      {
        id: ownerUser.id,
        email: normalizedOwnerEmail,
        full_name: data.ownerName.trim(),
        phone: data.phone.trim(),
        is_super_admin: false,
        preferred_language: 'en',
        account_status: 'active',
      },
      { onConflict: 'id' }
    );

    // 5. Insert new school with guaranteed unique school_code and status active
    const { data: school, error: schoolError } = await admin
      .from('schools')
      .insert({
        owner_user_id: ownerUser.id,
        name_en: data.schoolNameEn.trim(),
        name: data.schoolNameEn.trim(),
        school_name: data.schoolNameEn.trim(),
        name_ur: data.schoolNameUr?.trim() || null,
        school_type: data.schoolType?.trim() || 'Private',
        school_code: uniqueSchoolCode,
        registration_number: uniqueSchoolCode,
        tracking_number: uniqueSchoolCode,
        tracking_id: uniqueSchoolCode,
        bise_peira_number: data.boardType,
        board_type: data.boardType,
        principal_name: data.principalName?.trim() || data.ownerName.trim(),
        owner_name: data.ownerName.trim(),
        owner_email: normalizedOwnerEmail,
        owner_phone: data.phone.trim(),
        email: normalizedSchoolEmail,
        mobile_number: data.phone.trim(),
        phone: data.phone.trim(),
        address: data.address.trim(),
        province: data.province.trim(),
        district: data.city.trim(),
        tehsil: data.tehsil?.trim() || data.city.trim(),
        city: data.city.trim(),
        status: 'active',
        application_status: 'approved',
      })
      .select('id, status, name_en, school_code, registration_number')
      .single();

    if (schoolError || !school) {
      return NextResponse.json(
        { error: schoolError?.message || 'Failed to save school application.' },
        { status: 400 }
      );
    }

    let planId = data.requestedPlanId || null;
    let planCode = 'free';
    if (!planId) {
      const { data: freePlan } = await admin
        .from('subscription_plans')
        .select('id, code')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (freePlan) {
        planId = freePlan.id;
        planCode = freePlan.code;
      }
    }

    const { data: appRow } = await admin
      .from('school_applications')
      .insert({
        school_id: school.id,
        applicant_user_id: ownerUser.id,
        requested_plan_id: planId,
        verification_docs: [],
        status: 'approved',
      })
      .select('id')
      .single();

    const { data: ownerRole } = await admin
      .from('roles')
      .insert({
        school_id: school.id,
        name: 'Owner',
        slug: 'owner',
        is_system: true,
        description: 'Full school authority (excludes platform Super Admin controls)',
      })
      .select('id')
      .single();

    if (ownerRole) {
      await admin.from('school_memberships').insert({
        school_id: school.id,
        user_id: ownerUser.id,
        role_id: ownerRole.id,
        member_type: 'owner',
        status: 'active',
      });

      // Also ensure school_members entry for complete backward-compatibility and strict RLS
      await admin.from('school_members').insert({
        school_id: school.id,
        user_id: ownerUser.id,
        role_name: 'School Owner',
        full_name: data.ownerName.trim(),
        email: normalizedOwnerEmail,
        is_active: true,
        permissions: { '*': true },
      });

      const { data: allPerms } = await admin.from('permissions').select('code');
      if (allPerms && allPerms.length > 0) {
        await admin.from('role_permissions').insert(
          allPerms.map((p: { code: string }) => ({
            role_id: ownerRole.id,
            permission_code: p.code,
          }))
        );
      }
    }

    await Promise.all([
      admin.from('school_profiles').upsert(
        {
          school_id: school.id,
          name: data.schoolNameEn,
          school_name: data.schoolNameEn,
          current_academic_session: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
          working_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
          currency: 'PKR',
          language: 'en',
        },
        { onConflict: 'school_id' }
      ),
      admin.from('classes').insert(
        DEFAULT_CLASSES.map((name, idx) => ({
          school_id: school.id,
          name,
          level_order: idx + 1,
          tuition_fee_pkr: 0,
          is_custom: false,
        }))
      ),
      admin.from('fee_categories').insert(
        DEFAULT_FEE_CATEGORIES.map((c) => ({
          school_id: school.id,
          name: c.name,
          is_recurring: c.is_recurring,
        }))
      ),
      planId
        ? admin.from('subscriptions').insert({
            school_id: school.id,
            plan_id: planId,
            status: 'active',
            billing_cycle: 'monthly',
          })
        : Promise.resolve(null),
      admin.from('audit_logs').insert({
        school_id: school.id,
        user_id: ownerUser.id,
        action: 'school.registered',
        table_name: 'schools',
        record_id: school.id,
        new_values: { plan: planCode, status: 'active', name_en: school.name_en },
      }),
    ]);

    return NextResponse.json({
      success: true,
      trackingNumber: school.school_code || appRow?.id || school.id,
      schoolCode: school.school_code,
      schoolId: school.id,
      applicationStatus: 'Approved',
      schoolName: school.name_en,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected server error.' },
      { status: 500 }
    );
  }
}