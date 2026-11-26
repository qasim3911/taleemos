'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getSupabasePublicConfig, isSupabaseConfigured } from './config';

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (!browserClient) {
    const { url, anonKey } = getSupabasePublicConfig();
    const isHttps =
      typeof window !== 'undefined' && window.location.protocol === 'https:';
    browserClient = createBrowserClient(url, anonKey, {
      auth: {
        flowType: 'implicit',
      },
      cookieOptions: isHttps
        ? {
            path: '/',
            sameSite: 'none',
            secure: true,
            partitioned: true,
          }
        : undefined,
    });
  }
  return browserClient;
}