# CI/CD (GitHub Actions)

Dua workflow di `.github/workflows/`:

| Workflow | Pemicu | Fungsi |
|---|---|---|
| `ci.yml` | push ke `main`, pull request, dipanggil `release.yml` | Typecheck, build, seluruh test (PostgreSQL 16 sebagai service), build image Docker `api` dan `web` (tanpa push), validasi `docker-compose.prod.yml` |
| `release.yml` | tag versi stabil `vX.Y.Z`, atau manual (`workflow_dispatch`) | CI → publikasi image ke GHCR → deploy ke server produksi |

## Image yang dipublikasikan

`ghcr.io/<pemilik>/sima-api` dan `ghcr.io/<pemilik>/sima-web`, dengan tag `X.Y.Z`, `X.Y`, dan `latest`. Dipublikasikan memakai `GITHUB_TOKEN` (tidak perlu secret tambahan). Paket GHCR bersifat privat secara default; server menariknya dengan token dari job deploy.

## Menyiapkan deploy (sekali saja)

**1. Server** (Docker + Compose v2 terpasang, lihat `DEPLOYMENT.md`):

```bash
mkdir -p /opt/sima && cd /opt/sima
# buat .env dari .env.production.example dan isi semua nilai GANTI
```

`.env` dikelola manual di server dan tidak pernah dikirim dari CI; pipeline hanya menambah/menimpa `SIMA_API_IMAGE` dan `SIMA_WEB_IMAGE`. Sebaiknya buat user khusus deploy yang boleh menjalankan `docker`.

**2. Kunci SSH khusus deploy:**

```bash
ssh-keygen -t ed25519 -f sima_deploy -N "" -C "github-actions-sima"
ssh-copy-id -i sima_deploy.pub user@server
ssh-keyscan -p 22 server > known_hosts.txt   # periksa fingerprint-nya dengan yang asli!
```

**3. Secrets** (GitHub → Settings → Environments → **production** → Environment secrets):

| Secret | Isi |
|---|---|
| `DEPLOY_HOST` | Hostname/IP server |
| `DEPLOY_USER` | User SSH |
| `DEPLOY_SSH_KEY` | Isi `sima_deploy` (kunci privat) |
| `DEPLOY_KNOWN_HOSTS` | Isi `known_hosts.txt` (verifikasi host; `StrictHostKeyChecking=yes`) |
| `DEPLOY_PATH` | Folder di server, mis. `/opt/sima` |
| `DEPLOY_PORT` | (opsional) port SSH, default 22 |

Aktifkan **Required reviewers** pada environment `production` bila deploy harus disetujui manual. Hapus kunci privat lokal setelah disimpan sebagai secret.

## Merilis versi

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Urutan: CI lulus → image `api`/`web` di-build dan di-push → job deploy: kirim `docker-compose.prod.yml` + `deploy/` ke server, **backup otomatis** (bila stack sudah berjalan; backup gagal = deploy batal), catat versi image di `.env`, `docker compose pull` + `up -d`, tunggu `api` sehat (maks. 200 detik; gagal = job merah dengan log API). Migrasi database berjalan otomatis saat container `api` start.

## Rollback dan redeploy

Actions → **Release** → **Run workflow** → isi `tag` versi sebelumnya (mis. `1.0.0`). Image tidak dibuild ulang; hanya langkah deploy yang dijalankan. Catatan: rollback kode **tidak** membatalkan migrasi database yang sudah diterapkan. Bila migrasi baru tidak kompatibel dengan versi lama, pulihkan dari backup yang dibuat otomatis sebelum deploy (lihat `BACKUP-RESTORE.md`).

## Batasan

- Workflow ini **belum pernah dijalankan di GitHub** (disusun dan diperiksa sintaks YAML/shell serta logika penulisan `.env` secara lokal). Jalankan pertama kali dengan tag uji pada repositori/server staging.
- Hanya satu environment (`production`); tambahkan environment/server lain dengan menyalin job deploy.
- Pengecekan kesehatan memakai healthcheck container `api`; tidak ada rollback otomatis.
- Pipeline tidak menjalankan E2E Playwright (butuh stack penuh dan kamera palsu); jalankan lokal sebelum merilis (lihat `README.md`).
