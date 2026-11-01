import type { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { APPROVAL_ENTITY_LABEL, APPROVAL_MODULE, ROLE_CODES, approvalEntityPath, type ApprovalEntityType } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { lockRows } from '../../lib/doc';
import type { AuthContext } from '../../plugins/auth';
import { notify, usersWithPermission } from '../notifications/service';

type Tx = Prisma.TransactionClient;

export interface DecisionContext {
  entityId: string;
  actorId: string;
  note: string | null;
  req: FastifyRequest | null;
}

/** Efek bisnis saat dokumen disetujui/ditolak. Dijalankan di transaksi yang sama dengan keputusan. */
export interface ApprovalHandler {
  creatorId(tx: Tx, entityId: string): Promise<string | null>;
  onApproved(tx: Tx, ctx: DecisionContext): Promise<void>;
  onRejected(tx: Tx, ctx: DecisionContext): Promise<void>;
}

const handlers = new Map<ApprovalEntityType, ApprovalHandler>();
export const registerApprovalHandler = (type: ApprovalEntityType, h: ApprovalHandler) => void handlers.set(type, h);

const APPROVER_ROLE = ROLE_CODES.APPROVER;

export async function submitForApproval(
  tx: Tx, req: FastifyRequest | null,
  input: { entityType: ApprovalEntityType; entityId: string; documentNumber: string; title: string; requestedById: string },
) {
  const open = await tx.approvalRequest.findFirst({ where: { entityType: input.entityType, entityId: input.entityId, status: 'PENDING' } });
  if (open) throw conflict('Dokumen ini sudah diajukan dan menunggu persetujuan');
  const role = await tx.role.findUniqueOrThrow({ where: { code: APPROVER_ROLE } });
  const request = await tx.approvalRequest.create({
    data: {
      entityType: input.entityType, entityId: input.entityId, documentNumber: input.documentNumber, title: input.title, requestedById: input.requestedById,
      steps: { create: [{ stepOrder: 1, roleId: role.id }] },
      actions: { create: [{ actorId: input.requestedById, action: 'SUBMIT' }] },
    },
  });
  const module = APPROVAL_MODULE[input.entityType];
  const approvers = await usersWithPermission(tx, `${module}.approve`, { roleCodes: [APPROVER_ROLE, ROLE_CODES.SUPER_ADMIN], excludeUserId: input.requestedById });
  await notify(tx, approvers, {
    type: 'approval.requested', title: `Persetujuan diperlukan: ${APPROVAL_ENTITY_LABEL[input.entityType]} ${input.documentNumber}`, body: input.title,
    entityType: input.entityType, entityId: input.entityId,
  });
  await writeAudit(tx, req, { action: 'APPROVAL_SUBMIT', entityType: input.entityType, entityId: input.entityId, after: { approvalRequestId: request.id, documentNumber: input.documentNumber } });
  return request;
}

/** Apakah pengguna berwenang memutuskan langkah aktif (peran + permission modul), tanpa memeriksa pemisahan tugas. */
export function isEligible(auth: AuthContext, entityType: ApprovalEntityType, stepRoleCode: string, action: 'approve' | 'reject' = 'approve') {
  const roleOk = auth.roleCodes.has(stepRoleCode) || auth.roleCodes.has(ROLE_CODES.SUPER_ADMIN);
  return roleOk && auth.permissions.has(`${APPROVAL_MODULE[entityType]}.${action}`);
}

export async function decide(
  tx: Tx, req: FastifyRequest | null,
  input: { requestId: string; actor: AuthContext; decision: 'APPROVE' | 'REJECT'; note: string | null },
) {
  await lockRows(tx, 'approval_requests', [input.requestId]);
  const request = await tx.approvalRequest.findUnique({ where: { id: input.requestId }, include: { steps: { include: { role: true }, orderBy: { stepOrder: 'asc' } } } });
  if (!request) throw notFound('Permintaan persetujuan tidak ditemukan');
  if (request.status !== 'PENDING') throw conflict('Permintaan ini sudah diputuskan');
  const step = request.steps.find((s) => s.stepOrder === request.currentStep && s.status === 'PENDING');
  if (!step) throw conflict('Tidak ada langkah persetujuan yang menunggu');

  const entityType = request.entityType as ApprovalEntityType;
  const handler = handlers.get(entityType);
  if (!handler) throw new AppError(500, `Handler persetujuan ${entityType} belum terdaftar`);

  const verb = input.decision === 'APPROVE' ? 'approve' : 'reject';
  if (!isEligible(input.actor, entityType, step.role.code, verb)) throw forbidden('Anda tidak berwenang memutuskan persetujuan ini');

  // Pemisahan tugas: pengaju maupun pembuat dokumen tidak boleh memutuskan dokumennya sendiri.
  const creatorId = await handler.creatorId(tx, request.entityId);
  if (input.actor.user.id === request.requestedById || input.actor.user.id === creatorId) {
    throw forbidden('Anda tidak dapat menyetujui atau menolak transaksi yang Anda buat sendiri');
  }

  const approved = input.decision === 'APPROVE';
  await tx.approvalStep.update({ where: { id: step.id }, data: { status: approved ? 'APPROVED' : 'REJECTED', actedById: input.actor.user.id, actedAt: new Date(), note: input.note } });
  await tx.approvalAction.create({ data: { requestId: request.id, stepId: step.id, actorId: input.actor.user.id, action: input.decision, note: input.note } });

  const lastStep = request.steps.every((s) => s.id === step.id || s.status === 'APPROVED');
  const done = !approved || lastStep;
  if (done) {
    await tx.approvalRequest.update({ where: { id: request.id }, data: { status: approved ? 'APPROVED' : 'REJECTED', completedAt: new Date() } });
    const ctx: DecisionContext = { entityId: request.entityId, actorId: input.actor.user.id, note: input.note, req };
    if (approved) await handler.onApproved(tx, ctx);
    else await handler.onRejected(tx, ctx);
  } else {
    await tx.approvalRequest.update({ where: { id: request.id }, data: { currentStep: request.currentStep + 1 } });
  }

  await writeAudit(tx, req, {
    action: approved ? 'APPROVE' : 'REJECT', entityType, entityId: request.entityId,
    after: { approvalRequestId: request.id, documentNumber: request.documentNumber, note: input.note }, userId: input.actor.user.id,
  });
  const recipients = [...new Set([request.requestedById, creatorId].filter(Boolean) as string[])].filter((id) => id !== input.actor.user.id);
  await notify(tx, recipients, {
    type: approved ? 'approval.approved' : 'approval.rejected',
    title: `${APPROVAL_ENTITY_LABEL[entityType]} ${request.documentNumber} ${approved ? 'disetujui' : 'ditolak'}`,
    body: input.note, entityType, entityId: request.entityId,
  });
  return request.id;
}

/** Tarik pengajuan yang menunggu (misalnya dokumen dibatalkan pembuatnya). */
export async function cancelPendingApproval(tx: Tx, entityType: ApprovalEntityType, entityId: string) {
  await tx.approvalRequest.updateMany({ where: { entityType, entityId, status: 'PENDING' }, data: { status: 'CANCELLED', completedAt: new Date() } });
}

export async function approvalTimeline(entityType: ApprovalEntityType, entityId: string) {
  const request = await prisma.approvalRequest.findFirst({
    where: { entityType, entityId }, orderBy: { submittedAt: 'desc' },
    include: { steps: { include: { role: { select: { name: true } } }, orderBy: { stepOrder: 'asc' } }, actions: { orderBy: { createdAt: 'asc' } } },
  });
  if (!request) return null;
  const ids = [...new Set([request.requestedById, ...request.actions.map((a) => a.actorId), ...request.steps.map((s) => s.actedById).filter(Boolean) as string[]])];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return {
    id: request.id, status: request.status, submittedAt: request.submittedAt, completedAt: request.completedAt, requestedBy: name.get(request.requestedById) ?? '-',
    steps: request.steps.map((s) => ({ order: s.stepOrder, role: s.role.name, status: s.status, actedBy: s.actedById ? name.get(s.actedById) ?? '-' : null, actedAt: s.actedAt, note: s.note })),
    actions: request.actions.map((a) => ({ action: a.action, actor: name.get(a.actorId) ?? '-', note: a.note, createdAt: a.createdAt })),
  };
}

export { approvalEntityPath };
