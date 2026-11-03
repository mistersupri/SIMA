import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * CSP aplikasi web. Skrip hanya dari origin sendiri tanpa eval/inline; style 'unsafe-inline' diperlukan Radix UI.
 * Satu baris agar e2e/tahap8.cjs dapat membacanya dari berkas ini.
 */
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

const isApi = (url: string) => url === '/api' || url.startsWith('/api/');

/** Menyajikan hasil build web (SPA) dari proses API yang sama, dengan fallback index.html dan header keamanan. */
export async function registerWeb(app: FastifyInstance, root: string) {
  const indexFile = path.join(root, 'index.html');
  if (!existsSync(indexFile)) throw new Error(`WEB_DIST tidak berisi index.html: ${root}`);
  const indexHtml = readFileSync(indexFile);

  app.addHook('onSend', async (req, reply, payload) => {
    if (!isApi(req.url)) {
      reply.header('content-security-policy', CSP);
      reply.header('x-frame-options', 'DENY');
      reply.header('permissions-policy', 'camera=(self), microphone=(), geolocation=()');
    }
    return payload;
  });

  await app.register(fastifyStatic, {
    root,
    index: false,
    cacheControl: false, // diatur di setHeaders
    // Aset ber-hash aman di-cache lama; berkas lain (index, sw.js, manifest) harus selalu segar agar pembaruan sampai.
    setHeaders: (res, filePath) => {
      const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
      res.setHeader('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  // Direktori akar ditolak (403) oleh plugin statis bila index dimatikan, jadi dilayani eksplisit.
  app.get('/', (_req, reply) => reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(indexHtml));

  // Dipanggil dari setNotFoundHandler di app.ts.
  return (req: { method: string; url: string }) => {
    const pathname = req.url.split('?')[0]!;
    const spa = (req.method === 'GET' || req.method === 'HEAD') && !isApi(pathname) && path.extname(pathname) === '';
    return spa ? indexHtml : null;
  };
}
