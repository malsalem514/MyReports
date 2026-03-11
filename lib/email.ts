export const EMAIL_ALIAS_TO_CANONICAL: Record<string, string> = {
  'elie.aintabi@jestais.com': 'elaintabi@jestais.com',
  'elaintabi@jestais.com': 'elaintabi@jestais.com',
};

export function normalizeEmail(email: string): string {
  const normalized = email.toLowerCase().trim();
  return EMAIL_ALIAS_TO_CANONICAL[normalized] || normalized;
}

export function normalizeEmailNullable(email: string | null | undefined): string | null {
  if (!email) return null;
  return normalizeEmail(email);
}
