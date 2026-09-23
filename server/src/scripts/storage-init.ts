// Creates the evidence bucket (with Object Lock enabled) if it does not exist.
import { config } from '../lib/config.js';
import { ensureBucket } from '../lib/storage.js';

ensureBucket()
  .then((r) => console.log(`bucket ${config.S3_BUCKET}: ${r}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
