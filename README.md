# SIMA, Sistem Informasi Manajemen Inventaris Barang

Aplikasi inventaris internal satu instansi: barang inventaris individual (QR Code per unit) dan barang persediaan (stock ledger), dengan approval workflow dan audit log.
Spesifikasi lengkap ada di PRD/SRS. Dokumentasi:

| Dokumen | Isi |
|---|---|
| [`docs/MANUAL-PENGGUNA.md`](docs/MANUAL-PENGGUNA.md) | Panduan pengguna per peran dan alur kerja |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Deployment produksi dengan Docker + HTTPS |
| [`docs/BACKUP-RESTORE.md`](docs/BACKUP-RESTORE.md) | Backup terjadwal dan pemulihan |
| [`docs/API.md`](docs/API.md) | Dokumentasi API (dibuat otomatis dari route) |
| [`docs/KEAMANAN.md`](docs/KEAMANAN.md) | Kontrol keamanan, hasil audit dependensi, batasan |
| [`docs/FITUR.md`](docs/FITUR.md) | Daftar fitur selesai dan belum |
| [`docs/STATUS.md`](docs/STATUS.md) | Catatan pengerjaan dan pengujian per tahap |
| [`DESIGN.md`](DESIGN.md) | Arah desain antarmuka |

## Deployment produksi (ringkas)

```bash
cp .env.production.example .env      # isi semua nilai GANTI
docker compose -f docker-compose.prod.yml up -d --build
```

Caddy mengurus HTTPS otomatis; migrasi dan seed berjalan saat container API start; backup terjadwal ke `./backups`. Langkah lengkap: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

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
| `pnpm docs:api` | Buat ulang `docs/API.md` dari route (tes gagal bila file ini usang) |
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
node e2e/tahap6.cjs   # dashboard, laporan, export XLSX/PDF, audit log
node e2e/tahap7.cjs   # import Excel (template, preview, kesalahan, commit, saldo awal)
# tahap8 (pengaturan instansi + CSP produksi) juga memakai build produksi, lihat di bawah

# PWA diuji terhadap build produksi (service worker tidak aktif di dev server):
pnpm --filter @sima/web build && (cd apps/web && pnpm exec vite preview --port 4173 &)
node e2e/tahap7-pwa.cjs   # PWA offline
node e2e/tahap8.cjs       # pengaturan instansi; aplikasi dijalankan dengan CSP produksi dari deploy/security-headers.conf
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
deploy           Dockerfile, nginx, Caddyfile, skrip backup/restore
docs             Dokumentasi
e2e              Skrip E2E Playwright
```
