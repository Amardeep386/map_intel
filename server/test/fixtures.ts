// Real retailer pages saved for extractor tests (gzipped). Captured by the collector's own
// fetches; the date and egress are in test/fixtures/README.md.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function fixture(name: string): string {
  return gunzipSync(readFileSync(path.join(dir, `${name}.html.gz`))).toString('utf8');
}
