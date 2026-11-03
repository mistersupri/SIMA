// E2E Tahap 8: pengaturan instansi + kepatuhan CSP produksi.
// Prasyarat: dev stack di DB E2E kosong (API :3001) dan build web dilayani `vite preview` (:4173).
// CSP dibaca dari apps/api/src/plugins/web.ts (sumber yang sama dengan server produksi) dan dipasang
// pada setiap respons dokumen; pelanggaran CSP apa pun menggagalkan tes.
// Mode image produksi: E2E_REAL_HEADERS=1 E2E_PWA_BASE=http://localhost:18080 E2E_BASE=http://localhost:18080
// (container sima dengan volume baru, ORG_NAME='Nama Instansi', admin@sima.local): header CSP berasal dari server,
// tanpa intersepsi.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.E2E_PWA_BASE ?? 'http://localhost:4173';
const API = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUT = path.resolve(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const csp = fs.readFileSync(path.resolve(__dirname, '../apps/api/src/plugins/web.ts'), 'utf8').match(/export const CSP = "([^"]+)"/)[1];
const results = [];
let lastPage = null;
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch();
  const violations = [], consoleErrors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  if (!process.env.E2E_REAL_HEADERS) await ctx.route('**/*', async (route) => {
    const req = route.request();
    if (req.resourceType() !== 'document' && req.resourceType() !== 'script' && req.resourceType() !== 'stylesheet') return route.continue();
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': csp } });
  });
  const page = await ctx.newPage();
  lastPage = page;
  page.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/.test(t)) violations.push(t); else if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(t)) consoleErrors.push(t); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  const cspHits = () => page.evaluate(() => window.__csp ?? []);

  // ---------------------------------------------------------------- login memakai nama instansi dari server
  await page.goto(BASE + '/login');
  await page.getByRole('heading', { name: 'SIMA' }).waitFor();
  await page.getByText('Nama Instansi', { exact: true }).waitFor();
  check('halaman login menampilkan nama instansi dari server (publik, tanpa login)', true);
  await page.getByLabel(/^Email/).fill('admin@sima.local');
  await page.getByLabel(/^Password/).fill('Ganti-Password-Ini-123');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.waitForURL('**/ganti-password');
  await page.getByLabel(/^Password saat ini/).fill('Ganti-Password-Ini-123');
  await page.getByLabel(/^Password baru/).fill('Admin-Baru-98765');
  await page.getByLabel('Ulangi password baru').fill('Admin-Baru-98765');
  await page.getByRole('button', { name: 'Simpan password' }).click();
  await page.waitForURL((u) => !/ganti-password|login/.test(u.pathname));

  // ---------------------------------------------------------------- pengaturan instansi
  await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Pengaturan Aplikasi' }).click();
  await page.getByRole('heading', { name: 'Pengaturan Aplikasi' }).waitFor();
  const save = page.getByRole('button', { name: 'Simpan', exact: true });
  check('tombol Simpan nonaktif sebelum ada perubahan', await save.isDisabled());
  await page.getByLabel(/^Nama instansi/).fill('');
  await save.click();
  check('nama kosong ditolak validasi form', await page.getByText(/wajib diisi/i).first().isVisible());
  await page.getByLabel(/^Nama instansi/).fill('Dinas Pekerjaan Umum Kota Uji');
  await page.getByLabel('Alamat').fill('Jl. Merdeka No. 1');
  await page.getByLabel('Email').fill('bukan-email');
  await save.click();
  check('email tidak valid ditolak', await page.getByText(/email tidak valid/i).first().isVisible());
  await page.getByLabel('Email').fill('umum@dinas.go.id');
  await save.click();
  await page.getByText('Identitas instansi disimpan').waitFor();
  check('perubahan tersimpan dengan notifikasi', true);
  await page.getByRole('link', { name: /SIMA\s*Dinas Pekerjaan Umum Kota Uji/ }).waitFor();
  check('nama instansi baru langsung tampil di header menu', true);
  await page.reload();
  check('data bertahan setelah muat ulang (tersimpan di PostgreSQL)', (await page.getByLabel(/^Nama instansi/).inputValue()) === 'Dinas Pekerjaan Umum Kota Uji' && (await page.getByLabel('Alamat').inputValue()) === 'Jl. Merdeka No. 1');
  await page.screenshot({ path: path.join(OUT, 't8-pengaturan.png') });

  // ---------------------------------------------------------------- halaman lain tetap berfungsi di bawah CSP
  for (const [url, heading] of [['/', null], ['/aset', 'Aset Inventaris'], ['/scan', null], ['/laporan/assets', null], ['/pengaturan/audit-log', null], ['/impor', null]]) {
    await page.goto(BASE + url);
    await page.waitForLoadState('networkidle');
    if (heading) await page.getByRole('heading', { name: heading }).waitFor();
  }
  check('dashboard, aset, scan, laporan, audit log, impor dimuat tanpa pelanggaran CSP', (await cspHits()).length === 0 && violations.length === 0, [...violations, ...(await cspHits())].join(' | ').slice(0, 300));

  // audit log memuat perubahan pengaturan
  await page.goto(BASE + '/pengaturan/audit-log');
  await page.getByRole('cell', { name: 'Organization', exact: true }).first().waitFor({ timeout: 10000 });
  check('perubahan identitas instansi tercatat di audit log', true);

  // ---------------------------------------------------------------- logout: login memuat nama baru
  await page.getByRole('button', { name: /^Menu akun/ }).click();
  await page.getByRole('menuitem', { name: 'Keluar' }).click();
  await page.waitForURL('**/login');
  await page.getByText('Dinas Pekerjaan Umum Kota Uji', { exact: true }).waitFor();
  check('halaman login memakai nama instansi yang baru', true);

  // ---------------------------------------------------------------- pengguna tanpa settings.manage
  const req = ctx.request;
  const csrf = (await (await req.post(`${API}/api/v1/auth/login`, { data: { email: 'admin@sima.local', password: 'Admin-Baru-98765' } })).json()).data.csrfToken;
  const roles = (await (await req.get(`${API}/api/v1/roles/options`)).json()).data;
  const pw = 'Sandi-Uji-12345';
  await req.post(`${API}/api/v1/users`, { headers: { 'x-csrf-token': csrf }, data: { name: 'Rani Admin', email: 'rani@sima.test', password: pw, roleIds: [roles.find((r) => r.code === 'ADMIN_INVENTARIS').id] } });
  await req.post(`${API}/api/v1/auth/logout`, { headers: { 'x-csrf-token': csrf } });
  const ctx2 = await browser.newContext({ serviceWorkers: 'block' });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/login');
  await p2.getByLabel(/^Email/).fill('rani@sima.test');
  await p2.getByLabel(/^Password/).fill(pw);
  await p2.getByRole('button', { name: 'Masuk' }).click();
  await p2.waitForURL('**/ganti-password');
  await p2.getByLabel(/^Password saat ini/).fill(pw);
  await p2.getByLabel(/^Password baru/).fill(pw + 'x');
  await p2.getByLabel('Ulangi password baru').fill(pw + 'x');
  await p2.getByRole('button', { name: 'Simpan password' }).click();
  await p2.waitForURL((u) => !/ganti-password|login/.test(u.pathname));
  check('Admin Inventaris tidak melihat menu Pengaturan Aplikasi', (await p2.getByRole('link', { name: 'Pengaturan Aplikasi' }).count()) === 0);
  await p2.goto(BASE + '/pengaturan/aplikasi');
  await p2.waitForLoadState('networkidle');
  check('akses langsung ke /pengaturan/aplikasi tanpa izin tidak menampilkan formulir', (await p2.getByLabel(/^Nama instansi/).count()) === 0);
  await ctx2.close();

  check('tidak ada console error tak terduga', consoleErrors.length === 0, consoleErrors.join(' || ').slice(0, 300));
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} lulus`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  if (lastPage) await lastPage.screenshot({ path: path.join(OUT, 'error8.png') }).catch(() => {});
  console.error('E2E ERROR', String(e.message).split('\n').slice(0, 8).join('\n'));
  process.exit(2);
});
