#!/bin/sh
# Pulihkan SIMA dari folder backup. Pemakaian:
#   restore.sh <folder-backup> [--yes] [--force]
# Variabel: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE, STORAGE_DIR.
# Proteksi: checksum diverifikasi, konfirmasi diminta (kecuali --yes), dan database tujuan yang
# sudah berisi data DITOLAK kecuali --force (data lama akan ditimpa).
set -eu

src="${1:-}"; shift || true
yes=0; force=0
for a in "$@"; do case "$a" in --yes) yes=1 ;; --force) force=1 ;; *) echo "opsi tidak dikenal: $a" >&2; exit 2 ;; esac; done
[ -d "$src" ] || { echo "Pemakaian: restore.sh <folder-backup> [--yes] [--force]" >&2; exit 2; }
: "${PGDATABASE:?PGDATABASE wajib diisi}"
: "${STORAGE_DIR:?STORAGE_DIR wajib diisi}"

echo "[restore] verifikasi checksum"
( cd "$src" && sha256sum -c SHA256SUMS ) || { echo "[restore] checksum tidak cocok, dibatalkan" >&2; exit 1; }
pg_restore --list "$src/db.dump" >/dev/null || { echo "[restore] dump rusak" >&2; exit 1; }

if ! psql -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='$PGDATABASE'" | grep -q 1; then
  echo "[restore] membuat database $PGDATABASE"
  createdb "$PGDATABASE"
fi
tables="$(psql -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
if [ "$tables" -gt 0 ] && [ "$force" -ne 1 ]; then
  echo "[restore] database '$PGDATABASE' sudah berisi $tables tabel. Gunakan --force untuk menimpa." >&2
  exit 1
fi
if [ "$yes" -ne 1 ]; then
  printf "Ini MENIMPA database '%s' dan folder file '%s'. Ketik PULIHKAN untuk lanjut: " "$PGDATABASE" "$STORAGE_DIR"
  read -r answer
  [ "$answer" = "PULIHKAN" ] || { echo "[restore] dibatalkan"; exit 1; }
fi

echo "[restore] memulihkan database"
pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error -d "$PGDATABASE" "$src/db.dump"

echo "[restore] memulihkan file privat"
if [ -d "$STORAGE_DIR" ] && [ -n "$(ls -A "$STORAGE_DIR" 2>/dev/null)" ]; then
  aside="$STORAGE_DIR.sebelum-restore-$(date +%Y%m%d-%H%M%S)"
  mv "$STORAGE_DIR" "$aside"; echo "[restore] folder lama disimpan di $aside"
fi
mkdir -p "$STORAGE_DIR"
tar -C "$STORAGE_DIR" -xzf "$src/storage.tar.gz"
echo "[restore] selesai"
