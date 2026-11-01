import { z } from 'zod';

export const uuid = (label = 'ID') => z.string().uuid(`${label} tidak valid`);

export const requiredText = (label: string, max = 200) =>
  z
    .string({ error: `${label} wajib diisi` })
    .trim()
    .min(1, `${label} wajib diisi`)
    .max(max, `${label} maksimal ${max} karakter`);

/** String opsional: kosong dianggap tidak diisi (null). */
export const optionalText = (label: string, max = 500) =>
  z
    .string()
    .trim()
    .max(max, `${label} maksimal ${max} karakter`)
    .nullish()
    .transform((v) => (v ? v : null));

export const optionalUuid = (label: string) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.string().uuid(`${label} tidak valid`).nullable());

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .transform((v) => (v ? v : null))
  .pipe(z.string().email('Format email tidak valid').nullable());

export const codeField = (label: string) =>
  requiredText(label, 30).transform((v) => v.toUpperCase().replace(/\s+/g, '-'));
