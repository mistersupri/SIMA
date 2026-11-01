import { describe, expect, it } from 'vitest';
import { extractAssetCode } from './qr-code';

describe('extractAssetCode', () => {
  it('membaca kode dari URL QR', () => {
    expect(extractAssetCode('https://inventaris.domain.go.id/q/INV-ELK-2026-000001')).toBe('INV-ELK-2026-000001');
    expect(extractAssetCode('http://localhost:5173/q/inv-elk-2026-000002?x=1')).toBe('INV-ELK-2026-000002');
  });
  it('menerima kode mentah dan merapikan huruf', () => {
    expect(extractAssetCode('  inv-fur-2026-000003 ')).toBe('INV-FUR-2026-000003');
  });
  it('menolak teks yang bukan kode aset', () => {
    expect(extractAssetCode('')).toBeNull();
    expect(extractAssetCode('halo dunia, ini bukan kode')).toBeNull();
    expect(extractAssetCode('https://contoh.com/halaman')).toBeNull();
    expect(extractAssetCode('<script>alert(1)</script>')).toBeNull();
  });
});
