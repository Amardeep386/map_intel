import 'dotenv/config';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number.parseInt(v, 10)));

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: int(4000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  // Where the portal lives; invite links point here.
  PORTAL_URL: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // The API's own login role (mapintel_api, no BYPASSRLS). Required in production; in development
  // the API falls back to DATABASE_URL with a warning.
  DATABASE_URL_API: z.string().optional(),
  DATABASE_SSL: bool(false),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('mapintel-evidence'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(true),
  S3_OBJECT_LOCK_DAYS: int(0),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_TTL_HOURS: int(12),
  // MFA (Phase 5): key that seals authenticator secrets (32 bytes, base64). Without it a key is derived
  // from JWT_SECRET, so changing JWT_SECRET would then make every user set MFA up again.
  MFA_KEY: z.string().optional(),
  // Require MFA of every Mirethos platform administrator (on top of each account's own setting).
  PLATFORM_MFA_REQUIRED: bool(false),

  // Credential vault: comma-separated `id:base64key` pairs (32-byte keys) and the id used for new secrets.
  // Old keys stay listed so existing secrets still decrypt after a key change.
  VAULT_KEYS: z.string().optional(),
  VAULT_ACTIVE_KEY: z.string().optional(),

  SEED_ADMIN_EMAIL: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(12, 'SEED_ADMIN_PASSWORD must be at least 12 characters').optional(),
  SEED_ADMIN_NAME: z.string().default('Mirethos Operations'),

  COLLECT_MIN_DELAY_MS: int(15000),
  COLLECT_JITTER_MS: int(5000),
  COLLECT_RESPECT_ROBOTS: bool(true),
  COLLECT_BROWSER_FALLBACK: bool(true),
  COLLECT_EGRESS_LABEL: z.string().default('local'),
  COLLECT_USER_AGENT: z
    .string()
    .default(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    ),
  BESTBUY_API_KEY: z.string().optional(),
  // eBay Browse API (OAuth client credentials). Off until both are set.
  EBAY_CLIENT_ID: z.string().trim().optional(),
  EBAY_CLIENT_SECRET: z.string().trim().optional(),
  // eBay Marketplace Account Deletion endpoint (decision 39): the token and the exact endpoint URL
  // entered on developer.ebay.com → Alerts & Notifications. The endpoint answers 503 until both are set.
  EBAY_VERIFICATION_TOKEN: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{32,80}$/, 'EBAY_VERIFICATION_TOKEN: 32–80 letters, digits, _ or -')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  EBAY_DELETION_ENDPOINT: z.string().trim().url().optional().or(z.literal('').transform(() => undefined)),
  // Optional US proxy for all collector traffic (http://user:pass@host:port). Off when empty.
  COLLECT_HTTPS_PROXY: z.string().optional(),
  // Worker: concurrent jobs per source queue (headless pages are heavy on a 512 MB instance).
  COLLECT_CONCURRENCY: int(1),
  // Headless pages open at once in this process, across all sources (memory: ~100-150 MB each).
  COLLECT_BROWSER_PAGES: int(1),
  // How often the scheduler looks for schedules that are due (minutes).
  SCHEDULER_TICK_MINUTES: int(5),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid configuration (check server/.env):\n${issues}`);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
