#!/bin/sh
# Terapkan migrasi, jalankan seed idempoten (permission, role, Super Admin pertama), lalu start server.
set -eu
echo "[sima] menerapkan migrasi database"
./node_modules/.bin/prisma migrate deploy
echo "[sima] seed data dasar (idempoten)"
node dist/seed.js
echo "[sima] menjalankan server"
exec node dist/server.js
