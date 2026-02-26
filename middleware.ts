import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  if (process.env.DEV_BYPASS_AUTH === 'true') {
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
