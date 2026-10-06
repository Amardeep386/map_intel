// A small in-memory SFTP server for tests and the P3 exit test (ssh2). Password login, one user, files in a Map.
import { posix } from 'node:path';
import ssh2 from 'ssh2';

const { Server, utils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;

export interface TestSftp {
  port: number;
  hostKeyFingerprint: string;
  files: Map<string, Buffer>;
  close: () => Promise<void>;
}

export async function startSftp(user: string, password: string, fingerprintOf: (key: Buffer) => string): Promise<TestSftp> {
  const keys = utils.generateKeyPairSync('ed25519');
  const hostKey = utils.parseKey(keys.private);
  if (hostKey instanceof Error) throw hostKey;
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>(['/']);
  const norm = (p: string) => posix.normalize(posix.isAbsolute(p) ? p : `/${p}`).replace(/\/$/, '') || '/';

  const server = new Server({ hostKeys: [keys.private] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === user && ctx.password === password) ctx.accept();
      else ctx.reject(['password']);
    });
    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession();
        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map<number, { path: string; dir?: boolean; listed?: boolean }>();
          let next = 0;
          const handle = (h: Buffer) => handles.get(h.readUInt32BE(0));
          const newHandle = (v: { path: string; dir?: boolean }) => {
            const id = next++;
            handles.set(id, v);
            const b = Buffer.alloc(4);
            b.writeUInt32BE(id, 0);
            return b;
          };
          const attrs = (p: string) => {
            const isDir = dirs.has(p);
            const size = files.get(p)?.length ?? 0;
            return { mode: isDir ? 0o40755 : 0o100644, size, uid: 0, gid: 0, atime: 0, mtime: 0 };
          };
          const stat = (reqid: number, raw: string) => {
            const p = norm(raw);
            if (files.has(p) || dirs.has(p)) sftp.attrs(reqid, attrs(p));
            else sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
          };
          sftp.on('REALPATH', (reqid, raw) => sftp.name(reqid, [{ filename: norm(raw), longname: norm(raw), attrs: attrs(norm(raw)) }]));
          sftp.on('STAT', stat);
          sftp.on('LSTAT', stat);
          sftp.on('FSTAT', (reqid, h) => { const x = handle(h); if (x) sftp.attrs(reqid, attrs(x.path)); else sftp.status(reqid, STATUS_CODE.FAILURE); });
          sftp.on('MKDIR', (reqid, raw) => { dirs.add(norm(raw)); sftp.status(reqid, STATUS_CODE.OK); });
          sftp.on('OPEN', (reqid, raw, flags) => {
            const p = norm(raw);
            if (flags & OPEN_MODE.WRITE) {
              if (!dirs.has(posix.dirname(p))) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
              if (flags & OPEN_MODE.TRUNC || !files.has(p)) files.set(p, Buffer.alloc(0));
            } else if (!files.has(p)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            sftp.handle(reqid, newHandle({ path: p }));
          });
          sftp.on('WRITE', (reqid, h, offset, data) => {
            const x = handle(h);
            if (!x) return sftp.status(reqid, STATUS_CODE.FAILURE);
            const cur = files.get(x.path) ?? Buffer.alloc(0);
            const out = Buffer.alloc(Math.max(cur.length, offset + data.length));
            cur.copy(out);
            data.copy(out, offset);
            files.set(x.path, out);
            sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on('READ', (reqid, h, offset, length) => {
            const x = handle(h);
            const buf = x ? files.get(x.path) : undefined;
            if (!buf) return sftp.status(reqid, STATUS_CODE.FAILURE);
            if (offset >= buf.length) return sftp.status(reqid, STATUS_CODE.EOF);
            sftp.data(reqid, buf.subarray(offset, offset + length));
          });
          sftp.on('OPENDIR', (reqid, raw) => {
            const p = norm(raw);
            if (!dirs.has(p)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            sftp.handle(reqid, newHandle({ path: p, dir: true }));
          });
          sftp.on('READDIR', (reqid, h) => {
            const x = handle(h);
            if (!x || x.listed) return sftp.status(reqid, STATUS_CODE.EOF);
            x.listed = true;
            const names = [...files.keys(), ...dirs].filter((f) => f !== x.path && posix.dirname(f) === x.path);
            if (!names.length) return sftp.status(reqid, STATUS_CODE.EOF);
            sftp.name(reqid, names.map((f) => ({ filename: posix.basename(f), longname: posix.basename(f), attrs: attrs(f) })));
          });
          sftp.on('REMOVE', (reqid, raw) => { files.delete(norm(raw)); sftp.status(reqid, STATUS_CODE.OK); });
          sftp.on('CLOSE', (reqid, h) => { handles.delete(h.readUInt32BE(0)); sftp.status(reqid, STATUS_CODE.OK); });
        });
      });
    });
    client.on('error', () => undefined);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    hostKeyFingerprint: fingerprintOf(hostKey.getPublicSSH() as Buffer),
    files,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
