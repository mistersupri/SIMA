# Deployment produksi (Docker)

Arsitektur: **Caddy** (HTTPS otomatis, satu-satunya yang membuka port 80/443) meneruskan `/api/*` ke **api** (Fastify) dan sisanya ke **web** (nginx, berkas statis). **db** (PostgreSQL 16) hanya dapat dijangkau jaringan internal Docker. **backup** menjalankan backup terjadwal ke folder `./backups` di host.

```
Internet ── Caddy :443 ─┬─ /api/*  → api :3001 ── db :5432
                        └─ lainnya → web :80
```

## Prasyarat

- Server Linux dengan Docker Engine 24+ dan Docker Compose v2
- Domain yang mengarah ke server (untuk sertifikat Let's Encrypt otomatis); port 80 dan 443 terbuka
- Tanpa domain publik (jaringan internal): set `DOMAIN=localhost` atau nama host internal; Caddy membuat sertifikat dari CA lokalnya (browser meminta dipercaya sekali)

## Langkah

```bash
git clone <repo> sima && cd sima
cp .env.production.example .env
```

Edit `.env`, ganti semua nilai bertanda `GANTI`:

| Variabel | Keterangan |
|---|---|
| `DOMAIN`, `APP_URL` | Domain publik dan URL lengkapnya (`https://...`); `APP_URL` masuk ke isi QR Code |
| `POSTGRES_PASSWORD` | Sandi acak panjang (`openssl rand -base64 32`) |
| `SESSION_SECRET` | Minimal 32 karakter acak (`openssl rand -base64 48`) |
| `BOOTSTRAP_ADMIN_*` | Super Admin pertama; wajib ganti sandi saat login pertama |
| `ORG_CODE` | Kode instansi (bagian kode inventaris; **tidak dapat diubah** setelah ada aset) |

Jalankan:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Saat start, container `api` otomatis menjalankan `prisma migrate deploy` lalu seed idempoten (permission, role, Super Admin bila belum ada), baru menyalakan server. Aman dijalankan berulang.

Buka `https://<DOMAIN>`, login dengan akun bootstrap, ganti sandi, lalu isi identitas instansi di **Pengaturan → Pengaturan Aplikasi**.

## Pembaruan versi

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrasi baru diterapkan otomatis saat `api` start. **Lakukan backup manual sebelum memperbarui** (lihat `BACKUP-RESTORE.md`).

## Operasi sehari-hari

```bash
docker compose -f docker-compose.prod.yml logs -f api      # log API
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml down             # hentikan (data aman di volume)
```

Data ada di volume Docker bernama: `pgdata` (database), `storage` (foto dan lampiran privat), `caddy_data` (sertifikat). **Jangan** menjalankan `down -v` kecuali Anda memang ingin menghapus seluruh data.

## Kesehatan layanan

- API: `GET /api/v1/health` (memeriksa koneksi database); healthcheck Docker memakai ini
- `docker compose ps` menampilkan `healthy` untuk db, api, dan web

## Status verifikasi

Image `api` dan `web` di-build dan seluruh stack (db, api, web, caddy, backup) dijalankan dengan `docker compose` pada sandbox pengembangan: HTTPS lewat Caddy, header keamanan, login dengan cookie `Secure`, port database tidak terbuka ke host, backup otomatis, dan restore terbukti bekerja. Perlu dicatat: sandbox tidak dapat mengunduh paket apt, sehingga uji build memakai basis `node:22-bookworm` (`--build-arg BASE=node:22-bookworm`). Build produksi default memakai `node:22-bookworm-slim` dan memasang `openssl`/`ca-certificates` lewat apt; langkah apt itu standar tetapi **belum dijalankan** di sandbox. Jika build di server gagal pada langkah tersebut, gunakan `--build-arg BASE=node:22-bookworm`.
