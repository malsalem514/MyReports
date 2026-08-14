import assert from 'node:assert/strict';
import test from 'node:test';
import * as credentialModule from '../lib/google-credentials.ts';

function getModuleExports<T extends object>(mod: T): T {
  return ((mod as T & { default?: T }).default ?? mod) as T;
}

const {
  parseGoogleCredentialMetadata,
  validateGoogleCredentialFile,
} = getModuleExports(credentialModule);

test('production scheduler accepts a service-account credential', () => {
  const metadata = validateGoogleCredentialFile({
    env: {
      NODE_ENV: 'production',
      GOOGLE_APPLICATION_CREDENTIALS: '/run/secrets/google-sa.json',
    },
    readFile: () => JSON.stringify({
      type: 'service_account',
      client_email: 'myreports@example.iam.gserviceaccount.com',
      private_key: 'not-read-by-validator',
    }),
  });

  assert.deepEqual(metadata, {
    type: 'service_account',
    clientEmail: 'myreports@example.iam.gserviceaccount.com',
  });
});

test('production scheduler rejects user refresh-token credentials', () => {
  assert.throws(
    () => validateGoogleCredentialFile({
      env: {
        NODE_ENV: 'production',
        GOOGLE_APPLICATION_CREDENTIALS: '/run/secrets/google-sa.json',
      },
      readFile: () => JSON.stringify({
        type: 'authorized_user',
        refresh_token: 'secret-value',
      }),
    }),
    /must use a Google service account/i,
  );
});

test('credential metadata parsing never returns private credential material', () => {
  const metadata = parseGoogleCredentialMetadata(JSON.stringify({
    type: 'service_account',
    client_email: 'myreports@example.iam.gserviceaccount.com',
    private_key: 'secret-value',
    refresh_token: 'secret-value',
  }));

  assert.deepEqual(Object.keys(metadata).sort(), ['clientEmail', 'type']);
});
