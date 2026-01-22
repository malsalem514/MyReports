import { redirect } from 'next/navigation';

// Check if Clerk is configured
const hasClerkKeys = !!(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== ''
);

export default async function Dashboard() {
  // If Clerk is not configured, redirect directly to overview
  if (!hasClerkKeys) {
    redirect('/dashboard/overview');
  }

  // If Clerk is configured, check auth
  try {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();

    if (!userId) {
      return redirect('/auth/sign-in');
    } else {
      redirect('/dashboard/overview');
    }
  } catch {
    // If Clerk fails, redirect to overview
    redirect('/dashboard/overview');
  }
}
