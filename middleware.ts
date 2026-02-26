import { auth } from '@/auth';
import { isDevBypassEnabled } from '@/lib/dev-bypass';
import { NextResponse } from 'next/server';

export default auth((req) => {
  if (isDevBypassEnabled('middleware')) {
    return NextResponse.next();
  }

  if (!req.auth && req.nextUrl.pathname.startsWith('/dashboard')) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/dashboard/:path*'],
};
