import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';
import { isDevBypassEnabled } from '@/lib/dev-bypass';

export const dynamic = 'force-dynamic';

function isConfigured(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v.length > 0 && !v.includes('dummy') && !v.includes('replace');
}

export default async function LoginPage() {
  // Local smoke/dev mode: skip identity provider entirely.
  if (isDevBypassEnabled('login-page')) {
    redirect('/dashboard');
  }

  let isAuthenticated = false;
  try {
    const session = await auth();
    isAuthenticated = !!session?.user?.email;
  } catch (error) {
    // If auth provider config is incomplete, render a safe login page instead of crashing.
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
        <p className="mt-2 text-sm text-gray-600">
          Sign in with Microsoft Entra ID to access reports.
        </p>
        {!hasAzureConfig && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Azure SSO is not configured on this environment yet. Set
            {' '}`AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, and `AZURE_AD_TENANT_ID`.
          </p>
        )}

        <form
          className="mt-6"
          action={async () => {
            'use server';
            if (!hasAzureConfig) return;
            await signIn('microsoft-entra-id', { redirectTo: '/dashboard' });
          }}
        >
          <button
            type="submit"
            disabled={!hasAzureConfig}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            {hasAzureConfig ? 'Sign In' : 'Sign In Unavailable'}
          </button>
        </form>
      </div>
    </main>
  );
}
