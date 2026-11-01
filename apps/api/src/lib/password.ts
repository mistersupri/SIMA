import { hash, verify } from '@node-rs/argon2';

// Argon2id (default @node-rs/argon2) dengan parameter minimum OWASP: 19 MiB, 2 iterasi.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => hash(plain, OPTIONS);

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
