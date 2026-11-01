import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Penomoran atomik: satu UPSERT menaikkan counter dan mengunci barisnya sampai transaksi
 * selesai, sehingga dua permintaan serentak tidak pernah mendapat nomor yang sama.
 */
export async function nextSequence(tx: Tx, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO document_sequences ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = document_sequences."value" + 1
    RETURNING "value"`;
  return rows[0]!.value;
}

export const pad = (n: number, width = 6) => String(n).padStart(width, '0');

/** Nomor dokumen per tahun, contoh: BM-2026-0001. */
export async function nextDocNumber(tx: Tx, prefix: string, date = new Date()) {
  const year = date.getFullYear();
  return `${prefix}-${year}-${pad(await nextSequence(tx, `${prefix}-${year}`), 4)}`;
}
