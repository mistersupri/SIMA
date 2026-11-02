# Dokumentasi API SIMA

> Berkas ini dibuat otomatis dari route yang terdaftar (`pnpm docs:api`). 173 endpoint. Jangan diedit manual; sebuah test memastikan berkas ini selalu sama dengan route sebenarnya.

## Dasar

- Base URL: `/api/v1`. Semua data dikirim dan diterima sebagai JSON (UTF-8), kecuali unggah file (`multipart/form-data`) dan unduhan (XLSX, PDF, PNG, SVG).
- **Autentikasi**: session berbasis cookie `sima_sid` (HttpOnly, SameSite=Lax, Secure pada HTTPS). Login lewat `POST /auth/login`. Token session tidak pernah disimpan mentah di database.
- **CSRF**: setiap request selain GET harus membawa header `x-csrf-token` berisi `csrfToken` dari respons login atau `GET /auth/me`. Tanpa token, server membalas 403.
- **Otorisasi**: kolom *Akses* menunjukkan permission yang wajib dimiliki. Diperiksa di server pada setiap request; role yang dikirim klien diabaikan. "Login" berarti cukup sudah masuk.
- **Format sukses**: `{ "success": true, "message": "...", "data": ..., "meta": null | { page, limit, total, totalPages } }`.
- **Format gagal**: `{ "success": false, "message": "...", "errors": [{ "field": "name", "message": "..." }] }`. Kode status: 400 validasi, 401 belum login, 403 tanpa izin/CSRF salah, 404 tidak ada, 409 konflik data, 413 file terlalu besar, 422 melanggar aturan bisnis, 429 terlalu banyak permintaan.
- **Daftar**: mendukung `page` (default 1), `limit` (1-100, default 20), `search`, `sortBy`, `sortOrder` (`asc|desc`), ditambah filter khusus tiap endpoint. `sortBy` hanya menerima kolom yang diizinkan; nilai lain diabaikan.
- **Batas laju**: 600 permintaan/menit per sesi (per IP untuk yang belum login); login 10/menit/IP.
- **Dokumen transaksi** (pengadaan, mutasi, peminjaman, pemeliharaan, penghapusan, penyesuaian stok): alur `DRAFT → PENDING_APPROVAL → APPROVED → ...`. Pengaju/pembuat tidak dapat menyetujui dokumennya sendiri; dokumen yang sudah diajukan tidak dapat diedit langsung.

Contoh:

```bash
# login, simpan cookie, lalu baca csrfToken dari respons
curl -c cookies.txt -H "content-type: application/json" \
  -d '{"email":"admin@sima.local","password":"..."}' https://DOMAIN/api/v1/auth/login

# request yang mengubah data membawa cookie dan header CSRF
curl -b cookies.txt -H "x-csrf-token: <csrfToken>" -H "content-type: application/json" \
  -d '{"name":"Merek Baru"}' https://DOMAIN/api/v1/brands
```

## Kesehatan layanan

Pemeriksaan status API dan database.

| Method | Path | Akses |
|---|---|---|
| GET | `/health` | Publik |

## Info aplikasi

Nama instansi untuk halaman login (publik, tanpa data lain).

| Method | Path | Akses |
|---|---|---|
| GET | `/app-info` | Publik |

## Autentikasi

Login, logout, profil, ganti dan reset password.

| Method | Path | Akses |
|---|---|---|
| POST | `/auth/change-password` | Login |
| POST | `/auth/forgot-password` | Publik |
| POST | `/auth/login` | Publik |
| POST | `/auth/logout` | Login |
| GET | `/auth/me` | Login |
| POST | `/auth/reset-password` | Publik |

## Pengguna

Akun, status, role, akses unit, reset password oleh admin.

| Method | Path | Akses |
|---|---|---|
| GET | `/users` | `users.view` |
| POST | `/users` | `users.manage` |
| GET | `/users/:id` | `users.view` |
| PATCH | `/users/:id` | `users.manage` |
| POST | `/users/:id/reset-password` | `users.manage` |
| PUT | `/users/:id/roles` | `users.manage` |
| PATCH | `/users/:id/status` | `users.manage` |
| PUT | `/users/:id/unit-access` | `users.manage` |

## Role dan permission

Role standar/kustom dan penugasan permission.

| Method | Path | Akses |
|---|---|---|
| GET | `/roles` | `roles.view` |
| POST | `/roles` | `roles.manage` |
| DELETE | `/roles/:id` | `roles.manage` |
| PUT | `/roles/:id/permissions` | `roles.manage` |
| GET | `/roles/options` | `users.view` |
| GET | `/permissions` | `roles.view` |

## Pengaturan

Identitas instansi.

| Method | Path | Akses |
|---|---|---|
| GET | `/settings/organization` | `settings.manage` |
| PATCH | `/settings/organization` | `settings.manage` |

## Master data

CRUD master: unit kerja, lokasi, kategori, satuan, merek, vendor, sumber perolehan, penanggung jawab, gudang. DELETE berarti nonaktifkan.

| Method | Path | Akses |
|---|---|---|
| GET | `/organizational-units` | `master.view` |
| POST | `/organizational-units` | `master.manage` |
| DELETE | `/organizational-units/:id` | `master.manage` |
| GET | `/organizational-units/:id` | `master.view` |
| PATCH | `/organizational-units/:id` | `master.manage` |
| GET | `/locations` | `master.view` |
| POST | `/locations` | `master.manage` |
| DELETE | `/locations/:id` | `master.manage` |
| GET | `/locations/:id` | `master.view` |
| PATCH | `/locations/:id` | `master.manage` |
| GET | `/categories` | `master.view` |
| POST | `/categories` | `master.manage` |
| DELETE | `/categories/:id` | `master.manage` |
| GET | `/categories/:id` | `master.view` |
| PATCH | `/categories/:id` | `master.manage` |
| GET | `/units` | `master.view` |
| POST | `/units` | `master.manage` |
| DELETE | `/units/:id` | `master.manage` |
| GET | `/units/:id` | `master.view` |
| PATCH | `/units/:id` | `master.manage` |
| GET | `/brands` | `master.view` |
| POST | `/brands` | `master.manage` |
| DELETE | `/brands/:id` | `master.manage` |
| GET | `/brands/:id` | `master.view` |
| PATCH | `/brands/:id` | `master.manage` |
| GET | `/vendors` | `master.view` |
| POST | `/vendors` | `master.manage` |
| DELETE | `/vendors/:id` | `master.manage` |
| GET | `/vendors/:id` | `master.view` |
| PATCH | `/vendors/:id` | `master.manage` |
| GET | `/funding-sources` | `master.view` |
| POST | `/funding-sources` | `master.manage` |
| DELETE | `/funding-sources/:id` | `master.manage` |
| GET | `/funding-sources/:id` | `master.view` |
| PATCH | `/funding-sources/:id` | `master.manage` |
| GET | `/persons` | `master.view` |
| POST | `/persons` | `master.manage` |
| DELETE | `/persons/:id` | `master.manage` |
| GET | `/persons/:id` | `master.view` |
| PATCH | `/persons/:id` | `master.manage` |
| GET | `/warehouses` | `master.view` |
| POST | `/warehouses` | `master.manage` |
| DELETE | `/warehouses/:id` | `master.manage` |
| GET | `/warehouses/:id` | `master.view` |
| PATCH | `/warehouses/:id` | `master.manage` |

## Master barang

Jenis barang inventaris dan persediaan; kode dibuat otomatis.

| Method | Path | Akses |
|---|---|---|
| GET | `/items` | `items.view` |
| POST | `/items` | `items.create` |
| GET | `/items/:id` | `items.view` |
| PATCH | `/items/:id` | `items.update` |
| POST | `/items/:id/archive` | `items.archive` |
| POST | `/items/:id/unarchive` | `items.archive` |

## Aset inventaris

Unit aset individual, QR Code, foto, histori.

| Method | Path | Akses |
|---|---|---|
| GET | `/assets` | `assets.view` |
| POST | `/assets` | `assets.create` |
| GET | `/assets/:id` | `assets.view` |
| PATCH | `/assets/:id` | `assets.update` |
| GET | `/assets/:id/history` | `assets.view` |
| POST | `/assets/:id/photos` | `assets.update` |
| DELETE | `/assets/:id/photos/:photoId` | `assets.update` |
| POST | `/assets/:id/photos/:photoId/primary` | `assets.update` |
| GET | `/assets/:id/qr` | `assets.view` |
| POST | `/assets/bulk-qr` | `assets.print_qr` |
| GET | `/assets/by-code/:code` | `assets.view` |

## File privat

File hanya dapat diunduh lewat endpoint terautentikasi.

| Method | Path | Akses |
|---|---|---|
| GET | `/files/:id` | Login |

## Persediaan

Saldo, kartu stok, barang masuk/keluar (ledger), penyesuaian stok dengan persetujuan.

| Method | Path | Akses |
|---|---|---|
| GET | `/stocks` | `stocks.view` |
| GET | `/stocks/:itemId` | `stocks.view` |
| GET | `/stocks/:itemId/card` | `stocks.view` |
| GET | `/stocks/adjustments` | `stock_adjustments.view` |
| POST | `/stocks/adjustments` | `stock_adjustments.create` |
| GET | `/stocks/adjustments/:id` | `stock_adjustments.view` |
| POST | `/stocks/adjustments/:id/cancel` | `stock_adjustments.create` |
| POST | `/stocks/adjustments/:id/submit` | `stock_adjustments.submit` |
| POST | `/stocks/in` | `stocks.in` |
| POST | `/stocks/out` | `stocks.out` |
| GET | `/stocks/transactions` | `stocks.view` |

## Pengadaan dan penerimaan

Dokumen pengadaan dan pencatatan penerimaan.

| Method | Path | Akses |
|---|---|---|
| GET | `/procurements` | `procurements.view` |
| POST | `/procurements` | `procurements.create` |
| GET | `/procurements/:id` | `procurements.view` |
| PATCH | `/procurements/:id` | `procurements.update` |
| POST | `/procurements/:id/cancel` | `procurements.update` |
| POST | `/procurements/:id/receive` | `goods_receipts.create` |
| POST | `/procurements/:id/submit` | `procurements.submit` |
| GET | `/goods-receipts` | `goods_receipts.view` |
| GET | `/goods-receipts/:id` | `goods_receipts.view` |
| POST | `/goods-receipts/:id/cancel` | `goods_receipts.create` |
| POST | `/goods-receipts/:id/confirm` | `goods_receipts.confirm` |

## Mutasi aset

Perpindahan aset dengan persetujuan.

| Method | Path | Akses |
|---|---|---|
| GET | `/mutations` | `mutations.view` |
| POST | `/mutations` | `mutations.create` |
| GET | `/mutations/:id` | `mutations.view` |
| PATCH | `/mutations/:id` | `mutations.create` |
| POST | `/mutations/:id/cancel` | `mutations.create` |
| POST | `/mutations/:id/complete` | `mutations.complete` |
| POST | `/mutations/:id/move` | `mutations.complete` |
| POST | `/mutations/:id/submit` | `mutations.submit` |

## Peminjaman

Peminjaman, serah terima, pengembalian.

| Method | Path | Akses |
|---|---|---|
| GET | `/loans` | `loans.view` |
| POST | `/loans` | `loans.create` |
| GET | `/loans/:id` | `loans.view` |
| PATCH | `/loans/:id` | `loans.create` |
| POST | `/loans/:id/cancel` | `loans.create` |
| POST | `/loans/:id/handover` | `loans.handover` |
| POST | `/loans/:id/return` | `loans.return` |
| POST | `/loans/:id/submit` | `loans.submit` |
| POST | `/loans/sweep` | `loans.return` |

## Pemeliharaan

Laporan dan perbaikan aset.

| Method | Path | Akses |
|---|---|---|
| GET | `/maintenances` | `maintenances.view` |
| POST | `/maintenances` | `maintenances.create` |
| GET | `/maintenances/:id` | `maintenances.view` |
| PATCH | `/maintenances/:id` | `maintenances.create` |
| POST | `/maintenances/:id/cancel` | `maintenances.create` |
| POST | `/maintenances/:id/complete` | `maintenances.complete` |
| POST | `/maintenances/:id/start` | `maintenances.complete` |
| POST | `/maintenances/:id/submit` | `maintenances.submit` |

## Penghapusan aset

Usulan dan finalisasi penghapusan (histori tetap).

| Method | Path | Akses |
|---|---|---|
| GET | `/disposals` | `disposals.view` |
| POST | `/disposals` | `disposals.create` |
| GET | `/disposals/:id` | `disposals.view` |
| PATCH | `/disposals/:id` | `disposals.create` |
| POST | `/disposals/:id/cancel` | `disposals.create` |
| POST | `/disposals/:id/complete` | `disposals.complete` |
| POST | `/disposals/:id/submit` | `disposals.submit` |

## Stock opname

Sesi pemeriksaan fisik, scan, sinkronisasi offline, verifikasi.

| Method | Path | Akses |
|---|---|---|
| GET | `/stock-opnames` | `stock_opnames.view` |
| POST | `/stock-opnames` | `stock_opnames.create` |
| GET | `/stock-opnames/:id` | `stock_opnames.view` |
| POST | `/stock-opnames/:id/cancel` | `stock_opnames.create` |
| GET | `/stock-opnames/:id/details` | `stock_opnames.view` |
| POST | `/stock-opnames/:id/details/:detailId/photos` | `stock_opnames.scan` |
| POST | `/stock-opnames/:id/scan` | `stock_opnames.scan` |
| POST | `/stock-opnames/:id/start` | `stock_opnames.create` |
| POST | `/stock-opnames/:id/submit` | `stock_opnames.submit` |
| POST | `/stock-opnames/:id/sync` | `stock_opnames.scan` |
| POST | `/stock-opnames/:id/verify` | `stock_opnames.verify` |

## Persetujuan

Daftar, riwayat, setujui, dan tolak.

| Method | Path | Akses |
|---|---|---|
| GET | `/approvals` | `approvals.view` |
| GET | `/approvals/:id` | `approvals.view` |
| POST | `/approvals/:id/approve` | `approvals.view` |
| POST | `/approvals/:id/reject` | `approvals.view` |
| GET | `/approvals/history` | `approvals.view` |

## Notifikasi

Notifikasi pribadi pengguna.

| Method | Path | Akses |
|---|---|---|
| GET | `/notifications` | Login |
| POST | `/notifications/:id/read` | Login |
| POST | `/notifications/read-all` | Login |
| GET | `/notifications/unread-count` | Login |

## Laporan dan dashboard

Dashboard dan 9 laporan (JSON, paginasi).

| Method | Path | Akses |
|---|---|---|
| GET | `/reports` | `reports.view` |
| GET | `/reports/:key` | `reports.view` |
| GET | `/reports/dashboard` | `dashboard.view` |

## Export

Unduh laporan sebagai XLSX atau PDF (`?format=xlsx|pdf`).

| Method | Path | Akses |
|---|---|---|
| GET | `/exports/:key` | `reports.view` |

## Import Excel

Template, preview, laporan kesalahan, commit.

| Method | Path | Akses |
|---|---|---|
| POST | `/imports/:type/commit` | Login |
| POST | `/imports/:type/preview` | Login |
| GET | `/imports/batches/:id/errors` | Login |
| GET | `/imports/batches/:id/rows` | Login |
| GET | `/imports/template` | Login |
| GET | `/imports/types` | Login |

## Audit log

Catatan perubahan (hanya baca).

| Method | Path | Akses |
|---|---|---|
| GET | `/audit-logs` | `audit.view` |
| GET | `/audit-logs/options` | `audit.view` |
