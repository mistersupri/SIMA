import { z } from 'zod';

const boolean = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET minimal 32 karakter'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: boolean.default(false),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  LOGIN_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  ORG_CODE: z.string().default('INSTANSI'),
  ORG_NAME: z.string().default('Nama Instansi'),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().default('admin@sima.local'),
  BOOTSTRAP_ADMIN_NAME: z.string().default('Super Admin'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(10).optional(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Konfigurasi environment tidak valid:\n${detail}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (!env.COOKIE_SECURE) {
      throw new Error('COOKIE_SECURE harus true pada produksi (HTTPS).');
    }
    if (env.SESSION_SECRET.startsWith('ganti-dengan')) {
      throw new Error('SESSION_SECRET masih berisi nilai contoh.');
    }
  }
  return env;
}
