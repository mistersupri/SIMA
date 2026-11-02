#!/bin/sh
# Backup SIMA: dump database (format custom) + arsip folder file privat + checksum.
# Variabel: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE, STORAGE_DIR, BACKUP_DIR,
#           KEEP_DAILY (default 7), KEEP_WEEKLY (default 4).
# Keluar non-zero bila langkah apa pun gagal. Backup yang tidak lolos verifikasi dihapus.
set -eu

: "${PGDATABASE:?PGDATABASE wajib diisi}"
: "${STORAGE_DIR:?STORAGE_DIR wajib diisi}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"

stamp="$(date +%Y%m%d-%H%M%S)"
final="$BACKUP_DIR/sima-$stamp"
# Ditulis ke folder sementara dan baru diganti namanya setelah semua verifikasi lolos,
# sehingga backup yang gagal tidak pernah menyentuh backup yang sudah ada.
dir="$BACKUP_DIR/.partial-$stamp-$$"
[ ! -e "$final" ] || { echo "[backup] GAGAL: $final sudah ada, coba lagi sebentar lagi" >&2; exit 1; }
mkdir -p "$dir"
fail() { echo "[backup] GAGAL: $1" >&2; rm -rf "$dir"; exit 1; }

echo "[backup] dump database $PGDATABASE"
pg_dump --format=custom --no-owner --file="$dir/db.dump" || fail "pg_dump"
pg_restore --list "$dir/db.dump" >/dev/null || fail "dump tidak dapat dibaca pg_restore"

echo "[backup] arsip file privat dari $STORAGE_DIR"
mkdir -p "$STORAGE_DIR"
tar -C "$STORAGE_DIR" -czf "$dir/storage.tar.gz" . || fail "tar storage"
tar -tzf "$dir/storage.tar.gz" >/dev/null || fail "arsip storage rusak"

( cd "$dir" && sha256sum db.dump storage.tar.gz > SHA256SUMS && sha256sum -c SHA256SUMS >/dev/null ) || fail "checksum"
{ echo "dibuat=$stamp"; echo "database=$PGDATABASE"; echo "pg_dump=$(pg_dump --version)"; } > "$dir/MANIFEST"
# Backup yang dibuat pada hari Minggu ditandai mingguan.
[ "$(date +%u)" != "7" ] || touch "$dir/weekly"
mv "$dir" "$final" || fail "memindahkan backup"
dir="$final"

echo "[backup] retensi: $KEEP_DAILY harian + $KEEP_WEEKLY mingguan"
n=0
for d in $(ls -1d "$BACKUP_DIR"/sima-* 2>/dev/null | sort -r); do
  n=$((n + 1))
  [ "$n" -le "$KEEP_DAILY" ] && continue
  if [ -f "$d/weekly" ]; then
    w=$((${w:-0} + 1))
    [ "$w" -le "$KEEP_WEEKLY" ] && continue
  fi
  echo "[backup] hapus $d"
  rm -rf "$d"
done

echo "[backup] selesai: $dir ($(du -sh "$dir" | cut -f1))"
