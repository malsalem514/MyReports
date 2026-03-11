export const ROOT_ADMIN_EMAILS = ['malsalem@jestais.com'] as const;

export const HR_ADMIN_EMAILS = [
  'hr@jestais.com',
  'iferber@jestais.com',
] as const;

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function isRootAdminEmail(email: string): boolean {
  const normalizedEmail = normalizeEmail(email);
  return ROOT_ADMIN_EMAILS.some((admin) => admin === normalizedEmail);
}

export function isHRAdminEmail(email: string): boolean {
  const normalizedEmail = normalizeEmail(email);
  return HR_ADMIN_EMAILS.some((admin) => admin === normalizedEmail);
}

export function isAdminEmail(email: string): boolean {
  return isRootAdminEmail(email) || isHRAdminEmail(email);
}
