# Deployment produksi (satu image Docker)

SIMA dikemas sebagai **satu image** yang berisi aplikasi web, API, dan database PostgreSQL 16. Satu container, tiga volume, dan semua konfigurasi lewat environment variable.

```
Internet ── reverse proxy HTTPS (Anda) ── container sima :8080
                                           ├─ web (berkas statis) + API  (Node.js)
                                           ├─ PostgreSQL 16 (hanya 127.0.0.1 di dalam container)
                                           └─ backup terjadwal → /backups
```

## 1. Ambil image

Image dipublikasikan oleh GitHub Actions (`docs/CICD.md`) ke `ghcr.io/<pemilik>/sima:<versi>`. Bila paket bersifat privat, login dulu dengan token yang punya izin `read:packages`:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <username-github> --password-stdin
```

Atau bangun sendiri dari kode sumber: `docker build -f deploy/Dockerfile -t sima .` (lalu ganti `image:` di compose menjadi `sima`).

## 2. Compose dan environment

Gunakan `docker-compose.prod.yml` sebagai contoh (satu service `sima`) dan isi environment-nya, langsung di compose atau lewat berkas `.env` (contoh: `.env.production.example`).

| Variabel | Wajib | Keterangan |
|---|---|---|
| `APP_URL` | ya | URL publik `https://...` (masuk ke isi QR Code) |
| `SESSION_SECRET` | ya | Minimal 32 karakter acak (`openssl rand -base64 48`) |
| `POSTGRES_PASSWORD` | ya | Sandi database internal |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | ya | Super Admin pertama (dibuat bila belum ada; wajib ganti sandi saat login pertama) |
| `ORG_CODE`, `ORG_NAME` | tidak | Kode (bagian kode inventaris, **jangan diubah** setelah ada aset) dan nama instansi |
| `POSTGRES_USER`, `POSTGRES_DB` | tidak | Default `sima` |
| `SESSION_TTL_HOURS`, `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES`, `MAX_UPLOAD_MB` | tidak | Lihat `.env.example` |
| `BACKUP_INTERVAL_HOURS`, `KEEP_DAILY`, `KEEP_WEEKLY` | tidak | Backup terjadwal (default 24 jam, 7 harian + 4 mingguan; `0` mematikan) |

Volume:

| Volume | Isi |
|---|---|
| `/var/lib/postgresql/data` | Database (**wajib persisten**) |
| `/data/storage` | Foto dan lampiran privat (**wajib persisten**) |
| `/backups` | Hasil backup (disarankan di-bind ke folder host) |

Jalankan:

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f sima
```

Saat start, container otomatis: menginisialisasi database (pertama kali), membuat user dan database sesuai env, menerapkan migrasi, menjalankan seed idempoten, menyalakan backup terjadwal, lalu server. Aman di-restart dan di-update berulang.

## 3. HTTPS (wajib)

Container hanya berbicara HTTP di port 8080 dan **harus berada di belakang reverse proxy yang menyajikan HTTPS** (Caddy, Nginx, Traefik, Nginx Proxy Manager, Cloudflare Tunnel, dsb.). Alasannya: cookie sesi ditandai `Secure`, kamera pemindai QR dan PWA hanya berfungsi di HTTPS (kecuali `localhost`), dan aplikasi menolak start bila `COOKIE_SECURE` dimatikan pada produksi.

Contoh Caddy di server yang sama:

```
sima.contoh.go.id {
    reverse_proxy 127.0.0.1:8080
}
```

Catatan:
- Compose contoh hanya mengikat `127.0.0.1:8080`. **Jangan** membuka port 8080 langsung ke internet; aplikasi mempercayai header `X-Forwarded-*` dari proxy di depannya.
- Teruskan header `Host` dan `X-Forwarded-For`/`-Proto` apa adanya (default Caddy/Nginx Proxy Manager sudah benar). Batasi ukuran body proxy minimal `MAX_UPLOAD_MB` + 2 MB.

## 4. Login pertama

Buka `https://<domain>`, masuk dengan `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD`, ganti sandi, lalu isi identitas instansi di **Pengaturan → Pengaturan Aplikasi**. Setelah itu `BOOTSTRAP_ADMIN_PASSWORD` tidak dipakai lagi (boleh dihapus dari environment).

## 5. Pembaruan versi

```bash
# ubah tag image di compose bila perlu, lalu:
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml exec sima sima-backup   # backup sebelum update
docker compose -f docker-compose.prod.yml up -d
```

Migrasi database diterapkan otomatis saat start. Rollback ke image lama tidak membatalkan migrasi yang sudah berjalan; bila migrasi baru tidak kompatibel, pulihkan dari backup (`BACKUP-RESTORE.md`).

## 6. Operasi

```bash
docker compose -f docker-compose.prod.yml ps                 # status; kolom health = healthy
docker compose -f docker-compose.prod.yml restart sima
docker compose -f docker-compose.prod.yml down               # hentikan; data aman di volume
```

Jangan `down -v` kecuali ingin menghapus seluruh data. Health: `GET /api/v1/health` (memeriksa koneksi database). Penghentian container berlangsung rapi (server web dihentikan lalu PostgreSQL dimatikan dengan mode fast), sehingga restart tidak memicu crash recovery.

## 7. Batasan desain image tunggal

- PostgreSQL di dalam container yang sama: satu proses yang mati (database atau server) menghentikan container, lalu `restart: unless-stopped` menyalakannya lagi. Tidak ada replikasi/failover; keandalan bergantung pada backup yang disalin ke luar server.
- Memperbarui versi mayor PostgreSQL (16 → 17) bukan sekadar mengganti image; lakukan lewat backup dan restore.
- Ukuran image ±1,3 GB (basis PostgreSQL resmi + Node.js).

## Status verifikasi

Image dibangun dan dijalankan di sandbox pengembangan dengan **hanya environment variable**: inisialisasi database, migrasi, seed, health `healthy`, web dan API pada satu port, header keamanan, cookie `Secure`, database tidak terbuka ke luar, restart dan stop rapi (exit 0), data bertahan setelah restart, backup terjadwal, restore ke volume baru. E2E pengaturan instansi (dengan CSP asli dari server) 13/13 dan E2E PWA offline 16/16 dijalankan langsung terhadap container. Belum diuji: build lewat GitHub Actions (workflow belum pernah dijalankan di GitHub), dan HTTPS lewat reverse proxy sungguhan.
