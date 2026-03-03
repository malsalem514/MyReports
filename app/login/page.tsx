import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';
import { isDevBypassEnabled } from '@/lib/dev-bypass';
import { AutoSignIn } from './auto-signin';

export const dynamic = 'force-dynamic';

function isConfigured(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v.length > 0 && !v.includes('dummy') && !v.includes('replace');
}

async function doSignIn() {
  'use server';
  await signIn('microsoft-entra-id', { redirectTo: '/dashboard' });
}

export default async function LoginPage() {
  if (isDevBypassEnabled('login-page')) {
    redirect('/dashboard');
  }

  let isAuthenticated = false;
  try {
    const session = await auth();
    isAuthenticated = !!session?.user?.email;
  } catch (error) {
    console.error('Login auth check failed:', error);
  }

  if (isAuthenticated) {
    redirect('/dashboard');
  }

  const hasAzureConfig =
    isConfigured(process.env.AZURE_AD_CLIENT_ID) &&
    isConfigured(process.env.AZURE_AD_CLIENT_SECRET) &&
    isConfigured(process.env.AZURE_AD_TENANT_ID);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">MyReports</h1>
        {hasAzureConfig ? (
          <>
            <p className="mt-2 text-sm text-gray-600">Redirecting to sign in...</p>
            <AutoSignIn action={doSignIn} />
          </>
        ) : (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Azure SSO is not configured on this environment yet. Set
            {' '}`AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, and `AZURE_AD_TENANT_ID`.
          </p>
        )}
      </div>
    </main>
  );
}
