# Backup dan restore

Yang dibackup: database PostgreSQL (`pg_dump` format custom) dan folder file privat (`storage.tar.gz`), lengkap dengan `SHA256SUMS` dan `MANIFEST`, dalam satu folder `sima-AAAAMMDD-JJMMDD`.

## Backup terjadwal

Container menjalankan backup otomatis tiap `BACKUP_INTERVAL_HOURS` (default 24 jam; pertama kali 5 menit setelah start) ke `/backups` (di compose contoh: folder `./backups` di host).

- Setiap backup diverifikasi (`pg_restore --list`, `tar -t`, `sha256sum -c`) dan baru dipublikasikan setelah lolos. Backup yang gagal tidak meninggalkan folder setengah jadi dan tidak menyentuh backup yang sudah ada; kegagalan tampil sebagai `PERINGATAN`/`GAGAL` di log container.
- Retensi: `KEEP_DAILY` (7) backup terbaru, ditambah `KEEP_WEEKLY` (4) backup yang dibuat hari Minggu.
- `BACKUP_INTERVAL_HOURS=0` mematikan penjadwalan.

Backup sekarang juga (mis. sebelum update):

```bash
docker compose -f docker-compose.prod.yml exec sima sima-backup
```

**Salin folder `./backups` ke penyimpanan lain** (server lain, cloud, disk eksternal) secara berkala. Backup di server yang sama tidak melindungi dari kerusakan server.

## Restore

Hentikan container, lalu jalankan mode `restore` pada volume yang sama (atau volume baru/kosong):

```bash
docker compose -f docker-compose.prod.yml stop sima
docker compose -f docker-compose.prod.yml run --rm --no-deps sima restore /backups/sima-20261102-020000
# ketik PULIHKAN saat diminta; tambahkan --force bila database tujuan sudah berisi data
docker compose -f docker-compose.prod.yml up -d
```

Mode `restore` hanya menyalakan PostgreSQL internal, memulihkan database dan file, lalu berhenti. Setelah itu `up -d` menerapkan migrasi yang lebih baru (bila backup berasal dari versi lebih lama).

Memulihkan ke server baru: pasang compose dan environment yang sama (termasuk `POSTGRES_PASSWORD`), taruh folder backup di `./backups`, lalu jalankan perintah di atas pada volume kosong (tanpa `--force`).

Pengaman `restore`:

- memverifikasi checksum dan keterbacaan dump sebelum menyentuh apa pun (backup rusak ditolak);
- menolak database tujuan yang sudah berisi tabel kecuali `--force`;
- meminta ketik `PULIHKAN` kecuali `--yes`;
- restore database berjalan dalam satu transaksi (gagal di tengah = tidak ada perubahan);
- folder file lama tidak dihapus, tetapi dipindahkan ke `/data/storage.sebelum-restore-<waktu>`.

## Tanpa Docker

Skrip `deploy/backup.sh` dan `deploy/restore.sh` membaca variabel standar PostgreSQL (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`), `STORAGE_DIR`, dan `BACKUP_DIR`. Perlu `pg_dump`/`pg_restore`/`psql` versi 16.

## Yang sudah diuji

- Tes otomatis `apps/api/tests/backup-restore.test.ts` (PostgreSQL asli): backup → restore ke database baru → jumlah baris **seluruh tabel** identik, isi file identik, trigger append-only dan CHECK tetap aktif pada hasil restore; backup gagal tidak merusak backup lama; restore menolak database berisi data, checksum rusak, dan jawaban konfirmasi salah; retensi menghapus backup lama.
- Pada image Docker sungguhan: backup terjadwal berjalan, `sima-backup`, lalu `restore` ke volume baru dan container baru dari volume itu memuat data dan file yang sama.
