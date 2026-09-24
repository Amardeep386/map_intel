// The API must never use the owner connection: request work goes through withTenant / withApi,
// which connect as mapintel_api so row-level security is enforced by Postgres.   npm test
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/api');

async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? tsFiles(path.join(dir, e.name)) : Promise.resolve(e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []))),
  );
  return nested.flat();
}

test('no API file uses withSystem or the owner pool', async () => {
  for (const file of await tsFiles(apiDir)) {
    const src = await readFile(file, 'utf8');
    assert.doesNotMatch(src, /\bwithSystem\b|\bpool\(\)/, path.relative(apiDir, file));
  }
});
