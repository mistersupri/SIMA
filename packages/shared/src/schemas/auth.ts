import { z } from 'zod';
import { requiredText } from './common';

export const passwordSchema = z
  .string({ error: 'Password wajib diisi' })
  .min(10, 'Password minimal 10 karakter')
  .max(128, 'Password maksimal 128 karakter')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Password harus memuat huruf besar, huruf kecil, dan angka',
  });

export const loginSchema = z.object({
  email: z.string({ error: 'Email wajib diisi' }).trim().toLowerCase().email('Format email tidak valid'),
  password: z.string({ error: 'Password wajib diisi' }).min(1, 'Password wajib diisi').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: requiredText('Password saat ini', 128),
    newPassword: passwordSchema,
    confirmPassword: requiredText('Konfirmasi password', 128),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Konfirmasi password tidak sama',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'Password baru harus berbeda dari password saat ini',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Format email tidak valid'),
});

export const resetPasswordSchema = z.object({
  token: requiredText('Token', 200),
  newPassword: passwordSchema,
});

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  unitId: string | null;
  mustChangePassword: boolean;
  roles: { code: string; name: string }[];
  permissions: string[];
}

export interface AuthPayload {
  user: SessionUser;
  csrfToken: string;
}
