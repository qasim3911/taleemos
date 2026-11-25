import type { SupabaseClient } from '@supabase/supabase-js';

export async function ensurePublicUserProfile(
  admin: SupabaseClient,
  userId: string,
  email?: string | null,
  fullName?: string | null
) {
  if (!userId) return;
  const { data: existing } = await admin
    .from('users')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (!existing) {
    await admin.from('users').insert({
      id: userId,
      email: (email || `${userId}@school.local`).trim().toLowerCase(),
      full_name: fullName?.trim() || 'School Staff',
      is_super_admin: false,
      preferred_language: 'en',
      account_status: 'active',
    });
  }
}
