import { readFileSync } from 'node:fs';

export interface GoogleCredentialMetadata {
  type: string;
  clientEmail: string | null;
}

interface ValidateGoogleCredentialOptions {
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
}

export function parseGoogleCredentialMetadata(contents: string): GoogleCredentialMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('Google credential file is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Google credential file must contain a JSON object');
  }

  const credential = parsed as Record<string, unknown>;
  const type = typeof credential.type === 'string' ? credential.type.trim() : '';
  if (!type) {
    throw new Error('Google credential file is missing its credential type');
  }

  return {
    type,
    clientEmail: typeof credential.client_email === 'string'
      ? credential.client_email.trim() || null
      : null,
  };
}

export function validateGoogleCredentialFile(
  options: ValidateGoogleCredentialOptions = {},
): GoogleCredentialMetadata {
  const env = options.env ?? process.env;
  const credentialPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!credentialPath) {
    throw new Error('Missing required Google configuration: GOOGLE_APPLICATION_CREDENTIALS');
  }

  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  let contents: string;
  try {
    contents = readFile(credentialPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read Google credential file: ${message}`);
  }

  const metadata = parseGoogleCredentialMetadata(contents);
  if (env.NODE_ENV === 'production' && metadata.type !== 'service_account') {
    throw new Error(
      `Production sync must use a Google service account; received credential type "${metadata.type}"`,
    );
  }

  if (metadata.type === 'service_account' && !metadata.clientEmail) {
    throw new Error('Google service account credential is missing client_email');
  }

  return metadata;
}
