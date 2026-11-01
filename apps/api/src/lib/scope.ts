import type { AuthContext } from '../plugins/auth';
import { forbidden } from './errors';

/** Pembatasan data per unit kerja (user_unit_access). Kosong berarti tanpa pembatasan. */
export const unitScope = (auth: AuthContext) => (auth.unitAccess.length ? { unitId: { in: auth.unitAccess } } : {});

export function assertUnitAccess(auth: AuthContext, unitId: string) {
  if (auth.unitAccess.length && !auth.unitAccess.includes(unitId)) {
    throw forbidden('Anda tidak memiliki akses ke unit kerja ini');
  }
}
