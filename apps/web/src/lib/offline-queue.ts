/**
 * Antrean catatan pemeriksaan di perangkat saat offline. Hanya pemeriksaan fisik yang boleh offline;
 * server tetap memvalidasi setiap catatan saat sinkronisasi (tidak ada keputusan final dari data offline).
 */
export interface QueuedScan {
  clientId: string;
  clientRecordedAt: string;
  code: string;
  foundLocationId: string | null;
  foundCondition: string | null;
  notes: string | null;
  /** Diisi setelah sinkronisasi gagal agar dapat ditinjau pengguna. */
  conflict?: string;
}

const key = (opnameId: string) => `sima:opname-queue:${opnameId}`;

export function readQueue(opnameId: string): QueuedScan[] {
  try {
    const raw = localStorage.getItem(key(opnameId));
    return raw ? (JSON.parse(raw) as QueuedScan[]) : [];
  } catch {
    return [];
  }
}

export function writeQueue(opnameId: string, items: QueuedScan[]): boolean {
  try {
    if (items.length) localStorage.setItem(key(opnameId), JSON.stringify(items));
    else localStorage.removeItem(key(opnameId));
    return true;
  } catch {
    return false; // penyimpanan penuh atau diblokir (mode privat)
  }
}
