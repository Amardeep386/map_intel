// SFTP delivery against an in-process server (no database, no network).   npm test
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { fingerprint, SftpError, testConnection, uploadFiles, type SftpLogin } from '../src/lib/sftp.js';
import { startSftp, type TestSftp } from '../src/lib/sftpTestServer.js';

let srv: TestSftp;
let login: SftpLogin;

before(async () => {
  srv = await startSftp('brand', 's3cret-pass', fingerprint);
  login = { host: '127.0.0.1', port: srv.port, username: 'brand', password: 's3cret-pass' };
});
after(() => srv.close());

test('uploads into a new folder and verifies each file by reading it back', async () => {
  const pdf = Buffer.from('%PDF-1.7 fake report body');
  const csv = Buffer.from('Violation,SKU\r\nV-00001,A1\r\n');
  const up = await uploadFiles(login, srv.hostKeyFingerprint, '/incoming/map-intel', [
    { name: 'RPT-0001.pdf', body: pdf },
    { name: 'RPT-0001.csv', body: csv },
  ]);
  assert.deepEqual(up.map((u) => [u.remotePath, u.verified]), [['/incoming/map-intel/RPT-0001.pdf', true], ['/incoming/map-intel/RPT-0001.csv', true]]);
  assert.equal(up[0].sha256, createHash('sha256').update(pdf).digest('hex'));
  assert.deepEqual(srv.files.get('/incoming/map-intel/RPT-0001.csv'), csv);
});

test('without a pinned host key nothing is written; the key seen is reported for confirmation', async () => {
  const before = srv.files.size;
  await assert.rejects(uploadFiles(login, undefined, '/x', [{ name: 'a.txt', body: Buffer.from('a') }]), (err: unknown) =>
    err instanceof SftpError && err.seenHostKey === srv.hostKeyFingerprint && /confirm/.test(err.message));
  assert.equal(srv.files.size, before);
  const t = await testConnection(login, undefined, '/x');
  assert.deepEqual([t.ok, t.hostKey], [false, srv.hostKeyFingerprint]);
});

test('a different host key is refused (no files written)', async () => {
  const wrong = `SHA256:${'A'.repeat(43)}`;
  await assert.rejects(uploadFiles(login, wrong, '/x', [{ name: 'b.txt', body: Buffer.from('b') }]), /host key changed/);
  assert.ok(![...srv.files.keys()].some((k) => k.endsWith('b.txt')));
});

test('a wrong password fails; a good test connection writes and removes its test file', async () => {
  await assert.rejects(uploadFiles({ ...login, password: 'nope' }, srv.hostKeyFingerprint, '', [{ name: 'c.txt', body: Buffer.from('c') }]), /could not connect/);
  const t = await testConnection(login, srv.hostKeyFingerprint, '/drop');
  assert.equal(t.ok, true, t.message);
  assert.ok(![...srv.files.keys()].some((k) => k.includes('.map-intel-test-')));
});
