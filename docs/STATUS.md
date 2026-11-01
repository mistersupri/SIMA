# Status fitur SIMA

Hanya fitur yang sudah dijalankan dan diuji yang ditandai selesai.
Terakhir diperbarui: Tahap 2.

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

## Belum dikerjakan

Barang/aset/QR, persediaan, pengadaan, approval, mutasi, peminjaman, pemeliharaan, penghapusan, stock opname, dashboard, laporan, import/export, PWA/offline, Docker deployment, backup/restore, dokumentasi API dan manual pengguna.
Dashboard belum ada; setelah login pengguna diarahkan ke halaman pertama yang diizinkan.
