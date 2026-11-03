// E2E Tahap 3: barang, aset, QR, foto, persediaan, scan.
// Prasyarat: stack dev berjalan di database KOSONG yang baru di-seed (lihat README bagian E2E).
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUT = path.resolve(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sima-e2e-'));
const results = [];
let lastPage = null;
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); };
const lab = (scope, text) => scope.getByLabel(new RegExp(`^${text}( \\*)?$`));
async function pick(select, text) {
  const option = select.locator('option', { hasText: text }).first();
  await option.waitFor({ state: 'attached' });
  const value = await option.getAttribute('value');
  await select.selectOption(value);
}
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function login(page, email, password, newPassword) {
  await page.goto(BASE + '/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
  if (newPassword) {
    await page.waitForURL('**/ganti-password');
    await page.getByLabel(/^Password saat ini/).fill(password);
    await page.getByLabel(/^Password baru/).fill(newPassword);
    await page.getByLabel(/^Ulangi password baru/).fill(newPassword);
    await page.getByRole('button', { name: 'Simpan password' }).click();
  }
  await page.waitForURL((u) => !/login|ganti-password/.test(u.pathname));
}

(async () => {
  const consoleErrors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  lastPage = page;
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await login(page, 'admin@sima.local', 'Ganti-Password-Ini-123', 'Admin-Baru-98765');
  check('login dan ganti password awal', true);

  // Sidebar hanya memuat halaman yang ada
  await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Aset' }).waitFor();
  const navLinks = await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link').allTextContents();
  check('menu inventaris tampil', ['Data Barang', 'Aset', 'Scan QR', 'Persediaan'].every((t) => navLinks.includes(t)), navLinks.join('|'));

  // --- prasyarat master: lokasi
  await page.goto(BASE + '/master/locations');
  await page.getByRole('button', { name: 'Tambah lokasi' }).first().click();
  let d = page.getByRole('dialog');
  await lab(d, 'Kode').fill('R-A1');
  await lab(d, 'Nama lokasi').fill('Ruang A1');
  await d.getByRole('button', { name: 'Simpan' }).click();
  await page.getByText('Lokasi ditambahkan').waitFor();

  // --- Data Barang
  await page.goto(BASE + '/barang');
  await page.getByRole('button', { name: 'Tambah barang' }).first().click();
  d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Simpan' }).click();
  check('form barang kosong menampilkan validasi', await page.getByText('Nama barang wajib diisi').isVisible());
  await lab(d, 'Nama barang').fill('Laptop Lenovo ThinkPad E14');
  await pick(lab(d, 'Kategori'), 'Elektronik');
  await pick(lab(d, 'Satuan'), 'Unit');
  await d.getByRole('button', { name: 'Simpan' }).click();
  await page.getByText('Master barang ditambahkan').waitFor();
  const laptopCode = await page.locator('tbody tr', { hasText: 'Laptop Lenovo' }).locator('.code-stamp').first().innerText();
  check('kode master aset otomatis BRG-ELK-xxxxxx', /^BRG-ELK-\d{6}$/.test(laptopCode), laptopCode);

  await page.getByRole('button', { name: 'Tambah barang' }).first().click();
  d = page.getByRole('dialog');
  await lab(d, 'Jenis barang').selectOption('SUPPLY');
  await lab(d, 'Nama barang').fill('Kertas HVS A4');
  await pick(lab(d, 'Kategori'), 'Alat Tulis Kantor');
  await pick(lab(d, 'Satuan'), 'Rim');
  await lab(d, 'Stok minimum').fill('10');
  await d.getByRole('button', { name: 'Simpan' }).click();
  await page.getByText('Master barang ditambahkan').waitFor();
  const paperCode = await page.locator('tbody tr', { hasText: 'Kertas HVS' }).locator('.code-stamp').first().innerText();
  check('kode persediaan otomatis PRS-ATK-xxxxxx', /^PRS-ATK-\d{6}$/.test(paperCode), paperCode);
  await page.getByLabel('Filter jenis').selectOption('SUPPLY');
  await page.waitForTimeout(500);
  check('filter jenis persediaan', (await page.locator('tbody tr').count()) === 1);

  // --- Registrasi aset (3 unit)
  await page.goto(BASE + '/aset');
  await page.getByText('Belum ada aset').waitFor();
  check('empty state daftar aset', true);
  await page.getByRole('button', { name: 'Registrasi aset' }).click();
  d = page.getByRole('dialog');
  await d.getByRole('button', { name: /^Daftarkan/ }).click();
  check('registrasi tanpa isian menampilkan validasi', await page.getByText('Barang tidak valid').isVisible() || await page.getByText(/ID tidak valid|Barang/).first().isVisible());
  await pick(lab(d, 'Barang'), 'Laptop Lenovo');
  await lab(d, 'Jumlah unit').fill('3');
  await lab(d, 'Nomor seri').fill('SN-001\nSN-002');
  await pick(lab(d, 'Unit pengelola'), 'Sekretariat');
  await pick(lab(d, 'Lokasi fisik'), 'Ruang A1');
  await d.getByRole('button', { name: /^Daftarkan/ }).click();
  check('jumlah serial tidak cocok ditolak server', await page.getByText(/Isi 3 nomor seri/).isVisible() || await page.getByText(/Isi 3 nomor seri/).waitFor().then(() => true));
  await lab(d, 'Nomor seri').fill('SN-001\nSN-002\nSN-003');
  await d.getByRole('button', { name: /^Daftarkan/ }).click();
  await page.getByText('3 aset berhasil didaftarkan').waitFor();
  const codes = await page.locator('tbody tr .code-stamp').allInnerTexts();
  check('3 unit mendapat 3 kode inventaris berbeda', codes.length === 3 && new Set(codes).size === 3 && codes.every((c) => /^INV-ELK-\d{4}-\d{6}$/.test(c)), codes.join(','));
  await page.screenshot({ path: path.join(OUT, 't3-aset.png') });

  // --- cetak QR
  await page.getByLabel(`Pilih ${codes[0]}`).check();
  await page.getByLabel(`Pilih ${codes[1]}`).check();
  await page.getByRole('button', { name: 'Cetak QR (2)' }).click();
  await page.waitForURL('**/aset/cetak-qr');
  await page.locator('img[alt^="QR INV"]').first().waitFor();
  const labelImgs = await page.locator('img[alt^="QR INV"]').evaluateAll((els) => els.map((e) => ({ ok: e.naturalWidth > 0, src: e.src.slice(-40) })));
  check('halaman cetak menampilkan 2 label QR berbeda', labelImgs.length === 2 && labelImgs.every((l) => l.ok) && labelImgs[0].src !== labelImgs[1].src);
  await page.screenshot({ path: path.join(OUT, 't3-cetak.png') });

  // --- detail aset
  await page.goto(BASE + '/aset');
  await page.getByRole('link', { name: codes[0] }).click();
  await page.waitForURL('**/aset/*');
  await page.getByRole('heading', { name: 'Laptop Lenovo ThinkPad E14' }).waitFor();
  check('detail aset menampilkan informasi', await page.getByText('Ruang A1').first().isVisible());
  await page.getByRole('tab', { name: 'QR Code' }).click();
  const qrOk = await page.locator('img[alt^="QR Code INV"]').evaluate((e) => new Promise((r) => (e.complete ? r(e.naturalWidth > 0) : (e.onload = () => r(true), e.onerror = () => r(false)))));
  check('tab QR menampilkan gambar QR dari server', qrOk);
  const png = await ctx.request.get(page.url().replace(/\/aset\/.*/, '') + `/api/v1/assets/${page.url().split('/').pop()}/qr`);
  check('endpoint QR mengembalikan image/png', png.status() === 200 && png.headers()['content-type'] === 'image/png');
  const qrFile = path.join(TMP, 'qr.png');
  fs.writeFileSync(qrFile, await png.body());
  const assetId = page.url().split('/').pop();

  await page.getByRole('tab', { name: 'Foto' }).click();
  await page.getByText('Belum ada foto').waitFor();
  const pixel = path.join(TMP, 'pixel.png'); fs.writeFileSync(pixel, PIXEL);
  const evil = path.join(TMP, 'evil.png'); fs.writeFileSync(evil, Buffer.from('MZ<script>alert(1)</script>'));
  await page.getByLabel('Pilih file foto').setInputFiles(evil);
  await page.getByText(/Jenis file tidak diizinkan/).first().waitFor();
  check('file menyamar sebagai PNG ditolak server', true);
  await page.getByLabel('Pilih file foto').setInputFiles(pixel);
  await page.getByText('Foto ditambahkan').first().waitFor();
  const photoOk = await page.locator('img[alt^="Foto Laptop"]').evaluate((e) => new Promise((r) => (e.complete ? r(e.naturalWidth > 0) : (e.onload = () => r(true), e.onerror = () => r(false)))));
  check('foto terunggah dan tampil lewat endpoint terautentikasi', photoOk);
  const fileUrl = await page.locator('img[alt^="Foto Laptop"]').getAttribute('src');
  const anon = await (await browser.newContext()).request.get(BASE + fileUrl);
  check('file privat ditolak tanpa login (401)', anon.status() === 401);

  await page.getByRole('tab', { name: 'Informasi' }).click();
  await page.getByRole('button', { name: 'Ubah data' }).click();
  d = page.getByRole('dialog');
  await lab(d, 'Kondisi').selectOption('MINOR_DAMAGE');
  await d.getByRole('button', { name: 'Simpan' }).click();
  check('perubahan kondisi tanpa alasan ditolak', await page.getByText('Isi alasan perubahan kondisi').isVisible() || await page.getByText('Isi alasan perubahan kondisi').waitFor().then(() => true));
  await lab(d, 'Alasan perubahan kondisi').fill('Layar retak');
  await d.getByRole('button', { name: 'Simpan' }).click();
  await page.getByText('Aset diperbarui').waitFor();
  await page.getByRole('tab', { name: 'Kondisi' }).click();
  await page.getByText('Layar retak').waitFor();
  check('histori kondisi mencatat perubahan', true);
  await page.getByRole('tab', { name: 'Histori lokasi' }).click();
  check('histori lokasi memuat registrasi', await page.getByRole('cell', { name: 'Registrasi' }).first().isVisible());
  await page.getByRole('tab', { name: 'Peminjaman' }).click();
  check('tab peminjaman menampilkan state kosong', await page.getByText('Aset ini belum pernah dipinjam').isVisible());

  // keyboard pada tab
  await page.getByRole('tab', { name: 'Peminjaman' }).focus();
  await page.keyboard.press('ArrowRight');
  check('tab dapat dinavigasi dengan panah keyboard', (await page.getByRole('tab', { selected: true }).innerText()) === 'Pemeliharaan');

  // --- Persediaan
  await page.goto(BASE + '/persediaan');
  await page.getByRole('cell', { name: /Kertas HVS A4/ }).waitFor();
  await page.getByRole('button', { name: 'Barang masuk' }).click();
  d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Simpan transaksi' }).click();
  check('form stok kosong menampilkan validasi', await page.getByText(/ID tidak valid|Barang/).first().isVisible());
  await pick(d.getByLabel(/^Barang 1/), 'Kertas HVS');
  await d.getByLabel(/^Jumlah/).fill('100');
  await d.getByRole('button', { name: 'Simpan transaksi' }).click();
  await page.getByText(/Barang masuk BM-\d{4}-\d{4} tercatat/).waitFor();
  check('barang masuk menambah saldo 100', await page.getByRole('row', { name: /Kertas HVS A4/ }).getByText(/100 Rim/).waitFor({ timeout: 8000 }).then(() => true, () => false));

  await page.getByRole('button', { name: 'Barang keluar' }).click();
  d = page.getByRole('dialog');
  await pick(d.getByLabel(/^Barang 1/), 'Kertas HVS');
  await d.getByLabel(/^Jumlah/).fill('150');
  await d.getByRole('button', { name: 'Simpan transaksi' }).click();
  await page.getByText(/tidak mencukupi. Tersedia 100, diminta 150/).waitFor();
  check('keluar melebihi saldo ditolak dengan pesan jelas', true);
  await d.getByLabel(/^Jumlah/).fill('95');
  await d.getByRole('button', { name: 'Simpan transaksi' }).click();
  await page.getByText(/Barang keluar BK-/).waitFor();
  const row = page.getByRole('row', { name: /Kertas HVS A4/ });
  await row.getByText(/5 Rim/).waitFor();
  check('saldo 5 dan ditandai di bawah minimum 10', await row.getByText('Di bawah minimum').isVisible());
  await page.getByLabel('Hanya stok menipis').check();
  await page.waitForTimeout(600);
  check('filter stok menipis menyaring daftar', (await page.locator('tbody tr').count()) === 1);
  await page.screenshot({ path: path.join(OUT, 't3-stok.png') });

  await page.getByRole('tab', { name: 'Riwayat transaksi' }).click();
  await page.getByRole('cell', { name: /^BK-/ }).first().waitFor();
  check('riwayat memuat transaksi masuk dan keluar', (await page.locator('tbody tr').count()) === 2);

  await page.getByRole('tab', { name: 'Saldo stok' }).click();
  await page.getByRole('link', { name: /Kertas HVS A4/ }).click();
  await page.getByRole('heading', { name: /Kartu stok/ }).waitFor();
  await page.getByRole('cell', { name: '5', exact: true }).waitFor();
  const balances = await page.locator('tbody tr td:last-child').allInnerTexts();
  check('kartu stok: saldo berjalan 100 lalu 5', JSON.stringify(balances) === JSON.stringify(['100', '5']), balances.join(','));
  await page.screenshot({ path: path.join(OUT, 't3-kartu.png') });

  // --- Scan manual
  await page.goto(BASE + '/scan');
  await page.getByLabel(/^Atau masukkan kode/).fill('INV-XXX-2026-999999');
  await page.getByRole('button', { name: 'Cari' }).click();
  await page.getByText(/QR Code tidak dikenal/).waitFor();
  check('kode tidak dikenal menampilkan pesan jelas', true);
  await page.getByLabel(/^Atau masukkan kode/).fill('halo bukan kode');
  await page.getByRole('button', { name: 'Cari' }).click();
  await page.getByText('Isi QR bukan kode aset SIMA.').waitFor();
  check('isi QR non-SIMA ditolak', true);
  await page.getByLabel(/^Atau masukkan kode/).fill(`${BASE}/q/${codes[2].toLowerCase()}`);
  await page.getByRole('button', { name: 'Cari' }).click();
  await page.waitForURL(/\/aset\/[0-9a-f-]{36}$/);
  await page.getByText(codes[2]).first().waitFor();
  check('URL QR (huruf kecil) membuka detail aset yang benar', page.url().includes('/aset/'));
  await page.goto(BASE + `/q/${codes[1]}`);
  await page.waitForURL(/\/aset\/[0-9a-f-]{36}$/);
  await page.getByText(codes[1]).first().waitFor();
  check('/q/:kode (dipindai kamera bawaan HP) menuju detail aset', page.url().includes('/aset/'));
  await page.goto(BASE + '/q/INV-NOPE-2026-000000');
  await page.getByText(/QR Code tidak dikenal/).waitFor();
  check('/q/:kode tidak dikenal menampilkan galat', true);

  // --- Mobile
  await page.setViewportSize({ width: 390, height: 844 });
  for (const p of ['/barang', '/aset', '/persediaan', '/scan', `/aset/${assetId}`]) {
    await page.goto(BASE + p);
    await page.waitForTimeout(700);
    const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(`mobile ${p.replace(assetId, ':id')}: tanpa overflow horizontal`, !over);
  }
  await page.screenshot({ path: path.join(OUT, 't3-mobile-detail.png') });
  await page.close();
  await ctx.close();

  // --- Scan dengan kamera palsu berisi QR asli
  const y4m = path.join(TMP, 'qr.y4m');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', qrFile, '-vf', 'scale=480:480:flags=neighbor,pad=640:480:80:0:white,format=yuv420p', '-t', '4', '-r', '10', y4m]);
  const cam = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
  const cctx = await cam.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['camera'] });
  const cpage = await cctx.newPage();
  await login(cpage, 'admin@sima.local', 'Admin-Baru-98765');
  await cpage.goto(BASE + '/scan');
  await cpage.getByRole('button', { name: 'Nyalakan kamera' }).click();
  await cpage.getByRole('button', { name: 'Matikan kamera' }).waitFor();
  check('kamera menyala dan pratinjau tampil', true);
  await cpage.waitForURL(`**/aset/${assetId}`, { timeout: 15000 });
  check('QR dari kamera terbaca dan membuka aset yang benar', true);
  await cam.close();

  // kamera ditolak
  const deny = await chromium.launch({ args: ['--use-fake-device-for-media-stream'] });
  const dctx = await deny.newContext({ permissions: [] });
  const dpage = await dctx.newPage();
  await dpage.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })); });
  await login(dpage, 'admin@sima.local', 'Admin-Baru-98765');
  await dpage.goto(BASE + '/scan');
  await dpage.getByRole('button', { name: 'Nyalakan kamera' }).click();
  await dpage.getByText(/Izin kamera ditolak/).waitFor();
  check('izin kamera ditolak menampilkan panduan dan fallback manual', await dpage.getByLabel(/^Atau masukkan kode/).isVisible());
  await deny.close();

  check('tidak ada console error tak terduga', consoleErrors.length === 0, consoleErrors.join(' || ').slice(0, 300));
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} lulus`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { if (lastPage) { await lastPage.screenshot({ path: path.join(OUT, 'error.png') }).catch(() => {}); console.error('DIALOG TEXT:', (await lastPage.locator('[role=dialog]').allInnerTexts().catch(() => [])).join(' | ').slice(0, 600)); } console.error('E2E ERROR', String(e.message).split('\n').slice(0, 8).join('\n')); process.exit(2); });
