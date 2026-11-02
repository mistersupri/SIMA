# Status fitur SIMA

Hanya fitur yang sudah dijalankan dan diuji yang ditandai selesai.
Terakhir diperbarui: Tahap 4.

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

## Tahap 4 selesai dan teruji

- [x] Mesin approval: satu langkah (role Approver atau Super Admin + permission `<modul>.approve/.reject`), keputusan hanya sekali (serentak aman), penolakan wajib beralasan, dokumen ditolak dapat diperbaiki dan diajukan ulang, tarik pengajuan saat dibatalkan
- [x] Pemisahan tugas ditegakkan di server: pengaju dan pembuat dokumen tidak dapat menyetujui/menolak, termasuk Super Admin
- [x] Dokumen yang sudah diajukan/disetujui tidak dapat diedit langsung (422)
- [x] Pengadaan (draft, ajukan, setujui/tolak, batal) dan penerimaan barang: unit aset dan stok baru lahir hanya saat penerimaan dikonfirmasi; konfirmasi atomik (gagal satu baris, tidak ada yang tersimpan); verifikator harus petugas lain (Super Admin boleh); penerimaan sebagian; status pengadaan Diterima sebagian / Selesai
- [x] Mutasi aset: lokasi/unit/penanggung jawab berubah hanya setelah disetujui, pemindahan dicatat, dan konfirmasi selesai; satu aset tidak bisa ada di dua mutasi terbuka; konfirmasi atomik; histori lokasi
- [x] Peminjaman: draft, ajukan (mengunci aset lewat partial unique index), setujui, serah terima (status Dipinjam), pengembalian dengan kondisi aktual (boleh sebagian), pinjam ganda ditolak termasuk saat serentak, aset diperbaiki/dihapuskan/diarsipkan tidak bisa dipinjam, sweep keterlambatan terjadwal + pengingat jatuh tempo
- [x] Penyesuaian stok via persetujuan: saldo berubah hanya setelah disetujui dan dicatat sebagai transaksi ADJUSTMENT; gagal bila membuat stok negatif
- [x] Notifikasi internal: persetujuan diperlukan/disetujui/ditolak, penerimaan, mutasi selesai, peminjaman terlambat/jatuh tempo/kembali, stok menipis (sekali per barang per hari); bersifat pribadi
- [x] UI: lonceng notifikasi, Menunggu/Riwayat Persetujuan, Pengadaan (daftar, form, detail), Penerimaan Barang, Mutasi, Peminjaman, Penyesuaian stok, pemilih aset dengan pencarian di server
- [x] Rate limit global per sesi login (bukan per IP) dengan pesan Indonesia
- [x] 94 test backend + 3 test frontend + E2E browser: tahap2 (35), tahap3 (43), tahap4 (45)

Bug yang ditemukan E2E dan diperbaiki pada tahap ini: pemilih aset menampilkan hasil lama saat mengetik cepat (bisa salah pilih); halaman detail melebar di layar ponsel (grid mengikuti lebar tabel); `ConfirmDialog` menghasilkan unhandled rejection saat aksi gagal; urutan rincian pengadaan acak (UUID); batas laju per IP menghambat banyak pengguna di satu NAT.

Batasan Tahap 4: approval satu langkah (struktur tabel mendukung berjenjang, belum ada UI untuk mengatur alur); pembatasan kewenangan approver per unit belum diberlakukan (kewenangan = role + permission); notifikasi hanya di dalam aplikasi (tanpa email); pengeluaran stok langsung tanpa persetujuan.

## Belum dikerjakan

Pemeliharaan, penghapusan, stock opname, dashboard, laporan, import/export, PWA/offline, Docker deployment, backup/restore, dokumentasi API dan manual pengguna.
Dashboard belum ada; setelah login pengguna diarahkan ke halaman pertama yang diizinkan.
