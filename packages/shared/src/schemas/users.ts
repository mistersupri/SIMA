import { z } from 'zod';
import { optionalUuid, requiredText, uuid } from './common';
import { passwordSchema } from './auth';

const email = z.string().trim().toLowerCase().email('Format email tidak valid');

export const createUserSchema = z.object({
  name: requiredText('Nama', 120),
  email,
  password: passwordSchema,
  unitId: optionalUuid('Unit kerja'),
  roleIds: z.array(uuid('Role')).min(1, 'Pilih minimal satu role'),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: requiredText('Nama', 120),
  email,
  unitId: optionalUuid('Unit kerja'),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const userStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });
export const userRolesSchema = z.object({ roleIds: z.array(uuid('Role')).min(1, 'Pilih minimal satu role') });
export const userUnitAccessSchema = z.object({ unitIds: z.array(uuid('Unit kerja')) });
export const adminResetPasswordSchema = z.object({ newPassword: passwordSchema });

export const createRoleSchema = z.object({
  code: requiredText('Kode role', 40).transform((v) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '_')),
  name: requiredText('Nama role', 80),
  description: z.string().trim().max(300).nullish().transform((v) => v || null),
});
export const rolePermissionsSchema = z.object({ permissions: z.array(z.string().min(3).max(60)) });

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  unitId: string | null;
  unit: { id: string; name: string } | null;
  roles: { id: string; code: string; name: string }[];
  lastLoginAt: string | null;
  createdAt: string;
}

export const organizationSchema = z.object({
  name: requiredText('Nama instansi', 150),
  address: z.string().trim().max(300).nullish().transform((v) => v || null),
  phone: z.string().trim().max(40).nullish().transform((v) => v || null),
  email: z.string().trim().toLowerCase().nullish().transform((v) => v || null).pipe(z.string().email('Format email tidak valid').nullable()),
});
export type OrganizationInput = z.infer<typeof organizationSchema>;
