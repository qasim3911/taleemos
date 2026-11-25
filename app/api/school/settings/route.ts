import { NextResponse } from 'next/server';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
  'image/gif',
]);

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'settings')) {
    return NextResponse.json({ error: 'Insufficient permissions for School Settings.' }, { status: 403 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient())!;

  try {
    const formData = await request.formData();
    const logoFile = formData.get('logo_file');
    const removeLogo = String(formData.get('remove_logo') || '') === 'true';
    const manualLogoUrl = String(formData.get('logo_url') || '').trim();

    let nextLogoUrl: string | null = context.school.logo_url ?? null;

    if (removeLogo) {
      nextLogoUrl = null;
    } else if (logoFile instanceof File && logoFile.size > 0) {
      if (logoFile.size > MAX_LOGO_BYTES) {
        return NextResponse.json({ error: 'Logo image must be 5 MB or smaller.' }, { status: 400 });
      }
      if (logoFile.type && !ALLOWED_IMAGE_TYPES.has(logoFile.type)) {
        return NextResponse.json(
          { error: 'Please upload a PNG, JPG, WebP, GIF, or SVG image.' },
          { status: 400 }
        );
      }

      const ext = (logoFile.name.split('.').pop() || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
      const path = `${context.school.id}/logo-${Date.now()}.${ext}`;
      const buffer = Buffer.from(await logoFile.arrayBuffer());

      const { error: uploadErr } = await db.storage.from('school-logos').upload(path, buffer, {
        contentType: logoFile.type || 'image/png',
        upsert: true,
      });

      if (uploadErr) {
        return NextResponse.json(
          { error: `Unable to upload school logo: ${uploadErr.message}` },
          { status: 400 }
        );
      }

      const { data: pub } = db.storage.from('school-logos').getPublicUrl(path);
      nextLogoUrl = pub.publicUrl;
    } else if (manualLogoUrl) {
      nextLogoUrl = manualLogoUrl;
    }

    const nameEn = String(formData.get('name_en') || context.school.name_en).trim();
    if (!nameEn) {
      return NextResponse.json({ error: 'School Name (English) is required.' }, { status: 400 });
    }

    const district = String(formData.get('district') || '').trim();
    const tehsil = String(formData.get('tehsil') || '').trim();
    const mobileNumber = String(formData.get('mobile_number') || '').trim() || null;

    const updatePayload = {
      name_en: nameEn,
      name: nameEn,
      school_name: nameEn,
      name_ur: String(formData.get('name_ur') || '').trim() || null,
      mobile_number: mobileNumber,
      phone: mobileNumber,
      email: String(formData.get('email') || context.school.email || '').trim(),
      address: String(formData.get('address') || '').trim() || null,
      district: district || null,
      tehsil: tehsil || district || null,
      city: district || tehsil || null,
      province: String(formData.get('province') || 'Punjab').trim() || 'Punjab',
      principal_name: String(formData.get('principal_name') || '').trim() || null,
      bise_peira_number: String(formData.get('bise_peira_number') || '').trim() || null,
      logo_url: nextLogoUrl,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedSchool, error: updateErr } = await db
      .from('schools')
      .update(updatePayload)
      .eq('id', context.school.id)
      .select('*')
      .single();

    if (updateErr || !updatedSchool) {
      return NextResponse.json(
        { error: updateErr?.message || 'Unable to update school settings.' },
        { status: 400 }
      );
    }

    await db.from('school_profiles').upsert(
      {
        school_id: context.school.id,
        name: nameEn,
        school_name: nameEn,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'school_id' }
    );

    await db.from('audit_logs').insert({
      school_id: context.school.id,
      user_id: context.userId,
      action: 'SCHOOL_SETTINGS_UPDATED',
      table_name: 'schools',
      record_id: context.school.id,
      new_values: {
        name_en: updatedSchool.name_en,
        logo_updated: nextLogoUrl !== context.school.logo_url,
        logo_url: updatedSchool.logo_url,
      },
    });

    return NextResponse.json({ success: true, school: updatedSchool });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to save school settings.' },
      { status: 500 }
    );
  }
}
