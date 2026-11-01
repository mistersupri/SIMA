import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const isWin = process.platform === 'win32';

export const log = (msg) => console.log(`\x1b[36m[sima]\x1b[0m ${msg}`);
export const fail = (msg) => {
  console.error(`\x1b[31m[sima]\x1b[0m ${msg}`);
  process.exit(1);
};

export function ensureEnvFile() {
  const envPath = path.join(root, '.env');
  if (existsSync(envPath)) return;
  copyFileSync(path.join(root, '.env.example'), envPath);
  const text = readFileSync(envPath, 'utf8').replace(
    /^SESSION_SECRET=.*$/m,
    `SESSION_SECRET=${randomBytes(32).toString('hex')}`,
  );
  writeFileSync(envPath, text);
  log('.env dibuat dari .env.example (SESSION_SECRET diacak). Ubah BOOTSTRAP_ADMIN_PASSWORD bila perlu.');
}

export function readEnv() {
  const env = {};
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: isWin, ...opts });
  return res.status ?? 1;
}

export function dockerAvailable() {
  const res = spawnSync('docker', ['info'], { stdio: 'ignore', shell: isWin });
  return res.status === 0;
}

export function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export function startProcess(name, color, cmd, args, children) {
  const child = spawn(cmd, args, { cwd: root, shell: isWin, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) out.write(prefix + line + '\n');
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  children.push(child);
  return child;
}
