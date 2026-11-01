# Status fitur SIMA

Hanya fitur yang sudah dijalankan dan diuji yang ditandai selesai.
Terakhir diperbarui: Tahap 3.

## Selesai dan teruji

- [x] Monorepo pnpm (`apps/api`, `apps/web`, `packages/shared`)
- [x] `pnpm dev` satu perintah: `.env`, PostgreSQL (Docker Compose), migrate, seed, shared (watch), API, web. Teruji end-to-end: web `:5173` meneruskan `/api` ke API yang membaca PostgreSQL.
- [x] Schema Prisma lengkap: 48 tabel dari brief + `item_attachments`, `password_reset_tokens`, `document_sequences`, `import_batches` (UUID, FK, unique, `timestamptz`, `Decimal`)
- [x] Migrasi `init` dan `constraints_and_triggers`
- [x] Integritas di level database, diuji: saldo stok tidak negatif, ledger/audit/histori append-only (trigger), satu pinjaman terbuka per aset (partial unique index), kode aset dan nomor seri unik, email huruf kecil
- [x] Katalog 74 permission granular dan 5 role standar (`@sima/shared`), diuji
- [x] Seed idempoten: permission, role, organisasi, master default, Super Admin bootstrap (Argon2id, wajib ganti password), diuji dua kali jalan
- [x] Fondasi API: validasi env, format respons konsisten, error handler, helmet, rate limit, `/api/v1/health`

## Tahap 2 selesai dan teruji

- [x] Login/logout, session cookie HttpOnly + SameSite=Lax (token di DB hanya hash SHA-256), rotasi session saat login
- [x] CSRF (token per session, header `x-csrf-token`), lockout 5 kegagalan, rate limit login, anti user-enumeration
- [x] Argon2id, wajib ganti password (bootstrap dan reset admin), ganti password mencabut sesi lain
- [x] RBAC backend: permission dimuat dari database tiap request; role dari klien diabaikan
- [x] Pengguna (CRUD, status, multi-role, akses unit, reset password) dan role/permission kustom; guard Super Admin terakhir
- [x] Master data 9 resource (unit kerja, lokasi, kategori, satuan, merek, vendor, sumber perolehan, penanggung jawab, gudang): pagination, search, sort, filter, soft delete, anti siklus hierarki, audit before/after
- [x] UI: login, ganti password, layout sidebar/topbar responsif, Pengguna, Role dan Permission, Master Data, state kosong/memuat/galat
- [x] 51 test integrasi backend ke PostgreSQL + 35 pemeriksaan E2E browser (`node e2e/tahap2.cjs`, butuh stack berjalan pada database kosong)

Batasan Tahap 2: forgot-password belum mengirim email (tidak ada SMTP); admin memakai "Atur ulang password". Dropdown relasi memuat maks. 100 opsi. Topbar belum punya pencarian global dan notifikasi (ditambahkan bersama modulnya).

## Tahap 3 selesai dan teruji

- [x] Master barang: kode otomatis atomik (`BRG-ELK-000001`, `PRS-ATK-000001`), jenis tidak dapat diubah, arsip/aktifkan, audit
- [x] Aset individual: registrasi 1-100 unit sekaligus (`INV-ELK-2026-000001`), nomor seri per unit, histori lokasi dan kondisi awal, edit dengan alasan wajib saat kondisi berubah, aset dihapuskan tidak bisa diubah, pembatasan akses per unit
- [x] QR Code per aset (PNG/SVG, unduh), lookup by-code, cetak label massal (halaman cetak dengan CSS print), halaman `/q/:kode` untuk QR yang dipindai kamera bawaan ponsel
- [x] Pemindai kamera di browser (BarcodeDetector, fallback jsQR) + input manual + pesan galat izin kamera. Teruji dengan kamera palsu Chromium yang memutar QR asli.
- [x] Foto aset: validasi isi file (magic bytes), nama acak, penyimpanan privat, hanya lewat endpoint terautentikasi, foto utama, hapus
- [x] Persediaan: ledger dengan row lock, saldo tidak negatif (service + CHECK database), barang masuk/keluar multi-baris atomik, kartu stok per gudang dan periode (saldo pembuka), riwayat transaksi, stok menipis
- [x] UI: Data Barang, Aset (daftar, registrasi, detail 7 tab), Scan QR, Persediaan, Kartu stok
- [x] 72 test integrasi backend + 3 test frontend + 43 pemeriksaan E2E browser (`node e2e/tahap3.cjs`)

Bug yang ditemukan E2E dan diperbaiki: nomor seri yang diketik hilang diam-diam di form registrasi (nilai form dibuang oleh hasil parsing Zod).

Batasan Tahap 3: penyesuaian stok dan saldo awal lewat import menunggu approval (Tahap 4) dan import (Tahap 7); cetak kartu inventaris berbentuk PDF menunggu Tahap 7; perpindahan lokasi aset hanya lewat mutasi (Tahap 4).

## Belum dikerjakan

Pengadaan, penerimaan, approval, penyesuaian stok, mutasi, peminjaman, pemeliharaan, penghapusan, stock opname, dashboard, laporan, import/export, PWA/offline, Docker deployment, backup/restore, dokumentasi API dan manual pengguna.
Dashboard belum ada; setelah login pengguna diarahkan ke halaman pertama yang diizinkan.
