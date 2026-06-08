import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const oracleSource = readFileSync(new URL('../lib/oracle.ts', import.meta.url), 'utf8');

test('Duo daily reconciliation treats ActivTrak IP activity as ActivTrak evidence', () => {
  assert.match(
    oracleSource,
    /CASE WHEN p\.EMAIL IS NULL AND a\.EMAIL IS NULL THEN 0 ELSE 1 END AS HAS_ACTIVTRAK_DAY/,
  );
  assert.match(
    oracleSource,
    /WHEN NVL\(d\.DUO_LOGIN_COUNT, 0\) > 0 AND \(p\.EMAIL IS NOT NULL OR a\.EMAIL IS NOT NULL\) THEN 'Matched'/,
  );
  assert.match(
    oracleSource,
    /NVL\(d\.DUO_LOGIN_COUNT, 0\) > 0 AND p\.EMAIL IS NULL AND a\.EMAIL IS NULL THEN 1/,
  );
});

test('Duo device reconciliation deduplicates ActivTrak identifier emails before joining', () => {
  assert.match(
    oracleSource,
    /WITH identifier_emails AS \(\s*SELECT LOWER\(IDENTIFIER_EMAIL\) AS IDENTIFIER_EMAIL\s*FROM TL_ACTIVTRAK_IDENTIFIERS\s*GROUP BY LOWER\(IDENTIFIER_EMAIL\)/,
  );
  assert.match(
    oracleSource,
    /LEFT JOIN identifier_emails ids\s*ON ids\.IDENTIFIER_EMAIL = LOWER\(NVL\(duo\.EMAIL, duo\.USERNAME\)\)/,
  );
});
