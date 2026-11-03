# syntax=docker/dockerfile:1
# Image tunggal SIMA: aplikasi web + API + PostgreSQL 16 + backup terjadwal.
# Build dari root repo:  docker build -f deploy/Dockerfile -t sima .

FROM node:22-bookworm AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm --filter @sima/api exec prisma generate \
 && pnpm --filter @sima/shared build \
 && pnpm --filter @sima/api build \
 && pnpm --filter @sima/web build \
 && pnpm --filter @sima/api deploy --legacy --prod /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/web/dist /out/web \
 && cd /out && ./node_modules/.bin/prisma generate

FROM node:22-bookworm-slim AS node-bin

# Basis PostgreSQL resmi (sudah memuat libssl, tzdata, gosu); Node.js disalin dari image resmi Node.
FROM postgres:16-bookworm AS runtime
COPY --from=node-bin /usr/local/bin/node /usr/local/bin/node
RUN useradd --system --uid 1001 --create-home --shell /usr/sbin/nologin sima \
 && mkdir -p /data/storage /backups \
 && chown -R sima:sima /data
ENV NODE_ENV=production \
    API_PORT=8080 \
    WEB_DIST=/app/web \
    STORAGE_DIR=/data/storage \
    COOKIE_SECURE=true \
    TZ=Asia/Jakarta \
    PGDATA=/var/lib/postgresql/data
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/prisma ./prisma
COPY --from=build /out/web ./web
COPY --from=build /out/package.json ./package.json
COPY deploy/entrypoint.sh deploy/pgenv.sh deploy/backup.sh deploy/restore.sh deploy/sima-backup /app/deploy/
RUN chmod +x /app/deploy/*.sh /app/deploy/sima-backup && ln -s /app/deploy/sima-backup /usr/local/bin/sima-backup
EXPOSE 8080
VOLUME ["/var/lib/postgresql/data", "/data/storage", "/backups"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.API_PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
CMD ["serve"]
