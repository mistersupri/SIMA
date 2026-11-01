import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import { prisma } from '../lib/prisma';
import { forbidden, unauthorized, AppError } from '../lib/errors';
import type { SessionUser } from '@sima/shared';

export const SESSION_COOKIE = 'sima_sid';
export const CSRF_HEADER = 'x-csrf-token';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export interface AuthContext {
  user: SessionUser;
  sessionId: string;
  csrfToken: string;
  permissions: Set<string>;
  roleCodes: Set<string>;
  /** Unit yang diizinkan lewat user_unit_access. Kosong berarti tanpa pembatasan unit. */
  unitAccess: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
  interface FastifyInstance {
    config: Env;
  }
  interface FastifyContextConfig {
    /** Izinkan endpoint ini saat pengguna wajib mengganti password. */
    allowPasswordChange?: boolean;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function setSessionCookie(reply: FastifyReply, env: Env, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(env.SESSION_TTL_HOURS * 3600),
  });
}

export function clearSessionCookie(reply: FastifyReply, env: Env) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax' });
}

export async function createSession(env: Env, userId: string, req: FastifyRequest) {
  const token = newToken();
  const csrfToken = newToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      csrfToken,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 300),
      expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3600 * 1000),
    },
  });
  return { token, csrfToken };
}

export async function revokeUserSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

export async function loadAuth(req: FastifyRequest): Promise<AuthContext | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          unitAccess: true,
        },
      },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.user.status !== 'ACTIVE') return null;

  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    void prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }

  const permissions = new Set<string>();
  for (const ur of session.user.roles) for (const rp of ur.role.permissions) permissions.add(rp.permission.code);

  const u = session.user;
  return {
    sessionId: session.id,
    csrfToken: session.csrfToken,
    permissions,
    roleCodes: new Set(u.roles.map((r) => r.role.code)),
    unitAccess: u.unitAccess.map((a) => a.unitId),
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      unitId: u.unitId,
      mustChangePassword: u.mustChangePassword,
      roles: u.roles.map((r) => ({ code: r.role.code, name: r.role.name })),
      permissions: [...permissions].sort(),
    },
  };
}

function csrfValid(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** preHandler: wajib login, CSRF untuk method yang mengubah data, blokir bila wajib ganti password. */
export async function authenticate(req: FastifyRequest) {
  const auth = await loadAuth(req);
  if (!auth) throw unauthorized();

  if (!SAFE_METHODS.has(req.method) && !csrfValid(auth.csrfToken, req.headers[CSRF_HEADER])) {
    throw new AppError(403, 'Token CSRF tidak valid', 'CSRF_INVALID');
  }
  if (auth.user.mustChangePassword && !req.routeOptions.config.allowPasswordChange) {
    throw new AppError(403, 'Anda harus mengganti password terlebih dahulu', 'PASSWORD_CHANGE_REQUIRED');
  }
  req.auth = auth;
}

/** preHandler: pengguna harus memiliki SEMUA permission yang disebutkan (diperiksa di server). */
export function requirePermission(...codes: string[]) {
  return [
    authenticate,
    async (req: FastifyRequest) => {
      const have = req.auth!.permissions;
      if (!codes.every((c) => have.has(c))) throw forbidden();
    },
  ];
}

export function currentUser(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export async function authPlugin(app: FastifyInstance, env: Env) {
  app.decorate('config', env);
  app.decorateRequest('auth', undefined);
}
