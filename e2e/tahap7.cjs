// E2E Tahap 7a: import Excel lewat UI. Prasyarat: stack dev di database KOSONG yang baru di-seed, login rate limit tinggi.
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require(path.resolve(__dirname, '../apps/api/node_modules/exceljs'));

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUT = path.resolve(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sima-e2e7-'));
const results = [];
let lastPage = null;
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); };

async function apiSession(browser, email, password) {
  const request = (await browser.newContext()).request;
  const res = await request.post(`${BASE}/api/v1/auth/login`, { data: { email, password } });
  const json = await res.json();
  if (!res.ok()) throw new Error(`login API gagal ${email}: ${JSON.stringify(json)}`);
  return { request, csrf: json.data.csrfToken };
}
const api = async (s, method, url, body) => { const r = await s.request.fetch(`${BASE}/api/v1${url}`, { method, data: body, headers: { 'x-csrf-token': s.csrf } }); return { status: r.status(), body: await r.json().catch(() => null) }; };
async function uiLogin(page, email, password) {
  await page.goto(BASE + '/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.waitForURL((u) => !/login/.test(u.pathname));
}
async function writeXlsx(file, headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(headers); rows.forEach((r) => ws.addRow(r));
  await wb.xlsx.writeFile(file);
  return file;
}

(async () => {
  const consoleErrors = [];
  const browser = await chromium.launch();
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    return page;
  };

  // setup
  const boot = await apiSession(browser, 'admin@sima.local', 'Ganti-Password-Ini-123');
  await api(boot, 'POST', '/auth/change-password', { currentPassword: 'Ganti-Password-Ini-123', newPassword: 'Admin-Baru-98765', confirmPassword: 'Admin-Baru-98765' });
  const A = await apiSession(browser, 'admin@sima.local', 'Admin-Baru-98765');
  const roles = (await api(A, 'GET', '/roles/options')).body.data;
  const PW = 'Sandi-Uji-12345', PW2 = PW + 'x';
  for (const [name, email, role] of [['Rani Admin', 'admin2@sima.test', 'ADMIN_INVENTARIS'], ['Dewi Petugas', 'petugas@sima.test', 'PETUGAS_INVENTARIS']]) {
    await api(A, 'POST', '/users', { name, email, password: PW, roleIds: [roles.find((r) => r.code === role).id] });
    const t = await apiSession(browser, email, PW);
    await api(t, 'POST', '/auth/change-password', { currentPassword: PW, newPassword: PW2, confirmPassword: PW2 });
  }
  await api(A, 'POST', '/brands', { name: 'Lenovo' });
  const x = await mk();
  lastPage = x;
  await uiLogin(x, 'admin2@sima.test', PW2);
  const p = await mk();
  await uiLogin(p, 'petugas@sima.test', PW2);

  await p.goto(BASE + '/impor');
  await p.getByText('Anda tidak memiliki akses').waitFor();
  check('petugas tanpa izin tidak dapat membuka halaman impor', true);
  check('menu Impor Excel tidak tampil untuk petugas', !(await p.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link').allTextContents()).includes('Impor Excel'));

  // ---------------------------------------------------------- master barang: 100 baris, 5 bermasalah
  await x.goto(BASE + '/impor');
  await x.getByRole('heading', { name: 'Impor Excel' }).waitFor();
  const [tpl] = await Promise.all([x.waitForEvent('download'), x.getByRole('link', { name: /Unduh template Master barang/ }).click()]);
  check('template master barang terunduh (template-impor-items.xlsx)', tpl.suggestedFilename() === 'template-impor-items.xlsx');
  const tplPath = path.join(TMP, 'tpl.xlsx'); await tpl.saveAs(tplPath);
  const twb = new ExcelJS.Workbook(); await twb.xlsx.readFile(tplPath);
  check('template berisi lembar Data/Petunjuk/Referensi dan header kolom wajib', twb.worksheets.map((w) => w.name).join() === 'Data,Petunjuk,Referensi' && twb.worksheets[0].getRow(1).getCell(2).value === 'Nama Barang');

  const H = ['Jenis', 'Nama Barang', 'Kode Kategori', 'Kode Satuan', 'Merek', 'Tipe/Model', 'Spesifikasi', 'Stok Minimum'];
  const rows = [];
  for (let i = 1; i <= 95; i++) rows.push([i % 2 ? 'Inventaris' : 'Persediaan', `Barang Uji ${i}`, i % 2 ? 'ELK' : 'ATK', 'UNIT', i % 10 === 0 ? 'Lenovo' : '', `M${i}`, '', i % 2 ? '' : '5']);
  rows.splice(9, 0, ['Inventaris', '', 'ELK', 'UNIT', '', '', '', '']);
  rows.splice(29, 0, ['Inventaris', 'Barang X', 'XXX', 'UNIT', '', '', '', '']);
  rows.splice(49, 0, ['Aset', 'Barang Y', 'ELK', 'UNIT', '', '', '', '']);
  rows.splice(69, 0, ['Inventaris', 'Barang Uji 1', 'ELK', 'UNIT', '', 'M1', '', '']);
  rows.splice(89, 0, ['Persediaan', 'Barang Z', 'ATK', 'UNIT', '', '', '', '-3']);
  const itemsFile = await writeXlsx(path.join(TMP, 'barang.xlsx'), H, rows);

  await x.getByLabel('Pilih file Excel').setInputFiles(path.join(TMP, 'bukan-excel.csv').replace(/.*/, () => { const f = path.join(TMP, 'bukan-excel.csv'); fs.writeFileSync(f, 'a,b\n1,2'); return f; }));
  await x.getByText(/File harus berformat Excel/).waitFor();
  check('file CSV ditolak dengan pesan jelas', true);

  await x.getByLabel('Pilih file Excel').setInputFiles(itemsFile);
  await x.getByRole('heading', { name: /3\. Periksa hasil/ }).waitFor();
  const cards = await x.locator('dl > section').allInnerTexts();
  check('ringkasan preview: total 100, valid 95, bermasalah 5', cards.join('|').replace(/\s+/g, ' ').includes('Total baris 100') && cards.join('|').replace(/\s+/g, ' ').includes('Valid 95') && cards.join('|').replace(/\s+/g, ' ').includes('Bermasalah 5'), cards.join('|').replace(/\s+/g, ' '));
  await x.getByLabel('Tampilkan baris').selectOption('error');
  await x.waitForFunction(() => document.querySelectorAll('tbody tr').length === 5);
  const errText = await x.locator('tbody').innerText();
  check('baris bermasalah menampilkan nomor baris dan alasan (baris 11, 31, 51, 71, 91)', ['11', '31', '51', '71', '91'].every((n) => errText.includes(n)) && /Nama barang wajib/.test(errText) && /Duplikat dengan baris 2/.test(errText) && /tidak ditemukan atau nonaktif/.test(errText));
  await x.screenshot({ path: path.join(OUT, 't7-preview.png') });
  check('data belum masuk database setelah preview', (await api(A, 'GET', '/items?search=Barang%20Uji&limit=1')).body.meta.total === 0);

  const commitBtn = x.getByRole('button', { name: /^Impor 95 baris valid/ });
  check('tombol impor terkunci selama baris bermasalah belum dikonfirmasi', await commitBtn.isDisabled());
  const [rep] = await Promise.all([x.waitForEvent('download'), x.getByRole('link', { name: /Unduh laporan kesalahan/ }).click()]);
  const repPath = path.join(TMP, 'rep.xlsx'); await rep.saveAs(repPath);
  const rwb = new ExcelJS.Workbook(); await rwb.xlsx.readFile(repPath);
  check('laporan kesalahan XLSX berisi 5 baris dengan alasan', rwb.worksheets[0].rowCount === 6 && /kategori/.test(String(rwb.worksheets[0].getRow(3).getCell(2).value)));
  await x.getByLabel(/Lewati 5 baris bermasalah/).check();
  await commitBtn.click();
  await x.getByRole('dialog').getByRole('button', { name: 'Impor', exact: true }).click();
  await x.getByRole('heading', { name: 'Impor selesai' }).waitFor();
  check('hasil impor: 95 berhasil, 5 dilewati beserta alasannya', (await x.getByText('95 baris berhasil', { exact: true }).isVisible()) && (await x.getByText('5 baris dilewati', { exact: true }).isVisible()) && (await x.getByText(/Baris 11/).isVisible()));
  const created = (await api(A, 'GET', '/items?search=Barang%20Uji&limit=1')).body.meta.total;
  check('95 master barang tersimpan di database dengan kode unik', created === 95, String(created));
  await x.screenshot({ path: path.join(OUT, 't7-hasil.png') });
  await x.getByRole('link', { name: 'Lihat data' }).click();
  await x.waitForURL('**/barang');
  await x.getByLabel('Cari barang').fill('Barang Uji 7');
  await x.getByRole('cell', { name: /Barang Uji 7/ }).first().waitFor();
  check('barang hasil impor tampil di Data Barang', true);

  // ---------------------------------------------------------- lokasi + saldo awal
  await x.goto(BASE + '/impor');
  await x.getByRole('tab', { name: 'Lokasi' }).click();
  const locFile = await writeXlsx(path.join(TMP, 'lokasi.xlsx'), ['Kode Lokasi', 'Nama Lokasi', 'Tipe', 'Kode Lokasi Induk', 'Kode Unit'], [['R-A101', 'Ruang A101', 'Ruangan', 'LT-A1', ''], ['LT-A1', 'Lantai 1', 'Lantai', 'GDG-A', ''], ['GDG-A', 'Gedung A', 'Gedung', '', '']]);
  await x.getByLabel('Pilih file Excel').setInputFiles(locFile);
  await x.getByRole('heading', { name: /3\. Periksa hasil/ }).waitFor();
  const commit = x.getByRole('button', { name: /^Impor 3 baris valid/ });
  check('lokasi bertingkat tanpa kesalahan dapat langsung dikonfirmasi', await commit.isEnabled());
  await commit.click();
  await x.getByRole('dialog').getByRole('button', { name: 'Impor', exact: true }).click();
  await x.getByText('3 baris berhasil', { exact: true }).waitFor();
  const locs = (await api(A, 'GET', '/locations?search=A101&limit=5')).body.data;
  check('lokasi anak terhubung ke induk walau urutan file terbalik', locs[0]?.parent?.name === 'Lantai 1');

  await x.goto(BASE + '/impor');
  await x.getByRole('tab', { name: 'Saldo awal persediaan' }).click();
  const supply = (await api(A, 'GET', '/items?type=SUPPLY&search=Barang%20Uji%202&limit=5')).body.data[0];
  const stockFile = await writeXlsx(path.join(TMP, 'saldo.xlsx'), ['Kode Barang', 'Kode Gudang', 'Jumlah', 'Harga Satuan', 'Tanggal Saldo', 'Catatan'], [[supply.code, 'GDG-UTAMA', 100, 50000, '2026-01-01', 'Saldo awal tahun'], [supply.code, 'GDG-UTAMA', 5, '', '2026-01-01', '']]);
  await x.getByLabel('Pilih file Excel').setInputFiles(stockFile);
  await x.getByRole('heading', { name: /3\. Periksa hasil/ }).waitFor();
  await x.getByLabel(/Lewati 1 baris bermasalah/).check();
  await x.getByRole('button', { name: /^Impor 1 baris valid/ }).click();
  await x.getByRole('dialog').getByRole('button', { name: 'Impor', exact: true }).click();
  await x.getByText('1 baris berhasil', { exact: true }).waitFor();
  await x.goto(`${BASE}/persediaan/${supply.id}`);
  await x.getByRole('cell', { name: 'Saldo awal', exact: true }).first().waitFor();
  check('saldo awal tercatat sebagai transaksi pembukaan di kartu stok (saldo 100)', await x.getByRole('cell', { name: '100', exact: true }).first().isVisible());

  // ---------------------------------------------------------- mobile
  await x.setViewportSize({ width: 390, height: 844 });
  await x.goto(BASE + '/impor');
  await x.getByRole('heading', { name: 'Impor Excel' }).waitFor();
  await x.getByLabel('Pilih file Excel').setInputFiles(itemsFile);
  await x.getByRole('heading', { name: /3\. Periksa hasil/ }).waitFor();
  await x.waitForLoadState('networkidle');
  check('mobile /impor (dengan preview): tanpa overflow horizontal', !(await x.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));

  check('tidak ada console error tak terduga', consoleErrors.length === 0, consoleErrors.join(' || ').slice(0, 300));
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} lulus`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  if (lastPage) await lastPage.screenshot({ path: path.join(OUT, 'error7.png') }).catch(() => {});
  console.error('E2E ERROR', String(e.message).split('\n').slice(0, 8).join('\n'));
  process.exit(2);
});
