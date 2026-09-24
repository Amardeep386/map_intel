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
