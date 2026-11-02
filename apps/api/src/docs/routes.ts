import type { FastifyInstance } from 'fastify';
import { authenticate } from '../plugins/auth';

export interface RouteInfo { method: string; url: string; auth: boolean; permissions: string[] }

/** Mengumpulkan semua route terdaftar beserta syarat autentikasi dan permission-nya (dari metadata handler). */
export function collectRoutes(app: FastifyInstance, out: RouteInfo[]): void {
  app.addHook('onRoute', (r) => {
    const methods = (Array.isArray(r.method) ? r.method : [r.method]).filter((m) => m !== 'HEAD' && m !== 'OPTIONS');
    const pre = ([] as unknown[]).concat(r.preHandler ?? []).flat() as (((...a: never[]) => unknown) & { requiredPermissions?: string[] })[];
    const permissions = pre.flatMap((f) => f.requiredPermissions ?? []);
    const auth = pre.includes(authenticate as never) || permissions.length > 0;
    for (const method of methods) out.push({ method, url: r.url, auth, permissions });
  });
}
