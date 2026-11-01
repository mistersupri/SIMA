import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import type { Prisma } from '@prisma/client';
import type { Env } from '../config/env';
import { badRequest } from './errors';

type Tx = Prisma.TransactionClient;

/** Tipe yang diizinkan, ditentukan dari isi file (magic bytes), bukan dari nama atau header klien. */
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export const storageRoot = (env: Env) => path.resolve(process.cwd(), env.STORAGE_DIR);

export async function saveFile(
  tx: Tx,
  env: Env,
  input: { buffer: Buffer; originalName: string; userId: string; kinds?: ('image' | 'pdf')[] },
) {
  if (input.buffer.length === 0) throw badRequest('File kosong');
  const detected = await fileTypeFromBuffer(input.buffer);
  const ext = detected ? ALLOWED[detected.mime] : undefined;
  const kinds = input.kinds ?? ['image', 'pdf'];
  const kindOk = detected && ((detected.mime.startsWith('image/') && kinds.includes('image')) || (detected.mime === 'application/pdf' && kinds.includes('pdf')));
  if (!detected || !ext || !kindOk) {
    throw badRequest('Jenis file tidak diizinkan. Gunakan JPG, PNG, WebP' + (kinds.includes('pdf') ? ' atau PDF.' : '.'));
  }

  const now = new Date();
  const storageKey = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
  const full = path.join(storageRoot(env), storageKey);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, input.buffer, { mode: 0o640 });

  try {
    return await tx.file.create({
      data: {
        storageKey,
        originalName: input.originalName.replace(/[^\w.\- ()]/g, '_').slice(0, 150) || `file.${ext}`,
        mimeType: detected.mime,
        sizeBytes: input.buffer.length,
        sha256: createHash('sha256').update(input.buffer).digest('hex'),
        uploadedById: input.userId,
      },
    });
  } catch (err) {
    await rm(full, { force: true });
    throw err;
  }
}

export async function readStoredFile(env: Env, storageKey: string) {
  const root = storageRoot(env);
  const full = path.resolve(root, storageKey);
  if (!full.startsWith(root + path.sep)) throw new Error('path traversal');
  return readFile(full);
}

export async function removeStoredFile(env: Env, storageKey: string) {
  const root = storageRoot(env);
  const full = path.resolve(root, storageKey);
  if (full.startsWith(root + path.sep)) await rm(full, { force: true });
}
