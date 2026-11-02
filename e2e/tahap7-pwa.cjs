// E2E Tahap 7b: PWA terhadap BUILD produksi (service worker aktif).
// Prasyarat: API berjalan (dev stack di DB kosong), `pnpm --filter @sima/web build`, dan
//   cd apps/web && pnpm exec vite preview --port 4173   (E2E_PWA_BASE bila port lain)
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const API = process.env.E2E_BASE ?? 'http://localhost:5173'; // dev server hanya sebagai pintu API untuk setup data
const BASE = process.env.E2E_PWA_BASE ?? 'http://localhost:4173';
const OUT = path.resolve(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let lastPage = null;
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); };

async function session(browser, email, password) {
  const request = (await browser.newContext()).request;
  const res = await request.post(`${API}/api/v1/auth/login`, { data: { email, password } });
  const json = await res.json();
  if (!res.ok()) throw new Error(`login API gagal ${email}: ${JSON.stringify(json)}`);
  return { request, csrf: json.data.csrfToken };
}
const call = async (s, method, url, body) => { const r = await s.request.fetch(`${API}/api/v1${url}`, { method, data: body, headers: { 'x-csrf-token': s.csrf } }); return { status: r.status(), body: await r.json().catch(() => null) }; };

(async () => {
  const consoleErrors = [];
  const browser = await chromium.launch();

  // ---------------------------------------------------------- setup data lewat API
  const boot = await session(browser, 'admin@sima.local', 'Ganti-Password-Ini-123');
  await call(boot, 'POST', '/auth/change-password', { currentPassword: 'Ganti-Password-Ini-123', newPassword: 'Admin-Baru-98765', confirmPassword: 'Admin-Baru-98765' });
  const A = await session(browser, 'admin@sima.local', 'Admin-Baru-98765');
  const roles = (await call(A, 'GET', '/roles/options')).body.data;
  const PW = 'Sandi-Uji-12345', PW2 = PW + 'x';
  const ids = {};
  for (const [name, email, role] of [['Dewi Petugas', 'petugas@sima.test', 'PETUGAS_INVENTARIS'], ['Rani Admin', 'admin2@sima.test', 'ADMIN_INVENTARIS']]) {
    ids[email] = (await call(A, 'POST', '/users', { name, email, password: PW, roleIds: [roles.find((r) => r.code === role).id] })).body.data.id;
    const t = await session(browser, email, PW);
    await call(t, 'POST', '/auth/change-password', { currentPassword: PW, newPassword: PW2, confirmPassword: PW2 });
  }
  const opt = async (p) => (await call(A, 'GET', `${p}?limit=100`)).body.data;
  const [cats, uoms, units] = [await opt('/categories'), await opt('/units'), await opt('/organizational-units')];
  const laptop = (await call(A, 'POST', '/items', { name: 'Laptop', type: 'ASSET', categoryId: cats.find((c) => c.code === 'ELK').id, unitOfMeasureId: uoms.find((u) => u.code === 'UNIT').id })).body.data;
  const lt1 = (await call(A, 'POST', '/locations', { code: 'LT-1', name: 'Lantai 1', type: 'FLOOR' })).body.data;
  const assets = (await call(A, 'POST', '/assets', { itemId: laptop.id, quantity: 3, acquisitionYear: 2026, unitId: units[0].id, locationId: lt1.id })).body.data;
  const adm2 = await session(browser, 'admin2@sima.test', PW2);
  const op = (await call(adm2, 'POST', '/stock-opnames', { title: 'Opname PWA', periodStart: '2026-11-01', periodEnd: '2026-11-30', locationId: lt1.id, assigneeIds: [ids['petugas@sima.test']] })).body.data;
  await call(adm2, 'POST', `/stock-opnames/${op.id}/start`);
  const summary = async () => (await call(adm2, 'GET', `/stock-opnames/${op.id}`)).body.data.summary;
  check('setup via API: sesi opname berjalan dengan 3 aset', (await summary()).NOT_CHECKED === 3);

  // ---------------------------------------------------------- manifest dan ikon
  const mres = await fetch(`${BASE}/manifest.webmanifest`);
  const manifest = await mres.json();
  check('manifest valid: nama, standalone, warna tema, bahasa Indonesia', mres.ok && manifest.short_name === 'SIMA' && manifest.display === 'standalone' && manifest.theme_color === '#172554' && manifest.lang === 'id' && manifest.start_url === '/');
  const iconRes = await Promise.all(manifest.icons.map((i) => fetch(new URL(i.src, BASE))));
  check('semua ikon manifest dapat diunduh sebagai PNG (192, 512, maskable)', iconRes.every((r) => r.ok && r.headers.get('content-type') === 'image/png') && manifest.icons.some((i) => i.purpose === 'maskable'));

  // ---------------------------------------------------------- login dan service worker
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  lastPage = page;
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource|net::ERR/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(BASE + '/login');
  await page.getByLabel(/^Email/).fill('petugas@sima.test');
  await page.getByLabel(/^Password/).fill(PW2);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.waitForURL((u) => !/login/.test(u.pathname));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.goto(`${BASE}/opname/${op.id}/periksa`);
  await page.getByText('Diperiksa 0 dari 3').waitFor();
  await page.reload(); // setelah reload, halaman dikendalikan service worker
  await page.getByText('Diperiksa 0 dari 3').waitFor();
  check('service worker terpasang dan mengendalikan halaman', await page.evaluate(() => !!navigator.serviceWorker.controller));
  const cached = await page.evaluate(async () => { const out = []; for (const k of await caches.keys()) { const c = await caches.open(k); out.push(...(await c.keys()).map((r) => new URL(r.url).pathname)); } return out; });
  check('cache hanya berisi shell aplikasi: tidak ada /api/ (data dan file privat tidak pernah di-cache)', cached.length > 5 && cached.every((p) => !p.startsWith('/api/')), `${cached.length} entri`);
  check('profil tersimpan tanpa token CSRF', await page.evaluate(() => { const me = JSON.parse(localStorage.getItem('sima:me') || 'null'); return !!me && me.email === 'petugas@sima.test' && !('csrfToken' in me); }));

  // ---------------------------------------------------------- offline: muat ulang dan periksa
  await ctx.setOffline(true);
  await page.reload();
  await page.getByText('Diperiksa 0 dari 3').waitFor({ timeout: 15000 });
  check('offline: halaman periksa terbuka dari cache setelah muat ulang (tanpa jaringan)', true);
  await page.getByText(/Anda sedang offline\. Halaman yang membutuhkan data terbaru/).waitFor();
  check('banner offline tampil di seluruh aplikasi', true);
  await page.screenshot({ path: path.join(OUT, 't7-pwa-offline.png') });

  const scan = async (code) => {
    await page.getByLabel(/^Atau masukkan kode inventaris/).fill(code);
    await page.getByRole('button', { name: 'Lanjut' }).click();
    await page.getByRole('button', { name: 'Simpan hasil' }).click();
    await page.getByText(/Offline: catatan disimpan di perangkat/).first().waitFor();
  };
  await scan(assets[0].code);
  await scan(assets[1].code);
  await page.getByText(/2 catatan menunggu sinkronisasi/).waitFor();
  check('offline: dua pemeriksaan masuk antrean perangkat', JSON.parse(await page.evaluate((id) => localStorage.getItem(`sima:opname-queue:${id}`), op.id)).length === 2);
  check('server belum menerima apa pun saat masih offline', (await summary()).NOT_CHECKED === 3);

  await page.goto(`${BASE}/aset`).catch(() => {});
  await page.getByRole('heading', { name: 'Aset Inventaris' }).waitFor();
  await page.getByText(/Tidak dapat terhubung ke server/).first().waitFor({ timeout: 15000 });
  check('offline: halaman yang butuh data tampil rapi dengan galat dan tombol coba lagi (bukan layar kosong)', (await page.getByRole('button', { name: 'Coba lagi' }).count()) > 0);
  await page.getByRole('button', { name: 'Buka menu' }).click();
  const menu = await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link').count();
  check('offline: navigasi tetap tersedia dari profil tersimpan', menu > 5);

  // ---------------------------------------------------------- kembali online
  await ctx.setOffline(false);
  await page.goto(`${BASE}/opname/${op.id}/periksa`);
  await page.getByText(/2 catatan offline tersinkron/).waitFor({ timeout: 20000 });
  const after = await summary();
  check('kembali online: antrean tersinkron dan divalidasi server (2 sesuai)', after.MATCH === 2 && after.NOT_CHECKED === 1, JSON.stringify(after));
  check('antrean perangkat kosong setelah sinkron', (await page.evaluate((id) => localStorage.getItem(`sima:opname-queue:${id}`), op.id)) === null);

  // ---------------------------------------------------------- logout membersihkan profil
  await page.getByRole('button', { name: /^Menu akun/ }).click();
  await page.getByRole('menuitem', { name: 'Keluar' }).click();
  await page.waitForURL('**/login');
  check('logout menghapus profil tersimpan di perangkat', (await page.evaluate(() => localStorage.getItem('sima:me'))) === null);

  check('tidak ada console error tak terduga', consoleErrors.length === 0, consoleErrors.join(' || ').slice(0, 300));
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} lulus`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  if (lastPage) await lastPage.screenshot({ path: path.join(OUT, 'error7pwa.png') }).catch(() => {});
  console.error('E2E ERROR', String(e.message).split('\n').slice(0, 8).join('\n'));
  process.exit(2);
});
