import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { getPublicSupabaseEnv, hasPublicSupabaseEnv } from '@/lib/env';
import { getCanonicalRedirectUrl } from '@/lib/site-url';

export async function updateSession(request: NextRequest) {
  const canonicalRedirectUrl = getCanonicalRedirectUrl(request.nextUrl);

  if (canonicalRedirectUrl) {
    return NextResponse.redirect(canonicalRedirectUrl);
  }

  let response = NextResponse.next({ request });

  if (!hasPublicSupabaseEnv()) {
    return response;
  }

  const env = getPublicSupabaseEnv();

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getClaims();

  return response;
}
