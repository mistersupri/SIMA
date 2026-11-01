import type { FastifyInstance } from 'fastify';
import {
  changePasswordSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema, type AuthPayload,
} from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok } from '../../lib/respond';
import { AppError, badRequest, unauthorized } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import { writeActivity, writeAudit } from '../../lib/audit';
import {
  SESSION_COOKIE, authenticate, clearSessionCookie, createSession, currentUser, hashToken, newToken,
  revokeUserSessions, setSessionCookie, loadAuth,
} from '../../plugins/auth';

// Hash tiruan agar waktu respons sama untuk email yang tidak ada (anti user enumeration).
const dummyHash = hashPassword('dummy-password-for-timing');

export async function authRoutes(app: FastifyInstance) {
  const env = app.config;
  const loginLimit = env.LOGIN_RATE_LIMIT_PER_MIN;

  app.post('/auth/login', { config: { rateLimit: { max: loginLimit, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      await verifyPassword(await dummyHash, password);
      await writeActivity(prisma, req, 'auth.login_failed', { metadata: { email, reason: 'unknown_user' } });
      throw unauthorized('Email atau password salah');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new AppError(429, `Akun terkunci sementara. Coba lagi dalam ${minutes} menit`, 'ACCOUNT_LOCKED');
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      const attempts = user.failedLoginCount + 1;
      const lock = attempts >= env.LOGIN_MAX_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : attempts,
          lockedUntil: lock ? new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60000) : null,
        },
      });
      await writeActivity(prisma, req, 'auth.login_failed', { userId: user.id, metadata: { reason: 'bad_password', locked: lock } });
      throw unauthorized('Email atau password salah');
    }
    if (user.status !== 'ACTIVE') throw new AppError(403, 'Akun Anda dinonaktifkan. Hubungi administrator', 'ACCOUNT_INACTIVE');

    // Rotasi session: cabut session lama yang dibawa browser sebelum membuat yang baru.
    const old = req.cookies[SESSION_COOKIE];
    if (old) await prisma.session.updateMany({ where: { tokenHash: hashToken(old), revokedAt: null }, data: { revokedAt: new Date() } });

    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const { token } = await createSession(env, user.id, req);
    setSessionCookie(reply, env, token);
    await writeActivity(prisma, req, 'auth.login', { userId: user.id });
    await writeAudit(prisma, req, { action: 'LOGIN', entityType: 'User', entityId: user.id, userId: user.id });

    // Cookie baru belum ada di request ini, jadi muat konteks langsung dari token.
    req.cookies[SESSION_COOKIE] = token;
    const auth = await loadAuth(req);
    return ok<AuthPayload>({ user: auth!.user, csrfToken: auth!.csrfToken }, 'Login berhasil');
  });

  app.post('/auth/logout', { config: { allowPasswordChange: true }, preHandler: authenticate }, async (req, reply) => {
    const auth = currentUser(req);
    await prisma.session.update({ where: { id: auth.sessionId }, data: { revokedAt: new Date() } });
    await writeAudit(prisma, req, { action: 'LOGOUT', entityType: 'User', entityId: auth.user.id });
    clearSessionCookie(reply, env);
    return ok(null, 'Anda telah keluar');
  });

  app.get('/auth/me', { config: { allowPasswordChange: true }, preHandler: authenticate }, async (req) => {
    const auth = currentUser(req);
    return ok<AuthPayload>({ user: auth.user, csrfToken: auth.csrfToken });
  });

  app.post('/auth/change-password', { config: { allowPasswordChange: true }, preHandler: authenticate }, async (req) => {
    const auth = currentUser(req);
    const input = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw badRequest('Validasi gagal', [{ field: 'currentPassword', message: 'Password saat ini salah' }]);
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
      });
      await writeAudit(tx, req, { action: 'PASSWORD_CHANGE', entityType: 'User', entityId: user.id });
    });
    await revokeUserSessions(user.id, auth.sessionId);
    return ok(null, 'Password berhasil diganti');
  });

  app.post('/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.status === 'ACTIVE') {
      const token = newToken();
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      await writeActivity(prisma, req, 'auth.forgot_password', { userId: user.id });
      // Belum ada pengiriman email. Token hanya dicatat di log pada non-produksi untuk keperluan uji.
      // Di produksi, administrator memakai POST /users/:id/reset-password.
      if (env.NODE_ENV !== 'production') req.log.warn({ resetToken: token, email }, 'token reset password (hanya non-produksi)');
    }
    // Respons identik apa pun hasilnya, agar tidak membocorkan email terdaftar.
    return ok(null, 'Jika email terdaftar, instruksi reset telah diproses. Hubungi administrator bila tidak menerima apa pun.');
  });

  app.post('/auth/reset-password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const input = resetPasswordSchema.parse(req.body);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(input.token) } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) throw badRequest('Token reset tidak valid atau sudah kedaluwarsa');
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      await writeAudit(tx, req, { action: 'PASSWORD_RESET', entityType: 'User', entityId: record.userId, userId: record.userId });
    });
    await revokeUserSessions(record.userId);
    return ok(null, 'Password berhasil direset. Silakan login.');
  });
}
