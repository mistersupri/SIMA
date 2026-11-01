import type { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { nextSequence, pad } from '../../lib/sequence';
import { writeAudit } from '../../lib/audit';

type Tx = Prisma.TransactionClient;

export const assetSnapshot = (a: { id: string; code: string; itemId: string; serialNumber: string | null; condition: string; status: string; unitId: string; locationId: string; personId: string | null; acquisitionCost: unknown; acquisitionYear: number; notes: string | null }) => ({
  id: a.id, code: a.code, itemId: a.itemId, serialNumber: a.serialNumber, condition: a.condition, status: a.status,
  unitId: a.unitId, locationId: a.locationId, personId: a.personId, acquisitionCost: String(a.acquisitionCost), acquisitionYear: a.acquisitionYear, notes: a.notes,
});

export interface CreateUnitsInput {
  item: { id: string; category: { codePrefix: string } };
  count: number;
  serials: (string | null)[];
  acquisitionDate: Date | null;
  acquisitionYear: number;
  fundingSourceId: string | null;
  vendorId: string | null;
  acquisitionCost: number | string;
  condition: 'GOOD' | 'MINOR_DAMAGE' | 'MAJOR_DAMAGE';
  unitId: string;
  locationId: string;
  personId: string | null;
  notes: string | null;
  userId: string;
  goodsReceiptDetailId?: string | null;
  note: string;
}

/** Membuat unit aset: kode atomik, histori lokasi dan kondisi awal, audit. Panggil di dalam transaksi. */
export async function createAssetUnits(tx: Tx, req: FastifyRequest | null, p: CreateUnitsInput) {
  const out = [];
  for (let i = 0; i < p.count; i++) {
    const seq = await nextSequence(tx, 'ASSET');
    const code = `INV-${p.item.category.codePrefix}-${p.acquisitionYear}-${pad(seq)}`;
    const asset = await tx.asset.create({
      data: {
        code, itemId: p.item.id, serialNumber: p.serials[i] || null, acquisitionDate: p.acquisitionDate, acquisitionYear: p.acquisitionYear,
        fundingSourceId: p.fundingSourceId, vendorId: p.vendorId, acquisitionCost: p.acquisitionCost, condition: p.condition, status: 'AVAILABLE',
        unitId: p.unitId, locationId: p.locationId, personId: p.personId, notes: p.notes, createdById: p.userId, goodsReceiptDetailId: p.goodsReceiptDetailId ?? null,
      },
      include: {
        item: { select: { id: true, code: true, name: true, category: { select: { id: true, name: true } } } },
        unit: { select: { id: true, name: true } }, location: { select: { id: true, code: true, name: true } }, person: { select: { id: true, name: true } },
      },
    });
    await tx.assetLocationHistory.create({ data: { assetId: asset.id, toLocationId: asset.locationId, toUnitId: asset.unitId, toPersonId: asset.personId, sourceType: 'REGISTRATION', sourceId: p.goodsReceiptDetailId ?? null, note: p.note, changedById: p.userId } });
    await tx.assetConditionHistory.create({ data: { assetId: asset.id, toCondition: asset.condition, toStatus: 'AVAILABLE', sourceType: 'REGISTRATION', sourceId: p.goodsReceiptDetailId ?? null, note: p.note, changedById: p.userId } });
    await writeAudit(tx, req, { action: 'CREATE', entityType: 'Asset', entityId: asset.id, after: assetSnapshot(asset), userId: p.userId });
    out.push(asset);
  }
  return out;
}
