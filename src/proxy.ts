import { NextRequest, NextResponse } from 'next/server';

// Check if Clerk is configured
const hasClerkKeys = !!(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== ''
);

// Export middleware that bypasses Clerk when not configured
export default async function middleware(req: NextRequest) {
  // If Clerk is not configured, allow all requests through
  if (!hasClerkKeys) {
    return NextResponse.next();
  }

  // If Clerk is configured, use Clerk middleware
  try {
    const { clerkMiddleware, createRouteMatcher } = await import(
      '@clerk/nextjs/server'
    );
    const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);

    return clerkMiddleware(async (auth, request: NextRequest) => {
      if (isProtectedRoute(request)) await auth.protect();
    })(req, {} as any);
  } catch {
    // If Clerk import fails, allow request through
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)'
  ]
};
