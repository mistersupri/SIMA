import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';

type Client = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  userId?: string | null;
}

const toJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

const SENSITIVE = new Set(['passwordHash', 'tokenHash', 'csrfToken']);
const scrub = (v: unknown): unknown =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([k]) => !SENSITIVE.has(k)))
    : v;

/** Tulis audit log. Panggil dengan `tx` agar atomik dengan perubahan data yang dicatat. */
export async function writeAudit(client: Client, req: FastifyRequest | null, entry: AuditEntry) {
  await client.auditLog.create({
    data: {
      userId: entry.userId ?? req?.auth?.user.id ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: toJson(scrub(entry.before)),
      after: toJson(scrub(entry.after)),
      ipAddress: req?.ip ?? null,
      userAgent: req?.headers['user-agent']?.slice(0, 300) ?? null,
      requestId: req?.id ?? null,
    },
  });
}

export async function writeActivity(
  client: Client,
  req: FastifyRequest | null,
  action: string,
  extra: { userId?: string | null; entityType?: string; entityId?: string; metadata?: unknown } = {},
) {
  await client.activityLog.create({
    data: {
      userId: extra.userId ?? req?.auth?.user.id ?? null,
      action,
      entityType: extra.entityType,
      entityId: extra.entityId,
      metadata: toJson(extra.metadata),
      ipAddress: req?.ip ?? null,
    },
  });
}
