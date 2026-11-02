import type { RouteInfo } from './routes';

const GROUPS: [string, string, string][] = [
  ['health', 'Kesehatan layanan', 'Pemeriksaan status API dan database.'],
  ['app-info', 'Info aplikasi', 'Nama instansi untuk halaman login (publik, tanpa data lain).'],
  ['auth', 'Autentikasi', 'Login, logout, profil, ganti dan reset password.'],
  ['users', 'Pengguna', 'Akun, status, role, akses unit, reset password oleh admin.'],
  ['roles', 'Role dan permission', 'Role standar/kustom dan penugasan permission.'],
  ['permissions', 'Role dan permission', ''],
  ['settings', 'Pengaturan', 'Identitas instansi.'],
  ['organizational-units', 'Master data', 'CRUD master: unit kerja, lokasi, kategori, satuan, merek, vendor, sumber perolehan, penanggung jawab, gudang. DELETE berarti nonaktifkan.'],
  ['locations', 'Master data', ''], ['categories', 'Master data', ''], ['units', 'Master data', ''], ['brands', 'Master data', ''],
  ['vendors', 'Master data', ''], ['funding-sources', 'Master data', ''], ['persons', 'Master data', ''], ['warehouses', 'Master data', ''],
  ['items', 'Master barang', 'Jenis barang inventaris dan persediaan; kode dibuat otomatis.'],
  ['assets', 'Aset inventaris', 'Unit aset individual, QR Code, foto, histori.'],
  ['files', 'File privat', 'File hanya dapat diunduh lewat endpoint terautentikasi.'],
  ['stocks', 'Persediaan', 'Saldo, kartu stok, barang masuk/keluar (ledger), penyesuaian stok dengan persetujuan.'],
  ['procurements', 'Pengadaan dan penerimaan', 'Dokumen pengadaan dan pencatatan penerimaan.'],
  ['goods-receipts', 'Pengadaan dan penerimaan', ''],
  ['mutations', 'Mutasi aset', 'Perpindahan aset dengan persetujuan.'],
  ['loans', 'Peminjaman', 'Peminjaman, serah terima, pengembalian.'],
  ['maintenances', 'Pemeliharaan', 'Laporan dan perbaikan aset.'],
  ['disposals', 'Penghapusan aset', 'Usulan dan finalisasi penghapusan (histori tetap).'],
  ['stock-opnames', 'Stock opname', 'Sesi pemeriksaan fisik, scan, sinkronisasi offline, verifikasi.'],
  ['approvals', 'Persetujuan', 'Daftar, riwayat, setujui, dan tolak.'],
  ['notifications', 'Notifikasi', 'Notifikasi pribadi pengguna.'],
  ['reports', 'Laporan dan dashboard', 'Dashboard dan 9 laporan (JSON, paginasi).'],
  ['exports', 'Export', 'Unduh laporan sebagai XLSX atau PDF (`?format=xlsx|pdf`).'],
  ['imports', 'Import Excel', 'Template, preview, laporan kesalahan, commit.'],
  ['audit-logs', 'Audit log', 'Catatan perubahan (hanya baca).'],
];
const ORDER = new Map(GROUPS.map(([k], i) => [k, i]));
const TITLE = new Map(GROUPS.map(([k, t]) => [k, t]));

const access = (r: RouteInfo) => (!r.auth ? 'Publik' : r.permissions.length ? r.permissions.map((p) => `\`${p}\``).join(' + ') : 'Login');

export function renderApiDocs(routes: RouteInfo[]): string {
  const sorted = [...routes].sort((a, b) => {
    const ga = a.url.split('/')[3] ?? '', gb = b.url.split('/')[3] ?? '';
    return (ORDER.get(ga) ?? 99) - (ORDER.get(gb) ?? 99) || a.url.localeCompare(b.url) || a.method.localeCompare(b.method);
  });
  const sections = new Map<string, { desc: string; rows: RouteInfo[] }>();
  for (const [key, title, desc] of GROUPS) if (!sections.has(title)) sections.set(title, { desc, rows: [] });
  for (const r of sorted) {
    const g = r.url.split('/')[3] ?? '';
    const title = TITLE.get(g) ?? g;
    if (!sections.has(title)) sections.set(title, { desc: '', rows: [] });
    sections.get(title)!.rows.push(r);
  }
  const count = routes.length;
  const lines: string[] = [
    '# Dokumentasi API SIMA',
    '',
    `> Berkas ini dibuat otomatis dari route yang terdaftar (\`pnpm docs:api\`). ${count} endpoint. Jangan diedit manual; sebuah test memastikan berkas ini selalu sama dengan route sebenarnya.`,
    '',
    '## Dasar',
    '',
    '- Base URL: `/api/v1`. Semua data dikirim dan diterima sebagai JSON (UTF-8), kecuali unggah file (`multipart/form-data`) dan unduhan (XLSX, PDF, PNG, SVG).',
    '- **Autentikasi**: session berbasis cookie `sima_sid` (HttpOnly, SameSite=Lax, Secure pada HTTPS). Login lewat `POST /auth/login`. Token session tidak pernah disimpan mentah di database.',
    '- **CSRF**: setiap request selain GET harus membawa header `x-csrf-token` berisi `csrfToken` dari respons login atau `GET /auth/me`. Tanpa token, server membalas 403.',
    '- **Otorisasi**: kolom *Akses* menunjukkan permission yang wajib dimiliki. Diperiksa di server pada setiap request; role yang dikirim klien diabaikan. "Login" berarti cukup sudah masuk.',
    '- **Format sukses**: `{ "success": true, "message": "...", "data": ..., "meta": null | { page, limit, total, totalPages } }`.',
    '- **Format gagal**: `{ "success": false, "message": "...", "errors": [{ "field": "name", "message": "..." }] }`. Kode status: 400 validasi, 401 belum login, 403 tanpa izin/CSRF salah, 404 tidak ada, 409 konflik data, 413 file terlalu besar, 422 melanggar aturan bisnis, 429 terlalu banyak permintaan.',
    '- **Daftar**: mendukung `page` (default 1), `limit` (1-100, default 20), `search`, `sortBy`, `sortOrder` (`asc|desc`), ditambah filter khusus tiap endpoint. `sortBy` hanya menerima kolom yang diizinkan; nilai lain diabaikan.',
    '- **Batas laju**: 600 permintaan/menit per sesi (per IP untuk yang belum login); login 10/menit/IP.',
    '- **Dokumen transaksi** (pengadaan, mutasi, peminjaman, pemeliharaan, penghapusan, penyesuaian stok): alur `DRAFT → PENDING_APPROVAL → APPROVED → ...`. Pengaju/pembuat tidak dapat menyetujui dokumennya sendiri; dokumen yang sudah diajukan tidak dapat diedit langsung.',
    '',
    'Contoh:',
    '',
    '```bash',
    '# login, simpan cookie, lalu baca csrfToken dari respons',
    'curl -c cookies.txt -H "content-type: application/json" \\',
    '  -d \'{"email":"admin@sima.local","password":"..."}\' https://DOMAIN/api/v1/auth/login',
    '',
    '# request yang mengubah data membawa cookie dan header CSRF',
    'curl -b cookies.txt -H "x-csrf-token: <csrfToken>" -H "content-type: application/json" \\',
    '  -d \'{"name":"Merek Baru"}\' https://DOMAIN/api/v1/brands',
    '```',
    '',
  ];
  for (const [title, sec] of sections) {
    if (!sec.rows.length) continue;
    lines.push(`## ${title}`, '');
    if (sec.desc) lines.push(sec.desc, '');
    lines.push('| Method | Path | Akses |', '|---|---|---|');
    for (const r of sec.rows) lines.push(`| ${r.method} | \`${r.url.replace('/api/v1', '')}\` | ${access(r)} |`);
    lines.push('');
  }
  return lines.join('\n');
}
