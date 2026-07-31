export const EMAIL_ALIAS_TO_CANONICAL: Record<string, string> = {
  'elie.aintabi@jestais.com': 'elaintabi@jestais.com',
  'elaintabi@jestais.com': 'elaintabi@jestais.com',
  'sdnatarajan': 'sdnatarajan@jestais.com',
  'sdnatarajan@jestais.com': 'sdnatarajan@jestais.com',
};

export function normalizeEmail(email: string): string {
  const normalized = email.toLowerCase().trim();
  return EMAIL_ALIAS_TO_CANONICAL[normalized] || normalized;
}

export function normalizeEmailNullable(email: string | null | undefined): string | null {
  if (!email) return null;
  return normalizeEmail(email);
}

export function expandEmailIdentityCandidates(emails: string[]): string[] {
  const canonicalEmails = new Set(emails.map(normalizeEmail));
  const candidates = new Set(canonicalEmails);

  for (const [sourceIdentity, canonicalEmail] of Object.entries(EMAIL_ALIAS_TO_CANONICAL)) {
    if (canonicalEmails.has(normalizeEmail(canonicalEmail))) {
      candidates.add(sourceIdentity.toLowerCase().trim());
    }
  }

  return [...candidates];
}
