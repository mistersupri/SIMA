// E2E Tahap 6: dashboard, laporan (filter, export XLSX/PDF, cetak), audit log, izin.
// Prasyarat: stack dev di database KOSONG yang baru di-seed, LOGIN_RATE_LIMIT_PER_MIN tinggi.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require(path.resolve(__dirname, '../apps/api/node_modules/exceljs'));

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUT = path.resolve(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let lastPage = null;
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); };
const num = (t) => Number(String(t).replace(/[^\d]/g, ''));

async function api(request, session, method, url, body) {
  const res = await request.fetch(`${BASE}/api/v1${url}`, { method, data: body, headers: session ? { 'x-csrf-token': session.csrf } : {} });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function apiSession(browser, email, password) {
  const request = (await browser.newContext()).request;
  const res = await request.post(`${BASE}/api/v1/auth/login`, { data: { email, password } });
  const json = await res.json();
  if (!res.ok()) throw new Error(`login API gagal ${email}: ${JSON.stringify(json)}`);
  return { request, csrf: json.data.csrfToken };
}
async function uiLogin(page, email, password) {
  await page.goto(BASE + '/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.waitForURL((u) => !/login/.test(u.pathname));
}

(async () => {
  const consoleErrors = [];
  const browser = await chromium.launch();
  const mk = async (width = 1280) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    return { ctx, page };
  };

  // ------------------------------------------------------------ setup via API
  const boot = await apiSession(browser, 'admin@sima.local', 'Ganti-Password-Ini-123');
  await api(boot.request, boot, 'POST', '/auth/change-password', { currentPassword: 'Ganti-Password-Ini-123', newPassword: 'Admin-Baru-98765', confirmPassword: 'Admin-Baru-98765' });
  const A = await apiSession(browser, 'admin@sima.local', 'Admin-Baru-98765');
  const roles = (await api(A.request, A, 'GET', '/roles/options')).body.data;
  const PW = 'Sandi-Uji-12345', PW2 = PW + 'x';
  for (const [name, email, role] of [['Dewi Petugas', 'petugas@sima.test', 'PETUGAS_INVENTARIS'], ['Budi Approver', 'approver@sima.test', 'APPROVER'], ['Vera Viewer', 'viewer@sima.test', 'VIEWER']]) {
    await api(A.request, A, 'POST', '/users', { name, email, password: PW, roleIds: [roles.find((r) => r.code === role).id] });
    const t = await apiSession(browser, email, PW);
    await api(t.request, t, 'POST', '/auth/change-password', { currentPassword: PW, newPassword: PW2, confirmPassword: PW2 });
  }
  const opt = async (p) => (await api(A.request, A, 'GET', `${p}?limit=100`)).body.data;
  const [cats, uoms, units, whs] = [await opt('/categories'), await opt('/units'), await opt('/organizational-units'), await opt('/warehouses')];
  const laptop = (await api(A.request, A, 'POST', '/items', { name: 'Laptop Lenovo', type: 'ASSET', categoryId: cats.find((c) => c.code === 'ELK').id, unitOfMeasureId: uoms.find((u) => u.code === 'UNIT').id })).body.data;
  const kertas = (await api(A.request, A, 'POST', '/items', { name: 'Kertas HVS A4', type: 'SUPPLY', categoryId: cats.find((c) => c.code === 'ATK').id, unitOfMeasureId: uoms.find((u) => u.code === 'RIM').id, minStock: 50 })).body.data;
  const loc = (await api(A.request, A, 'POST', '/locations', { code: 'R-101', name: 'Ruang 101', type: 'ROOM' })).body.data;
  const vendor = (await api(A.request, A, 'POST', '/vendors', { code: 'PT-MAJU', name: 'PT Maju Jaya' })).body.data;
  const regs = (await api(A.request, A, 'POST', '/assets', { itemId: laptop.id, quantity: 5, acquisitionYear: 2026, acquisitionCost: 8000000, unitId: units[0].id, locationId: loc.id })).body.data;
  await api(A.request, A, 'PATCH', `/assets/${regs[0].id}`, { acquisitionYear: 2026, acquisitionCost: 8000000, condition: 'MINOR_DAMAGE', conditionNote: 'Layar retak' });
  await api(A.request, A, 'PATCH', `/assets/${regs[1].id}`, { acquisitionYear: 2026, acquisitionCost: 8000000, condition: 'MAJOR_DAMAGE', conditionNote: 'Mati total' });
  await api(A.request, A, 'POST', '/stocks/in', { warehouseId: whs[0].id, date: new Date().toISOString().slice(0, 10), lines: [{ itemId: kertas.id, quantity: 100 }] });
  await api(A.request, A, 'POST', '/stocks/out', { warehouseId: whs[0].id, date: new Date().toISOString().slice(0, 10), lines: [{ itemId: kertas.id, quantity: 70 }] });
  const pet = await apiSession(browser, 'petugas@sima.test', PW2);
  const proc = (await api(pet.request, pet, 'POST', '/procurements', { date: new Date().toISOString().slice(0, 10), fiscalYear: 2026, vendorId: vendor.id, lines: [{ itemId: laptop.id, quantity: 2, unitPrice: 9000000 }] })).body.data;
  await api(pet.request, pet, 'POST', `/procurements/${proc.id}/submit`);
  check('setup via API: aset berkondisi beragam, stok menipis, pengadaan menunggu', regs.length === 5);

  const V = await mk(), AP = await mk(), P = await mk();
  lastPage = V.page;
  await uiLogin(V.page, 'viewer@sima.test', PW2);
  await uiLogin(AP.page, 'approver@sima.test', PW2);
  await uiLogin(P.page, 'petugas@sima.test', PW2);
  const v = V.page, ap = AP.page, p = P.page;

  // ------------------------------------------------------------ dashboard
  await v.getByRole('heading', { name: 'Dashboard' }).waitFor();
  check('login mendarat di Dashboard', new URL(v.url()).pathname === '/');
  const card = async (page, label) => num(await page.locator('section[aria-label="Statistik utama"] a, section[aria-label="Statistik utama"] div').filter({ hasText: label }).first().locator('span').nth(1).innerText());
  await v.getByText('Total barang inventaris').waitFor();
  const independent = {
    total: (await api(A.request, A, 'GET', '/assets?limit=1')).body.meta.total,
    minor: (await api(A.request, A, 'GET', '/assets?limit=1&condition=MINOR_DAMAGE')).body.meta.total,
    major: (await api(A.request, A, 'GET', '/assets?limit=1&condition=MAJOR_DAMAGE')).body.meta.total,
    good: (await api(A.request, A, 'GET', '/assets?limit=1&condition=GOOD')).body.meta.total,
  };
  check('kartu total aset = hitungan independen dari daftar aset', (await card(v, 'Total barang inventaris')) === independent.total, `${independent.total}`);
  check('kartu kondisi (baik/ringan/berat) = hitungan independen', (await card(v, 'Kondisi baik')) === independent.good && (await card(v, 'Rusak ringan')) === independent.minor && (await card(v, 'Rusak berat')) === independent.major, JSON.stringify(independent));
  check('kartu saldo persediaan = 30 dan stok menipis = 1', (await card(v, 'Total saldo persediaan')) === 30 && (await card(v, 'Stok di bawah minimum')) === 1);
  check('kartu nilai perolehan = Rp 40.000.000', (await v.getByText(/Rp\s*40\.000\.000/).first().isVisible()));
  check('daftar batang per kategori menampilkan Elektronik 5', await v.getByRole('list', { name: 'Jumlah aset per kategori' }).getByText('Elektronik').isVisible());
  check('diagram pengadaan per bulan tersedia (SVG dengan label)', (await v.getByRole('img', { name: /Nilai pengadaan disetujui per bulan/ }).count()) === 1 || (await v.getByText(/Belum ada pengadaan yang disetujui/).count()) === 1);
  await v.getByText('Aktivitas terbaru').waitFor();
  check('aktivitas terbaru terbaca manusia', (await v.locator('section, div').filter({ hasText: /membuat|mengubah|mencatat/ }).count()) > 0);
  await v.screenshot({ path: path.join(OUT, 't6-dashboard.png'), fullPage: true });

  // drill-down kartu
  await v.getByRole('link', { name: /Rusak ringan/ }).click();
  await v.waitForURL('**/aset?condition=MINOR_DAMAGE');
  await v.locator('tbody tr').first().waitFor();
  check('klik kartu membuka daftar aset terfilter kondisi', (await v.getByLabel('Filter kondisi').inputValue()) === 'MINOR_DAMAGE' && (await v.locator('tbody tr').count()) === independent.minor);
  await v.goto(BASE + '/');
  await v.getByRole('link', { name: /Stok di bawah minimum/ }).click();
  await v.waitForURL('**/persediaan?belowMin=true');
  await v.getByRole('row', { name: /Kertas HVS A4/ }).waitFor();
  check('klik kartu stok menipis membuka persediaan terfilter', await v.getByLabel('Hanya stok menipis').isChecked());

  // persetujuan menunggu (approver) di dashboard
  await ap.goto(BASE + '/');
  await ap.getByText('Pengajuan menunggu keputusan Anda').waitFor();
  check('dashboard approver menampilkan pengajuan menunggu dan kartu bertanda', await ap.getByText(/1 menunggu keputusan Anda/).isVisible());
  await ap.getByRole('link', { name: /Pengadaan/ }).filter({ hasText: 'PGD-' }).first().click();
  await ap.waitForURL(/\/pengadaan\/[0-9a-f-]{36}$/);
  check('klik pengajuan di dashboard membuka dokumennya', true);
  // petugas (pembuat) tidak melihatnya sebagai tugasnya
  await p.goto(BASE + '/');
  await p.getByText('Pengajuan menunggu keputusan Anda').waitFor();
  check('pembuat tidak mendapat pengajuannya sendiri di daftar keputusan', await p.getByText('Tidak ada pengajuan yang menunggu Anda.').isVisible());

  // ------------------------------------------------------------ laporan
  await v.goto(BASE + '/laporan/assets');
  await v.getByRole('heading', { name: 'Rekapitulasi Inventaris' }).waitFor();
  await v.locator('tbody tr').first().waitFor();
  check('laporan inventaris memuat 5 aset dan ringkasan nilai', (await v.locator('tbody tr').count()) === 5 && await v.getByText(/Rp\s*40\.000\.000/).first().isVisible());
  await v.getByLabel('Semua kondisi').selectOption('MINOR_DAMAGE');
  await v.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  check('filter kondisi menyaring laporan di server', true);
  await v.getByRole('button', { name: 'Reset filter' }).click();
  await v.waitForFunction(() => document.querySelectorAll('tbody tr').length === 5);

  const [dl] = await Promise.all([v.waitForEvent('download'), v.getByRole('link', { name: 'Excel' }).click()]);
  check('unduhan Excel bernama laporan-assets-<tanggal>.xlsx', /^laporan-assets-\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const xlsxPath = path.join(require('node:os').tmpdir(), `sima-${Date.now()}.xlsx`);
  await dl.saveAs(xlsxPath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.worksheets[0];
  let dataRows = 0; ws.eachRow((r) => { if (r.number >= 5 && /^INV-/.test(String(r.getCell(1).value))) dataRows++; });
  check('isi Excel: judul, header, 5 baris aset, nilai berupa angka', ws.getCell(1, 1).value === 'Rekapitulasi Inventaris' && ws.getRow(4).getCell(1).value === 'Kode inventaris' && dataRows === 5 && typeof ws.getRow(5).getCell(6).value === 'number');
  const [dlp] = await Promise.all([v.waitForEvent('download'), v.getByRole('link', { name: 'PDF' }).click()]);
  const pdfPath = path.join(require('node:os').tmpdir(), `sima-${Date.now()}.pdf`);
  await dlp.saveAs(pdfPath);
  const pdf = fs.readFileSync(pdfPath);
  check('unduhan PDF valid (%PDF) dan berisi data', pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 3000 && /\.pdf$/.test(dlp.suggestedFilename()));
  await v.getByRole('button', { name: 'Cetak' }).click();
  check('tombol Cetak memanggil dialog cetak browser', (await v.evaluate(() => window.__printed)) === 1);
  await v.screenshot({ path: path.join(OUT, 't6-laporan.png') });

  await v.goto(BASE + '/laporan/stocks');
  await v.getByRole('cell', { name: 'Menipis' }).waitFor();
  check('laporan persediaan menandai stok menipis', true);
  await v.goto(BASE + '/laporan/conditions');
  await v.getByRole('cell', { name: 'Elektronik' }).waitFor();
  check('laporan kondisi merekap per kategori', (await v.locator('tbody tr').first().innerText()).includes('5'));
  await v.goto(BASE + '/laporan/tidak-ada');
  await v.getByText('Laporan tidak ditemukan.').waitFor();
  check('laporan tidak dikenal menampilkan galat', true);

  // izin export
  await p.goto(BASE + '/laporan/loans');
  await p.getByRole('heading', { name: 'Laporan Peminjaman dan Pengembalian' }).waitFor();
  check('petugas tanpa izin export tidak melihat tombol Excel/PDF di laporan peminjaman', (await p.getByRole('link', { name: 'Excel' }).count()) === 0);
  await p.goto(BASE + '/laporan/assets');
  await p.getByRole('heading', { name: 'Rekapitulasi Inventaris' }).waitFor();
  check('petugas (assets.export) dapat export laporan inventaris', (await p.getByRole('link', { name: 'Excel' }).count()) === 1);
  const direct = await api(pet.request, pet, 'GET', '/exports/loans?format=xlsx');
  check('permintaan export langsung tanpa izin ditolak server (403)', direct.status === 403);

  // ------------------------------------------------------------ audit log
  await v.goto(BASE + '/pengaturan/audit-log');
  await v.locator('tbody tr').first().waitFor();
  check('audit log terbuka untuk Auditor dan memuat catatan', (await v.locator('tbody tr').count()) > 5);
  await v.getByLabel('Filter objek').selectOption({ label: 'pengadaan' });
  await v.waitForFunction(() => [...document.querySelectorAll('tbody tr td:nth-child(5)')].length > 0 && [...document.querySelectorAll('tbody tr td:nth-child(5)')].every((c) => /^procurement$/i.test(c.textContent)));
  check('filter objek audit log bekerja di server', true);
  await v.getByRole('button', { name: 'Lihat' }).first().click();
  await v.getByRole('dialog').getByText('Sesudah').waitFor();
  check('rincian perubahan (JSON sebelum/sesudah) tampil', (await v.getByRole('dialog').locator('pre').count()) >= 1);
  await v.keyboard.press('Escape');
  const nav = await p.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link').allTextContents();
  check('menu Audit Log tidak tampil untuk petugas', !nav.includes('Audit Log') && nav.includes('Dashboard'));
  await p.goto(BASE + '/pengaturan/audit-log');
  await p.getByText('Anda tidak memiliki akses').waitFor();
  check('petugas yang membuka URL audit log langsung ditolak (halaman dan API)', (await api(pet.request, pet, 'GET', '/audit-logs')).status === 403);
  await v.goto(BASE + '/laporan/assets');
  await v.locator('[aria-current="page"]').first().waitFor();
  const act = await v.locator('[aria-current="page"]').allInnerTexts();
  check('hanya satu menu aktif pada halaman laporan', act.length === 1 && act[0] === 'Inventaris', act.join('|'));

  // ------------------------------------------------------------ mobile
  await v.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/', '/laporan/assets', '/laporan/stocks', '/laporan/loans', '/laporan/stock-opnames', '/pengaturan/audit-log']) {
    await v.goto(BASE + route);
    await v.waitForLoadState('networkidle');
    await v.waitForTimeout(300);
    const over = await v.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(`mobile ${route}: tanpa overflow horizontal`, !over);
  }
  await v.goto(BASE + '/');
  await v.waitForLoadState('networkidle');
  await v.screenshot({ path: path.join(OUT, 't6-dashboard-mobile.png'), fullPage: true });

  check('tidak ada console error tak terduga', consoleErrors.length === 0, consoleErrors.join(' || ').slice(0, 300));
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} lulus`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  if (lastPage) await lastPage.screenshot({ path: path.join(OUT, 'error6.png') }).catch(() => {});
  console.error('E2E ERROR', String(e.message).split('\n').slice(0, 8).join('\n'));
  process.exit(2);
});
