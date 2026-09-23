import { config } from '../lib/config.js';
import { closeDb } from '../lib/db.js';
import { buildApp } from './app.js';

const app = await buildApp();

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  });
}
