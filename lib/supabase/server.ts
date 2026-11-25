import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import {
  getSupabasePublicConfig,
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from './config';

export async function createSupabaseServerClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const { url, anonKey } = getSupabasePublicConfig();
  const proto = headerStore.get('x-forwarded-proto') || '';
  const host = headerStore.get('host') || '';
  const isHttps = proto.includes('https') || (!host.startsWith('localhost') && !host.startsWith('127.0.0.1') && host !== '');

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(
              name,
              value,
              isHttps
                ? { ...options, sameSite: 'none', secure: true, partitioned: true }
                : options
            )
          );
        } catch {
          // Server Component read-only cookie context
        }
      },
    },
  });
}

export function createSupabaseAdminClient() {
  if (!isSupabaseAdminConfigured()) {
    return null;
  }
  const { url } = getSupabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
