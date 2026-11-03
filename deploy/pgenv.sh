# Variabel koneksi PostgreSQL internal untuk skrip backup/restore (di-source, bukan dijalankan).
export PGHOST=127.0.0.1 PGPORT=5432
export PGUSER="${POSTGRES_USER:-sima}"
export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD wajib diisi}"
export PGDATABASE="${POSTGRES_DB:-sima}"
export STORAGE_DIR="${STORAGE_DIR:-/data/storage}"
export BACKUP_DIR="${BACKUP_DIR:-/backups}"
