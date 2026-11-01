/**
 * Mengambil kode aset dari hasil pindai QR. Isi QR berupa URL `https://host/q/KODE`,
 * tetapi kode mentah (ditempel/diketik manual) juga diterima.
 */
export function extractAssetCode(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const match = text.match(/\/q\/([^/?#\s]+)/i);
  const candidate = match ? decodeURIComponent(match[1]!) : text;
  const code = candidate.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{3,60}$/.test(code) ? code : null;
}
