# Daftar fitur: selesai dan belum

Penanda **teruji** berarti ada test otomatis (vitest ke PostgreSQL asli) dan/atau skrip E2E browser (Playwright) yang lulus. Rincian per tahap: [`STATUS.md`](STATUS.md).

## Selesai dan teruji

| Modul | Fitur |
|---|---|
| Fondasi | Monorepo pnpm; `pnpm dev` satu perintah (termasuk PostgreSQL); 48+ tabel Prisma + migrasi; seed idempoten; format respons seragam |
| Keamanan | Session cookie, CSRF, Argon2id, lockout, rate limit, RBAC 74 permission/5 role, header/CSP, audit log append-only |
| Pengguna | CRUD, multi-role, akses per unit, reset password, role kustom, guard Super Admin terakhir |
| Master data | 9 resource, soft delete, hierarki lokasi/unit anti-siklus |
| Inventaris | Master barang, registrasi aset massal, nomor seri, QR per aset, cetak label, scan kamera, foto privat, histori lokasi/kondisi |
| Persediaan | Ledger, barang masuk/keluar atomik, saldo tidak negatif (DB CHECK), kartu stok, stok menipis, penyesuaian via approval |
| Approval | Satu langkah, pemisahan tugas, tolak wajib alasan, ajukan ulang, tarik pengajuan |
| Transaksi | Pengadaan + penerimaan (parsial), mutasi, peminjaman (anti pinjam ganda, keterlambatan), pemeliharaan, penghapusan |
| Stock opname | Sesi, scan, foto, offline + sinkronisasi idempoten, verifikasi per temuan |
| Impor Excel | 4 jenis; template; pratinjau; deteksi duplikat; laporan kesalahan; commit atomik |
| Laporan | Dashboard, 9 laporan, export XLSX/PDF, cetak, audit log viewer |
| PWA | Manifest, ikon, service worker (shell saja), mode offline, banner, pemasangan |
| Notifikasi | Dalam aplikasi (pribadi) |
| Pengaturan | Identitas instansi (login, menu, kepala laporan) |
| Dokumentasi API | `docs/API.md` dibuat otomatis dari 173 route; tes menjamin tidak usang |
| Deployment | Satu image Docker (web + API + PostgreSQL + backup terjadwal), cukup environment di Docker Compose; image dibangun dan dijalankan, restart/stop rapi, data persisten |
| Backup/restore | Skrip + backup terjadwal + retensi; tes otomatis restore ke database baru |
| Tes keamanan | Seluruh route: 401 tanpa login, 403 per role, CSRF, whitelist publik, konfigurasi produksi |

Pada penutupan Tahap 8: 155 test backend, 3 test frontend, dan 250 pemeriksaan E2E browser lulus, ditambah E2E tahap8 dan PWA terhadap image Docker asli (lihat "Regresi akhir" di `STATUS.md`).

## Belum / batasan yang diketahui

| Hal | Keterangan |
|---|---|
| Ikon aplikasi | Placeholder teks "SIMA"; ganti berkas di `apps/web/public/icons` |
| Email | Tidak ada SMTP: "lupa password" lewat admin; notifikasi hanya di dalam aplikasi |
| Approval berjenjang | Satu langkah saja; tabel mendukung berjenjang tetapi belum ada UI pengaturan alur; kewenangan per unit belum ada |
| 2FA | Tidak ada |
| Stock opname persediaan | Hanya opname aset individual; stok memakai penyesuaian |
| Offline | Hanya pemeriksaan opname; foto opname butuh koneksi; transaksi lain sengaja online |
| Impor | Hanya `.xlsx`, maks. 5.000 baris; merek/master harus sudah ada |
| Laporan | Export maks. 20.000 baris; PDF memakai font bawaan (karakter non-Latin-1 jadi `?`); grafik SVG sederhana; kartu stok per barang belum berupa export |
| Pencarian global | Belum ada di topbar |
| Penyimpanan file | Disk lokal/volume Docker (belum S3/objek storage) |
| Publikasi GitHub Actions | `publish.yml` belum pernah dijalankan di GitHub (Dockerfile yang sama sudah diuji lokal) |
| HTTPS | Disediakan reverse proxy di depan container (belum diuji dengan proxy sungguhan) |
| Database di container yang sama | Tanpa replikasi/failover; andalkan backup yang disalin ke luar server |
| Dependensi | 3 temuan `pnpm audit` transitif yang tidak terjangkau (lihat `KEAMANAN.md`) |
| Uji beban | Tidak dilakukan; ukuran target: satu instansi |
