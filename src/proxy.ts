import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getPlatformRole, isPlatformUser } from '@/lib/platform/roles';

// Routes accessible even when subscription is expired / suspended
const BILLING_ONLY_ROUTES = ['/dashboard/billing'];

// Public routes — no auth required
const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/offline',
  '/super-admin/login',
  '/api/',
];

async function userHasStoreAccess(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<boolean> {
  const [{ count: memberCount }, { count: ownedCount }] = await Promise.all([
    supabase
      .from('store_users')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_active', true),
    supabase
      .from('stores')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', userId),
  ]);
  return (memberCount ?? 0) > 0 || (ownedCount ?? 0) > 0;
}

// Routes that require subscription but allow expired trial (read-only access window)
// Empty for now — all non-billing dashboard routes are gated.

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // ── Super Admin routes ────────────────────────────────────────────────────
  if (pathname.startsWith('/super-admin')) {
    if (pathname === '/super-admin/login') {
      if (user && isPlatformUser(user)) {
        return NextResponse.redirect(new URL('/super-admin', request.url));
      }
      return supabaseResponse;
    }
    if (!user) {
      return NextResponse.redirect(new URL('/super-admin/login', request.url));
    }
    if (!isPlatformUser(user)) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return supabaseResponse;
  }

  // Legacy /admin → redirect to /super-admin
  if (pathname.startsWith('/admin')) {
    const target = pathname.replace(/^\/admin/, '/super-admin') || '/super-admin';
    return NextResponse.redirect(new URL(target, request.url));
  }

  // API routes always pass through — never redirect them regardless of auth state
  if (pathname.startsWith('/api/')) {
    return supabaseResponse;
  }

  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  // Redirect logged-in users away from auth pages (login, register, etc.)
  if (isPublicRoute && user && pathname !== '/super-admin/login') {
    const role = getPlatformRole(user);
    if (role) {
      const hasStore = await userHasStoreAccess(supabase, user.id);
      if (!hasStore) {
        return NextResponse.redirect(new URL('/super-admin', request.url));
      }
    }
    if (pathname.startsWith('/login') || pathname.startsWith('/register')) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Protect all non-public routes
  if (!isPublicRoute && !user && pathname !== '/') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // ── Subscription enforcement for dashboard routes ────────────────────────
  if (user && pathname.startsWith('/dashboard') && !pathname.startsWith('/api/')) {
    const role = getPlatformRole(user);
    const hasStore = await userHasStoreAccess(supabase, user.id);

    // Platform-only operators must not use store operations
    if (role && !hasStore) {
      return NextResponse.redirect(new URL('/super-admin', request.url));
    }

    const isBillingRoute = BILLING_ONLY_ROUTES.some((r) => pathname.startsWith(r));

    if (!isBillingRoute) {
      // Fetch subscription status from DB (not a cookie — not spoofable).
      // We only query stores the user belongs to, so no extra RLS risk.
      const { data: membership } = await supabase
        .from('store_users')
        .select('store_id, stores!inner(subscription_status, is_active, trial_ends_at)')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (membership) {
        const store = (membership as unknown as { stores: {
          subscription_status: string;
          is_active: boolean;
          trial_ends_at: string | null;
        } }).stores;

        const status = store.subscription_status;

        // Block if store is deactivated
        if (!store.is_active) {
          return NextResponse.redirect(new URL('/dashboard/billing', request.url));
        }

        // Block expired / suspended / cancelled / disabled stores
        if (status === 'expired' || status === 'suspended' || status === 'cancelled' || status === 'disabled') {
          return NextResponse.redirect(new URL('/dashboard/billing', request.url));
        }

        // Block if trial period has ended
        if (status === 'trial' && store.trial_ends_at) {
          const trialEnd = new Date(store.trial_ends_at);
          if (trialEnd < new Date()) {
            return NextResponse.redirect(new URL('/dashboard/billing', request.url));
          }
        }
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|icon-.*\\.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
