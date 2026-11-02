# Backup dan restore

Yang dibackup: database PostgreSQL (`pg_dump` format custom) dan folder file privat (foto aset, lampiran) sebagai `storage.tar.gz`, lengkap dengan `SHA256SUMS` dan `MANIFEST`.

## Backup terjadwal (Docker)

Service `backup` pada `docker-compose.prod.yml` membuat backup tiap `BACKUP_INTERVAL_HOURS` (default 24 jam) ke folder `./backups/sima-AAAAMMDD-JJMMDD/` di host.

- Setiap backup diverifikasi (`pg_restore --list`, `tar -t`, `sha256sum -c`). Bila ada langkah gagal, skrip keluar dengan kode non-nol, mencatat `GAGAL` di log, dan **tidak** meninggalkan backup setengah jadi. Backup lama tidak pernah disentuh.
- Retensi: `KEEP_DAILY` (7) backup terbaru, ditambah `KEEP_WEEKLY` (4) backup hari Minggu.
- Periksa log: `docker compose -f docker-compose.prod.yml logs backup`

Backup manual sesaat:

```bash
docker compose -f docker-compose.prod.yml exec backup /scripts/backup.sh
```

**Salin folder `./backups` ke penyimpanan lain** (server berbeda/cloud/disk eksternal) secara berkala. Backup di server yang sama tidak melindungi dari kerusakan server.

## Restore

Pulihkan **ke database kosong/baru** terlebih dulu bila ingin memeriksa isi backup:

```bash
docker compose -f docker-compose.prod.yml exec \
  -e PGDATABASE=sima_cek -e STORAGE_DIR=/tmp/storage-cek \
  backup /scripts/restore.sh /backups/sima-20261102-020000 --yes
```

Memulihkan produksi (menimpa data saat ini):

```bash
docker compose -f docker-compose.prod.yml stop api web
docker compose -f docker-compose.prod.yml exec backup /scripts/restore.sh /backups/sima-20261102-020000 --force
# ketik PULIHKAN saat diminta
docker compose -f docker-compose.prod.yml start api web
```

Catatan: pada produksi, folder file privat adalah volume `storage` yang di-mount **read-only** pada container backup. Untuk memulihkan file, jalankan restore dari container `api` atau salin isi `storage.tar.gz` ke volume tersebut:

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps --entrypoint tar -v $PWD/backups:/backups:ro api \
  -C /data/storage -xzf /backups/sima-20261102-020000/storage.tar.gz
```

Pengaman skrip `restore.sh`:

- memverifikasi checksum dan keterbacaan dump sebelum menyentuh apa pun (backup rusak ditolak);
- menolak database tujuan yang sudah berisi tabel kecuali `--force`;
- meminta ketik `PULIHKAN` kecuali `--yes`;
- restore database berjalan dalam satu transaksi (gagal di tengah = tidak ada perubahan);
- folder file lama tidak dihapus, tetapi dipindahkan ke `<folder>.sebelum-restore-<waktu>`.

## Tanpa Docker

Skrip membaca variabel standar PostgreSQL (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`), `STORAGE_DIR`, dan `BACKUP_DIR`; jalankan `deploy/backup.sh` dari cron dan `deploy/restore.sh` secara manual. Perlu `pg_dump`/`pg_restore`/`psql` versi 16.

## Yang sudah diuji

Tes otomatis `apps/api/tests/backup-restore.test.ts` (PostgreSQL asli): backup → restore ke database baru → jumlah baris **seluruh tabel** identik, isi file identik, trigger append-only dan CHECK tetap aktif pada hasil restore; backup gagal tidak merusak backup lama; restore menolak database berisi data, checksum rusak, dan jawaban konfirmasi salah; retensi menghapus backup lama. Diverifikasi juga manual di container (backup berkala, restore, dan retensi pada stack produksi).
