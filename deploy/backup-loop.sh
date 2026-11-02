#!/bin/sh
# Menjalankan backup.sh setiap BACKUP_INTERVAL_HOURS jam (default 24), pertama kali setelah jeda awal.
# Kegagalan dicatat dan dicoba lagi pada putaran berikutnya; container tetap hidup.
interval="$(( ${BACKUP_INTERVAL_HOURS:-24} * 3600 ))"
sleep "${BACKUP_INITIAL_DELAY_SECONDS:-60}"
while true; do
  /scripts/backup.sh || echo "[backup] PERINGATAN: backup gagal, periksa log" >&2
  sleep "$interval"
done
