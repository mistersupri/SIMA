#!/bin/bash
# Entrypoint image tunggal SIMA.
#   serve   (default)  jalankan PostgreSQL, migrasi, seed, backup terjadwal, dan server web+API
#   restore <folder-backup> [--yes] [--force]   pulihkan backup (hentikan container serve lebih dulu)
set -euo pipefail

mode="${1:-serve}"; shift || true
export PATH="/usr/lib/postgresql/16/bin:$PATH"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
POSTGRES_USER="${POSTGRES_USER:-sima}"
POSTGRES_DB="${POSTGRES_DB:-sima}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD wajib diisi}"
for v in POSTGRES_USER POSTGRES_DB; do
  [[ "${!v}" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "[sima] $v hanya boleh huruf kecil, angka, dan underscore" >&2; exit 1; }
done
export POSTGRES_USER POSTGRES_DB
log() { echo "[sima] $*"; }

PG_PID=""; APP_PID=""; BK_PID=""

start_postgres() {
  mkdir -p "$PGDATA" /var/run/postgresql /data/storage
  chown postgres:postgres /var/run/postgresql
  chown -R sima:sima /data
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    log "inisialisasi database baru"
    chown postgres:postgres "$PGDATA"; chmod 700 "$PGDATA"
    gosu postgres initdb -D "$PGDATA" -U postgres --encoding=UTF8 --auth-local=trust --auth-host=scram-sha-256 >/dev/null
  fi
  # Hanya mendengarkan 127.0.0.1: database tidak dapat dijangkau dari luar container.
  gosu postgres postgres -D "$PGDATA" -c listen_addresses=127.0.0.1 -c unix_socket_directories=/var/run/postgresql \
    -c password_encryption=scram-sha-256 &
  PG_PID=$!
  for _ in $(seq 1 90); do
    pg_isready -q -h /var/run/postgresql && break
    kill -0 "$PG_PID" 2>/dev/null || { log "PostgreSQL berhenti saat start" >&2; exit 1; }
    sleep 1
  done
  pg_isready -q -h /var/run/postgresql || { log "PostgreSQL tidak siap" >&2; exit 1; }
  # Idempoten; kata sandi mengikuti env pada setiap start.
  psql -h /var/run/postgresql -U postgres -v ON_ERROR_STOP=1 -q -v u="$POSTGRES_USER" -v pw="$POSTGRES_PASSWORD" -v db="$POSTGRES_DB" postgres <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'u', :'pw') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'u') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'u', :'pw') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'u') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db') \gexec
SQL
}

stop_all() {
  [ -n "$BK_PID" ] && kill "$BK_PID" 2>/dev/null || true
  if [ -n "$APP_PID" ]; then kill -TERM "$APP_PID" 2>/dev/null || true; wait "$APP_PID" 2>/dev/null || true; fi
  if [ -n "$PG_PID" ]; then kill -INT "$PG_PID" 2>/dev/null || true; wait "$PG_PID" 2>/dev/null || true; fi
}

case "$mode" in
  restore)
    start_postgres
    trap stop_all EXIT
    . /app/deploy/pgenv.sh
    rc=0
    sh /app/deploy/restore.sh "$@" || rc=$?
    chown -R sima:sima /data
    exit "$rc"
    ;;
  serve) ;;
  *) echo "Mode tidak dikenal: $mode (serve | restore)" >&2; exit 2 ;;
esac

: "${SESSION_SECRET:?SESSION_SECRET wajib diisi (minimal 32 karakter acak)}"
: "${APP_URL:?APP_URL wajib diisi (mis. https://sima.contoh.go.id)}"

start_postgres
trap 'log "menerima sinyal berhenti"; stop_all; exit 0' TERM INT

enc_pw="$(node -e 'process.stdout.write(encodeURIComponent(process.env.POSTGRES_PASSWORD))')"
export DATABASE_URL="postgresql://${POSTGRES_USER}:${enc_pw}@127.0.0.1:5432/${POSTGRES_DB}?schema=public"
cd /app
log "menerapkan migrasi database"
gosu sima ./node_modules/.bin/prisma migrate deploy
log "seed data dasar (idempoten)"
gosu sima node dist/seed.js

hours="${BACKUP_INTERVAL_HOURS:-24}"
if [ "$hours" -gt 0 ]; then
  (
    sleep "${BACKUP_INITIAL_DELAY_SECONDS:-300}"
    while true; do
      /app/deploy/sima-backup || echo "[sima] PERINGATAN: backup terjadwal gagal, periksa log di atas" >&2
      sleep $((hours * 3600))
    done
  ) &
  BK_PID=$!
  log "backup terjadwal tiap ${hours} jam ke ${BACKUP_DIR:-/backups}"
fi

log "menjalankan server pada port ${API_PORT}"
gosu sima node dist/server.js &
APP_PID=$!

wait -n "$PG_PID" "$APP_PID" || true
log "salah satu proses berhenti tak terduga; menghentikan container" >&2
stop_all
exit 1
