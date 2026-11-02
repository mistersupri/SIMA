# Keamanan

Ringkasan kontrol keamanan dan cara memverifikasinya.

| Area | Kontrol | Bukti |
|---|---|---|
| Autentikasi | Argon2id; lockout 5 kegagalan/15 menit; pesan login seragam (anti-enumerasi pengguna); wajib ganti sandi untuk akun bootstrap dan hasil reset | `auth.test.ts` |
| Sesi | Cookie `sima_sid` HttpOnly, SameSite=Lax, `Secure` di produksi; hanya hash SHA-256 token yang disimpan; rotasi saat login; ganti sandi mencabut sesi lain; masa berlaku dapat diatur | `auth.test.ts` |
| CSRF | Token per sesi pada header `x-csrf-token` untuk semua request non-GET yang butuh login | `security.test.ts` (semua route non-GET diuji tanpa token → 403) |
| Otorisasi | Dicek di backend pada setiap request dari database (bukan dari klien); 74 permission, 5 role; pemisahan tugas di approval dan verifikasi | `security.test.ts` menyisir **seluruh route**: tanpa login 401; Viewer 403 di setiap route yang butuh izin yang tak dimilikinya; hanya 5 route publik |
| Route baru | Route tanpa perlindungan membuat tes gagal (daftar publik di-whitelist) | `security.test.ts` |
| Rate limit | Login 10/menit per IP; umum 600/menit per sesi | `auth.test.ts` |
| Input | Validasi Zod di semua endpoint; Prisma terparameter (tanpa SQL string dari input); `lockRows` hanya untuk tabel daftar putih | tes modul |
| Upload | Validasi isi file (magic bytes), batas ukuran, nama acak, penyimpanan privat di luar webroot, hanya lewat endpoint terautentikasi; guard path traversal | `inventory.test.ts`, `security.test.ts` |
| Integritas data | CHECK stok tidak negatif; trigger append-only untuk audit log, ledger stok, histori; partial unique index pinjaman; row lock; transaksi atomik | `db-constraints.test.ts`, `backup-restore.test.ts` |
| Audit | Semua perubahan data penting, login, export, impor, keputusan approval dicatat (sebelum/sesudah); tabel tidak dapat diubah | `reports.test.ts`, `settings.test.ts`, tes modul |
| Header | Helmet di API (HSTS, nosniff, frame deny); Caddy HSTS; nginx: CSP ketat, `X-Frame-Options: DENY`, `nosniff`, Permissions-Policy (kamera hanya origin sendiri) | Dicek pada stack produksi dan `e2e/tahap8.cjs` |
| CSP | `default-src 'self'`; skrip hanya dari origin sendiri tanpa `unsafe-eval`/inline; style `unsafe-inline` (dipakai Radix UI) | `e2e/tahap8.cjs` menjalankan aplikasi dengan CSP produksi dan memastikan tidak ada pelanggaran |
| Produksi | Aplikasi menolak start bila `COOKIE_SECURE=false` atau `SESSION_SECRET` masih contoh/pendek; DB tidak membuka port ke host; error tidak membocorkan stack | `security.test.ts` |
| PWA | Service worker hanya menyimpan shell; API dan file privat tidak pernah di-cache; token CSRF tidak disimpan di perangkat | `e2e/tahap7-pwa.cjs` |

## Hasil `pnpm audit --prod` (2026-11-02)

Tiga temuan, semuanya dependensi transitif yang **tidak terjangkau dari input pengguna**; tidak diperbaiki dengan override karena akan memaksa lompatan versi mayor pada pustaka induknya:

| Paket | Jalur | Penilaian |
|---|---|---|
| `uuid` <11.1.1 (moderate, bounds check bila `buf` diberikan) | `exceljs` | exceljs hanya memanggil `v4()` tanpa buffer; tidak terpengaruh |
| `minimatch` <11.0.1 (moderate, DoS pola glob) | `exceljs > archiver` | Pola glob berasal dari kode pustaka, bukan input pengguna |
| `deepmerge-ts` <8 (high, stack exhaustion objek rekursif) | `prisma` (CLI) | Hanya dipakai CLI Prisma saat migrasi dengan konfigurasi tetap; bukan jalur request |

Jalankan ulang `pnpm audit --prod` secara berkala dan perbarui dependensi saat pustaka induk merilis versi yang diperbaiki.

## Praktik operasional yang disarankan

- Ganti sandi bootstrap segera; buat akun personal per orang, nonaktifkan akun yang tidak dipakai.
- Beri role sesempit mungkin; Super Admin hanya untuk administrator sistem.
- Jaga `.env` (tidak masuk git); putar `SESSION_SECRET` bila diduga bocor (semua pengguna akan logout).
- Salin backup ke lokasi lain dan uji restore berkala.
- Pasang pembaruan keamanan OS/Docker di server.

## Batasan yang diketahui

- Fitur "lupa password" tidak mengirim email (tidak ada SMTP); administrator memakai "Atur ulang password".
- Tidak ada autentikasi dua faktor.
- Ikon PWA masih placeholder.
- Satu-satunya server yang dipercaya sebagai proxy adalah Caddy di jaringan Docker (`trustProxy` aktif di produksi); jangan membuka port `api` langsung ke internet.
