import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { hashPassword } from '../src/lib/password';
import { db } from './helpers';

let app: FastifyInstance | undefined;
export async function getApp() {
  app ??= await buildApp(loadEnv());
  await app.ready();
  return app;
}

export interface Session {
  cookie: string;
  csrf: string;
}

export interface CallOptions {
  session?: Session;
  body?: unknown;
  /** Kirim tanpa header CSRF walau ada session (untuk menguji penolakan). */
  skipCsrf?: boolean;
  headers?: Record<string, string>;
}

export async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, opts: CallOptions = {}) {
  const a = await getApp();
  const headers: Record<string, string> = {};
  if (opts.session) {
    headers.cookie = opts.session.cookie;
    if (!opts.skipCsrf) headers['x-csrf-token'] = opts.session.csrf;
  }
  Object.assign(headers, opts.headers);
  const res = await a.inject({ method, url: `/api/v1${url}`, headers, payload: opts.body as object | undefined });
  let json: any = null;
  try { json = res.json(); } catch { /* respons tanpa body */ }
  return { status: res.statusCode, body: json, res };
}

export const TEST_PASSWORD = 'Sandi-Uji-12345';

export async function seedBase() {
  const { execSync } = await import('node:child_process');
  execSync('pnpm exec tsx prisma/seed.ts', { env: process.env, stdio: 'pipe' });
}

let n = 0;
export async function makeUser(roleCode: string, overrides: { password?: string; mustChangePassword?: boolean; status?: 'ACTIVE' | 'INACTIVE'; email?: string } = {}) {
  const org = await db.organization.findFirstOrThrow();
  const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
  const email = overrides.email ?? `user${Date.now()}${n++}@uji.test`;
  const user = await db.user.create({
    data: {
      organizationId: org.id, email, name: `Uji ${roleCode}`,
      passwordHash: await hashPassword(overrides.password ?? TEST_PASSWORD),
      mustChangePassword: overrides.mustChangePassword ?? false,
      status: overrides.status ?? 'ACTIVE',
      roles: { create: { roleId: role.id } },
    },
  });
  return { user, email, password: overrides.password ?? TEST_PASSWORD };
}

export async function login(email: string, password: string): Promise<Session> {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login gagal (${r.status}): ${JSON.stringify(r.body)}`);
  const cookie = r.res.cookies.find((c) => c.name === 'sima_sid')!;
  return { cookie: `sima_sid=${cookie.value}`, csrf: r.body.data.csrfToken };
}

export async function sessionFor(roleCode: string, o: Parameters<typeof makeUser>[1] = {}) {
  const u = await makeUser(roleCode, o);
  return { ...u, session: await login(u.email, u.password) };
}
