import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabasePublicConfig, isSupabaseConfigured } from '@/lib/supabase/config';

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!pathname.startsWith('/dashboard') && !pathname.startsWith('/student-portal')) {
    return NextResponse.next();
  }

  if (!isSupabaseConfigured()) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('setup', 'pending');
    return NextResponse.redirect(loginUrl);
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const { url, anonKey } = getSupabasePublicConfig();
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol;
  const isHttps = proto.includes('https');

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: request.headers } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(
            name,
            value,
            isHttps
              ? { ...options, sameSite: 'none', secure: true, partitioned: true }
              : options
          )
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ['/dashboard/:path*', '/student-portal/:path*'],
};
