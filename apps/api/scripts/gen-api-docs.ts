import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { renderApiDocs } from '../src/docs/generate';
import type { RouteInfo } from '../src/docs/routes';

const inventory: RouteInfo[] = [];
const app = await buildApp(loadEnv(), { inventory });
await app.ready();
const out = path.resolve(process.cwd(), '../../docs/API.md');
writeFileSync(out, renderApiDocs(inventory));
console.log(`Dokumentasi API ditulis ke ${out} (${inventory.length} endpoint)`);
await app.close();
