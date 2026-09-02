import { NextResponse, type NextRequest } from 'next/server';
import { createProxySupabase } from '@/lib/supabase/middleware';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, isLocale } from '@/lib/i18n/config';

/** Reads the preferred locale from the cookie, then Accept-Language. */
function detectLocale(request: NextRequest) {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  const header = request.headers.get('accept-language') ?? '';
  const preferred = header
    .split(',')
    .map((part) => part.split(';')[0].trim().toLowerCase().split('-')[0])
    .find((code) => LOCALES.includes(code as (typeof LOCALES)[number]));

  return isLocale(preferred) ? preferred : DEFAULT_LOCALE;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Keep the auth session fresh on every navigation.
  const { supabase, response } = createProxySupabase(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ---- admin area: authenticated + explicit admin role, checked server-side.
  if (pathname.startsWith('/admin')) {
    const isLoginRoute = pathname === '/admin/login';

    if (!user) {
      if (isLoginRoute) return response;
      const url = request.nextUrl.clone();
      url.pathname = '/admin/login';
      url.search = pathname === '/admin' ? '' : `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }

    const { data: isAdmin } = await supabase.rpc('is_admin', { p_user_id: user.id });

    if (!isAdmin) {
      if (isLoginRoute) return response;
      const url = request.nextUrl.clone();
      url.pathname = '/admin/login';
      url.search = '?error=forbidden';
      return NextResponse.redirect(url);
    }

    if (isLoginRoute) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin/dashboard';
      url.search = '';
      return NextResponse.redirect(url);
    }

    return response;
  }

  // ---- route handlers are not localized and must never be rewritten.
  if (pathname.startsWith('/api')) return response;

  // ---- customer area: every page lives under /{locale}.
  const hasLocale = LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );

  if (!hasLocale) {
    const locale = detectLocale(request);
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimization requests.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)',
  ],
};
