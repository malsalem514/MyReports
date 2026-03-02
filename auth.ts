import NextAuth from 'next-auth';
import MicrosoftEntraId from 'next-auth/providers/microsoft-entra-id';

const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false;
const cookiePrefix = useSecureCookies ? '__Secure-' : '';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  cookies: {
    pkceCodeVerifier: {
      name: `${cookiePrefix}authjs.pkce.code_verifier`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },
  },
  providers: [
    MicrosoftEntraId({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
      authorization: {
        params: {
          scope: 'openid profile email User.Read',
        },
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    jwt({ token, account, profile }) {
      if (account && profile) {
        token.email =
          profile.email ??
          ((profile as Record<string, unknown>).preferred_username as string);
        token.name = profile.name;
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        ...session.user,
        email: token.email ? String(token.email) : session.user?.email || '',
        name: token.name ? String(token.name) : session.user?.name || '',
      };
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
});
