# SIMA, Sistem Informasi Manajemen Inventaris Barang

Aplikasi inventaris internal satu instansi: barang inventaris individual (QR Code per unit) dan barang persediaan (stock ledger), dengan approval workflow dan audit log.
Spesifikasi lengkap ada di PRD/SRS; status pengerjaan ada di [`docs/STATUS.md`](docs/STATUS.md). Arah desain: [`DESIGN.md`](DESIGN.md).

## Prasyarat

- Node.js 22+
- pnpm 10+ (`corepack enable`)
- Docker (untuk PostgreSQL), atau PostgreSQL 16 sendiri yang sesuai `DATABASE_URL`

## Menjalankan untuk pengembangan

```bash
pnpm install
pnpm dev
```

`pnpm dev` melakukan semuanya sekaligus:

1. membuat `.env` dari `.env.example` bila belum ada (`SESSION_SECRET` diacak),
2. menyalakan PostgreSQL lewat Docker Compose (atau memakai database yang sudah menyala di `DATABASE_URL`),
3. build paket shared, `prisma generate`, `prisma migrate deploy`, seed,
4. menjalankan shared (watch), API (`:3001`), dan web (`:5173`).

Web: <http://localhost:5173> · Health API: <http://localhost:3001/api/v1/health>
Login awal: `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` dari `.env`. Ganti segera.

## Perintah

| Perintah | Fungsi |
|---|---|
| `pnpm dev` | Seluruh lingkungan lokal |
| `pnpm test` | Test otomatis (butuh database `*_test`, lihat `.env.test`) |
| `pnpm typecheck` | Typecheck semua paket |
| `pnpm build` | Build produksi |
| `pnpm db:up` / `db:down` | Nyalakan/hentikan PostgreSQL (Docker) |
| `pnpm db:migrate` | Buat migrasi baru saat mengubah `schema.prisma` |
| `pnpm db:seed` | Seed ulang (idempoten) |
| `pnpm db:reset` | Hapus dan bangun ulang database lokal |

### E2E browser

Skrip di `e2e/` memakai Playwright (Chromium). Jalankan stack (`pnpm dev`) di atas database **kosong yang baru di-seed**, lalu (jalankan API dengan `LOGIN_RATE_LIMIT_PER_MIN=1000` karena E2E login berulang):

```bash
node e2e/tahap2.cjs   # autentikasi, pengguna, role, master data
node e2e/tahap3.cjs   # barang, aset, QR, foto, persediaan, scan (butuh ffmpeg untuk kamera palsu)
node e2e/tahap4.cjs   # pengadaan, penerimaan, approval, mutasi, peminjaman, penyesuaian, notifikasi (3 pengguna)
node e2e/tahap5.cjs   # pemeliharaan, penghapusan, stock opname (kamera palsu, offline, verifikasi)
```

### Database test

`pnpm test` memakai `.env.test` (tidak di-commit). Buat dari `.env` dengan nama database berakhiran `_test`:

```bash
sed 's#/sima?#/sima_test?#' .env > .env.test
createdb -h localhost -U sima sima_test   # sekali saja
```

Test menolak berjalan pada database yang namanya tidak mengandung `_test`.

## Struktur

```
apps/api         Fastify + Prisma (modular monolith, /api/v1)
apps/web         React + Vite + Tailwind
packages/shared  Permission, role, tipe respons, skema Zod bersama
scripts          dev.mjs, db.mjs
docs             Dokumentasi
```
