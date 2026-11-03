# Publikasi image (GitHub Actions)

Satu workflow: `.github/workflows/publish.yml`. Ia membangun **satu image** (`deploy/Dockerfile`: web + API + PostgreSQL) dan mempublikasikannya ke GitHub Container Registry. Tidak ada langkah deploy; Anda menjalankan image itu dengan Docker Compose (lihat `DEPLOYMENT.md`).

| Pemicu | Tag yang dihasilkan |
|---|---|
| Push tag `vX.Y.Z` | `ghcr.io/<pemilik>/sima:X.Y.Z`, `:X.Y`, `:latest` |
| Manual (Actions → *Publish image* → Run workflow) | `ghcr.io/<pemilik>/sima:<tag yang Anda isi>` (tidak mengubah `latest`) |

Tag pra-rilis (`v1.0.0-rc.1`) tidak memicu workflow.

## Merilis

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Lalu di server, pakai `image: ghcr.io/<pemilik>/sima:1.0.0` pada compose, `docker compose pull`, `docker compose up -d`.

## Prasyarat repositori

- Settings → Actions → General → Workflow permissions: izinkan **read and write** (atau biarkan izin `packages: write` pada workflow berlaku; sudah dideklarasikan di berkas).
- Paket GHCR baru bersifat **privat**. Untuk menariknya di server: `docker login ghcr.io` dengan Personal Access Token (izin `read:packages`), atau ubah visibilitas paket ke publik di halaman paket (Package settings).
- Nama image otomatis huruf kecil dari pemilik repositori. Sesuaikan `image:` di `docker-compose.prod.yml` bila pemilik berbeda dari `mistersupri`.

## Catatan

- Workflow **belum pernah dijalankan di GitHub**. Dockerfile yang sama sudah dibangun dan dijalankan di sandbox pengembangan; yang belum teruji hanya sisi GitHub (login GHCR, cache, penandaan tag). Jalankan pertama kali lewat *Run workflow* dengan tag `dev`.
- Workflow tidak menjalankan tes. Jalankan `pnpm test` dan E2E lokal sebelum memberi tag rilis.
- Build hanya `linux/amd64`. Untuk server ARM, tambahkan `platforms: linux/amd64,linux/arm64` (dan langkah `docker/setup-qemu-action`) pada langkah build; build menjadi jauh lebih lama.
