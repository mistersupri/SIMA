# Status fitur SIMA

Hanya fitur yang sudah dijalankan dan diuji yang ditandai selesai.
Terakhir diperbarui: Tahap 6.

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

## Tahap 5 selesai dan teruji

- [x] Pemeliharaan dan perbaikan: lapor, ajukan, setujui, mulai perbaikan (aset otomatis Dalam perbaikan, tidak bisa dipinjam/dimutasi), selesaikan dengan tindakan, biaya, dan kondisi akhir; satu aset satu pemeliharaan terbuka; riwayat perbaikan
- [x] Penghapusan aset: ajukan, setujui, finalisasi atomik. Aset berstatus Dihapuskan, tidak ada baris yang dihapus, seluruh histori utuh, QR tetap menampilkan identitas, aset tidak dapat dipinjam/dimutasi/dipelihara/diedit lagi
- [x] Stock opname: sesi per lokasi (termasuk sub-lokasi) dan/atau unit, snapshot daftar aset saat dimulai, petugas pemeriksa, scan QR (kamera atau manual) dengan hasil Sesuai / Tidak sesuai / Tidak ditemukan / Belum diperiksa / Barang tidak terdaftar, foto pemeriksaan (privat), pengajuan hasil, verifikasi per temuan (terapkan/tolak) oleh orang yang bukan pembuat sesi atau petugas lapangan
- [x] Master aset berubah hanya setelah keputusan Terapkan pada verifikasi (lokasi, kondisi, status Tidak ditemukan/pulih), dengan histori OPNAME
- [x] Offline untuk pemeriksaan fisik: catatan disimpan di perangkat bila jaringan putus, disinkronkan otomatis saat online lewat endpoint batch idempoten (`clientId`), konflik ditampilkan untuk ditinjau; server memvalidasi ulang setiap catatan
- [x] Komponen pemindai kamera dipakai bersama halaman Scan QR dan halaman periksa
- [x] 103 test backend + 3 test frontend + E2E: tahap2 (35), tahap3 (43), tahap4 (45), tahap5 (41)

Batasan Tahap 5: aplikasi belum dapat dibuka saat benar-benar offline (service worker/PWA terpasang di Tahap 7; antrean offline bekerja selama halaman sudah terbuka); foto pemeriksaan memerlukan koneksi; barang tidak terdaftar hanya dicatat dan diakui, pendaftaran aset barunya manual; stock opname untuk persediaan (kuantitatif) tidak dicakup, penyesuaian stok memakai alur tersendiri.

## Tahap 6 selesai dan teruji

- [x] Dashboard dari database: 12 kartu statistik yang dapat diklik (drill-down ke daftar terfilter), aset per kategori/kondisi/lokasi, pengadaan disetujui per bulan (12 bulan), pengajuan menunggu keputusan pengguna, aktivitas terbaru; angka dibandingkan dengan hitungan independen di E2E; menghormati pembatasan unit
- [x] 9 laporan: inventaris, persediaan (saldo + pergerakan periode), kondisi, mutasi, peminjaman (termasuk terlambat), pemeliharaan, pengadaan per periode, penghapusan, stock opname; filter tanggal/tahun/kategori/lokasi (termasuk sub-lokasi)/unit/kondisi/status; paginasi server dan ringkasan
- [x] Export XLSX (ExcelJS: header bertema, tipe angka/uang/tanggal, filter otomatis, ringkasan) dan PDF (pdfkit: multi-halaman, header berulang, nomor halaman); tombol Cetak; export dibatasi `reports.export` atau izin modul dan tercatat di audit log
- [x] Audit log viewer (read-only; filter objek, aksi, tanggal, pencarian; rincian sebelum/sesudah); tabel append-only di database
- [x] 117 test backend + 3 test frontend + E2E: tahap2 (35), tahap3 (43), tahap4 (45), tahap5 (41), tahap6 (39)

Bug yang ditemukan pengujian tahap ini dan diperbaiki: kartu kondisi dashboard ikut menghitung aset dihapuskan (filter status tertimpa); opsi filter audit log berlabel ganda; ringkasan aktivitas memakai nama entitas mentah.

Batasan Tahap 6: tombol Cetak mencetak halaman yang sedang tampil (untuk seluruh data gunakan PDF); export dibatasi 20.000 baris; teks PDF memakai font bawaan (karakter di luar Latin-1 diganti `?`); diagram dibuat dengan SVG sederhana (tanpa pustaka grafik); laporan kartu stok per barang ada di halaman Persediaan, belum berupa export.

## Belum dikerjakan

Import Excel (template, preview, validasi per baris, saldo awal sebagai transaksi pembukaan), service worker PWA (pemasangan dan shell offline), pengaturan aplikasi (identitas instansi), Docker deployment (Dockerfile, compose produksi, reverse proxy HTTPS), backup/restore terjadwal dan teruji, dokumentasi API, manual pengguna, dan penyisiran keamanan akhir.
