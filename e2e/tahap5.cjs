// E2E Tahap 5: pemeliharaan, penghapusan, stock opname (kamera palsu, offline, verifikasi).
// Prasyarat: stack dev di database KOSONG yang baru di-seed, API dengan LOGIN_RATE_LIMIT_PER_MIN tinggi, ffmpeg tersedia.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUT = path.resolve(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sima-e2e5-'));
const results = [];
let lastPage = null;
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); };
const lab = (scope, text) => scope.getByLabel(new RegExp(`^${text}( \\*)?$`));
async function pick(select, text) {
  const option = select.locator('option', { hasText: text }).first();
  await option.waitFor({ state: 'attached' });
  await select.selectOption(await option.getAttribute('value'));
}
async function api(request, session, method, url, body) {
  const res = await request.fetch(`${BASE}/api/v1${url}`, { method, data: body, headers: session ? { 'x-csrf-token': session.csrf } : {} });
  return { status: res.status(), body: await res.json().catch(() => null), res };
}
async function apiLogin(request, email, password) {
  const res = await request.post(`${BASE}/api/v1/auth/login`, { data: { email, password } });
  const json = await res.json();
  if (!res.ok()) throw new Error(`login API gagal ${email}: ${JSON.stringify(json)}`);
  return { csrf: json.data.csrfToken };
}
async function uiLogin(page, email, password) {
  await page.goto(BASE + '/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.waitForURL((u) => !/login/.test(u.pathname));
}
const listbox = (page) => page.getByRole('listbox', { name: 'Hasil pencarian aset' });

(async () => {
  const consoleErrors = [];
  const browser = await chromium.launch();
  const mk = async (width = 1280) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    return { ctx, page };
  };

  // ------------------------------------------------------------ setup via API
  const setupCtx = await browser.newContext();
  const R = setupCtx.request;
  let s = await apiLogin(R, 'admin@sima.local', 'Ganti-Password-Ini-123');
  await api(R, s, 'POST', '/auth/change-password', { currentPassword: 'Ganti-Password-Ini-123', newPassword: 'Admin-Baru-98765', confirmPassword: 'Admin-Baru-98765' });
  s = await apiLogin(R, 'admin@sima.local', 'Admin-Baru-98765');
  const roles = (await api(R, s, 'GET', '/roles/options')).body.data;
  const PW = 'Sandi-Uji-12345', PW2 = PW + 'x';
  for (const [name, email, role] of [['Dewi Petugas', 'petugas@sima.test', 'PETUGAS_INVENTARIS'], ['Budi Approver', 'approver@sima.test', 'APPROVER'], ['Rani Admin', 'admin2@sima.test', 'ADMIN_INVENTARIS']]) {
    await api(R, s, 'POST', '/users', { name, email, password: PW, roleIds: [roles.find((r) => r.code === role).id] });
    const tmp = (await browser.newContext()).request;
    const ses = await apiLogin(tmp, email, PW);
    await api(tmp, ses, 'POST', '/auth/change-password', { currentPassword: PW, newPassword: PW2, confirmPassword: PW2 });
  }
  s = await apiLogin(R, 'admin@sima.local', 'Admin-Baru-98765');
  const opt = async (p) => (await api(R, s, 'GET', `${p}?limit=100`)).body.data;
  const cats = await opt('/categories'), uoms = await opt('/units'), units = await opt('/organizational-units');
  const laptop = (await api(R, s, 'POST', '/items', { name: 'Laptop Lenovo', type: 'ASSET', categoryId: cats.find((c) => c.code === 'ELK').id, unitOfMeasureId: uoms.find((u) => u.code === 'UNIT').id })).body.data;
  const lt1 = (await api(R, s, 'POST', '/locations', { code: 'LT-1', name: 'Lantai 1', type: 'FLOOR' })).body.data;
  const r101 = (await api(R, s, 'POST', '/locations', { code: 'R-101', name: 'Ruang 101', type: 'ROOM', parentId: lt1.id })).body.data;
  await api(R, s, 'POST', '/locations', { code: 'LT-2', name: 'Lantai 2', type: 'FLOOR' });
  await api(R, s, 'POST', '/persons', { name: 'Bu Sari' });
  await api(R, s, 'POST', '/assets', { itemId: laptop.id, quantity: 5, acquisitionYear: 2026, unitId: units[0].id, locationId: r101.id });
  const assets = (await api(R, s, 'GET', '/assets?limit=10&sortBy=code&sortOrder=asc')).body.data;
  const A = assets.map((a) => a.code);
  check('setup via API: pengguna, lokasi bertingkat, 5 aset di Ruang 101', assets.length === 5);

  const P = await mk(), AP = await mk(), X = await mk();
  lastPage = P.page;
  await uiLogin(P.page, 'petugas@sima.test', PW2);
  await uiLogin(AP.page, 'approver@sima.test', PW2);
  await uiLogin(X.page, 'admin2@sima.test', PW2);
  const p = P.page, a = AP.page, x = X.page;

  const approveFirst = async () => {
    await a.goto(BASE + '/persetujuan/menunggu');
    await a.getByRole('button', { name: 'Tinjau' }).first().click();
    await a.getByRole('dialog').getByRole('button', { name: 'Setujui' }).click();
    await a.getByRole('dialog').last().getByRole('button', { name: 'Setujui' }).click();
    await a.getByText('Dokumen disetujui').waitFor();
  };

  // ------------------------------------------------------------ A. pemeliharaan
  await p.goto(BASE + '/pemeliharaan');
  await p.getByText('Belum ada laporan pemeliharaan').waitFor();
  await p.getByRole('link', { name: 'Laporkan pemeliharaan' }).click();
  await p.getByRole('button', { name: 'Simpan laporan' }).click();
  check('laporan kosong menampilkan validasi', await p.getByText(/Aset tidak valid|ID tidak valid|Deskripsi kerusakan/).first().isVisible());
  await p.getByRole('combobox', { name: 'Aset', exact: true }).fill(A[0]);
  await listbox(p).getByRole('option').first().click();
  await lab(p, 'Deskripsi kerusakan / keperluan').fill('Layar berkedip dan sering mati');
  await p.getByRole('button', { name: 'Simpan laporan' }).click();
  await p.waitForURL(/\/pemeliharaan\/[0-9a-f-]{36}$/);
  const mUrl = p.url();
  await p.getByRole('button', { name: 'Ajukan persetujuan' }).click();
  await p.getByText('Pemeliharaan diajukan untuk persetujuan').waitFor();
  await approveFirst();
  await p.goto(mUrl);
  await p.getByText('Disetujui').first().waitFor();
  const assetRes = (code) => api(R, s, 'GET', `/assets?search=${code}`).then((r) => r.body.data[0]);
  check('persetujuan belum mengubah status aset (masih Tersedia)', (await assetRes(A[0])).status === 'AVAILABLE');
  await p.getByRole('button', { name: 'Mulai perbaikan' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Mulai perbaikan' }).click();
  await p.getByText('Perbaikan dimulai').waitFor();
  check('perbaikan dimulai: aset berstatus Dalam perbaikan', (await assetRes(A[0])).status === 'UNDER_MAINTENANCE');
  await p.goto(BASE + '/peminjaman/baru');
  await p.getByLabel('Tambah aset').fill(A[0]);
  await p.getByText(/Tidak ada aset yang cocok dan tersedia/).waitFor();
  check('aset dalam perbaikan tidak dapat dipilih untuk dipinjam', true);
  await p.goto(mUrl);
  await p.getByRole('button', { name: 'Selesaikan perbaikan' }).click();
  await lab(p.getByRole('dialog'), 'Tindakan perbaikan').fill('Ganti kabel fleksibel layar');
  await lab(p.getByRole('dialog'), 'Biaya \\(Rp\\)').fill('450000');
  await p.getByRole('dialog').getByRole('button', { name: 'Selesaikan' }).click();
  await p.getByText('Pemeliharaan selesai, aset kembali tersedia').waitFor();
  check('perbaikan selesai: aset tersedia lagi', (await assetRes(A[0])).status === 'AVAILABLE');
  await p.goto(BASE + '/perbaikan/riwayat');
  await p.getByRole('cell', { name: /PMH-/ }).first().waitFor();
  check('riwayat perbaikan memuat biaya', await p.getByText(/Rp\s*450\.000/).isVisible());
  await p.screenshot({ path: path.join(OUT, 't5-riwayat-perbaikan.png') });

  // ------------------------------------------------------------ B. penghapusan
  await p.goto(BASE + '/penghapusan/baru');
  await lab(p, 'Alasan penghapusan').fill('Rusak berat akibat banjir');
  await p.getByLabel('Tambah aset').fill(A[4]);
  await listbox(p).getByRole('option').first().click();
  await p.getByRole('button', { name: 'Simpan draft' }).click();
  await p.waitForURL(/\/penghapusan\/[0-9a-f-]{36}$/);
  const dUrl = p.url();
  await p.getByRole('button', { name: 'Ajukan persetujuan' }).click();
  await p.getByText('Penghapusan diajukan untuk persetujuan').waitFor();
  await approveFirst();
  check('petugas tidak melihat tombol finalisasi (tanpa izin)', (await p.goto(dUrl), await p.getByText('Disetujui').first().waitFor(), (await p.getByRole('button', { name: 'Finalisasi penghapusan' }).count()) === 0));
  await x.goto(dUrl);
  await x.getByRole('button', { name: 'Finalisasi penghapusan' }).click();
  await x.getByRole('dialog').getByRole('button', { name: 'Finalisasi' }).click();
  await x.getByText('Penghapusan difinalisasi').waitFor();
  const disposed = await assetRes(A[4]);
  check('finalisasi: aset berstatus Dihapuskan namun datanya tetap ada', disposed.status === 'DISPOSED');
  await x.goto(`${BASE}/q/${A[4]}`);
  await x.getByText(/sudah dihapuskan/).waitFor();
  check('QR aset dihapuskan tetap membuka identitas historis', await x.getByText(A[4]).first().isVisible());
  await x.goto(BASE + '/penghapusan-riwayat');
  await x.getByRole('cell', { name: /PHP-/ }).first().waitFor();
  check('riwayat penghapusan memuat dokumen final', true);
  const sidebar = await x.getByRole('navigation', { name: 'Navigasi utama' }).locator('a[aria-current="page"]').allInnerTexts();
  check('hanya satu menu aktif pada halaman riwayat penghapusan', sidebar.length === 1 && sidebar[0] === 'Riwayat Penghapusan', sidebar.join('|'));

  // ------------------------------------------------------------ C. stock opname
  await x.goto(BASE + '/opname');
  await x.getByText('Belum ada sesi stock opname').waitFor();
  await x.getByRole('button', { name: 'Buat sesi' }).click();
  let d = x.getByRole('dialog');
  await lab(d, 'Judul').fill('Opname Lantai 1 Triwulan IV');
  await pick(lab(d, 'Lokasi diperiksa'), 'Lantai 1');
  await d.getByRole('button', { name: 'Buat sesi' }).click();
  check('sesi tanpa petugas ditolak', await x.getByText('Tetapkan minimal satu petugas pemeriksa').isVisible() || await x.getByText(/petugas pemeriksa/i).first().isVisible());
  await d.getByLabel('Dewi Petugas').check();
  await d.getByRole('button', { name: 'Buat sesi' }).click();
  await x.getByText(/Sesi SOP-\d{4}-\d{4} dibuat/).waitFor();
  await x.getByRole('link', { name: /SOP-/ }).click();
  await x.waitForURL(/\/opname\/[0-9a-f-]{36}$/);
  const oUrl = x.url();
  const oId = oUrl.split('/').pop();
  await x.getByRole('button', { name: 'Mulai pemeriksaan' }).click();
  await x.getByRole('dialog').getByRole('button', { name: 'Mulai', exact: true }).click();
  await x.getByText(/Pemeriksaan dimulai: 4 aset/).waitFor();
  await x.getByRole('button', { name: /Belum diperiksa/ }).waitFor();
  check('lingkup mencakup sub-lokasi dan mengecualikan aset dihapuskan (4 aset)', (await x.getByRole('button', { name: /Belum diperiksa/ }).innerText()).startsWith('4'));

  // petugas memeriksa
  await p.goto(`${BASE}/opname/${oId}/periksa`);
  await p.getByText('Diperiksa 0 dari 4').waitFor();
  // (1) kamera palsu berisi QR aset
  const qr = await api(R, s, 'GET', `/assets/${assets[0].id}/qr`);
  fs.writeFileSync(path.join(TMP, 'qr.png'), await qr.res.body());
  const y4m = path.join(TMP, 'qr.y4m');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', path.join(TMP, 'qr.png'), '-vf', 'scale=480:480:flags=neighbor,pad=640:480:80:0:white,format=yuv420p', '-t', '4', '-r', '10', y4m]);
  const cam = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
  const cctx = await cam.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  const cp = await cctx.newPage();
  await uiLogin(cp, 'petugas@sima.test', PW2);
  await cp.goto(`${BASE}/opname/${oId}/periksa`);
  await cp.getByRole('button', { name: 'Nyalakan kamera' }).click();
  await cp.getByText('Aset terbaca').waitFor({ timeout: 15000 });
  check('QR dari kamera terbaca di halaman periksa', await cp.getByText(A[0]).first().isVisible());
  await cp.getByRole('button', { name: 'Simpan hasil' }).click();
  await cp.getByText(`${A[0]}: Sesuai`).waitFor();
  check('aset di lokasi dan kondisi sesuai tercatat Sesuai', true);
  await cp.screenshot({ path: path.join(OUT, 't5-periksa-mobile.png') });
  await cam.close();

  // (2) manual: ditemukan di lokasi lain
  await p.reload();
  await p.getByText('Diperiksa 1 dari 4').waitFor();
  await lab(p, 'Atau masukkan kode inventaris').fill(A[1]);
  await p.getByRole('button', { name: 'Lanjut' }).click();
  await pick(lab(p, 'Lokasi ditemukan'), 'Lantai 2');
  await lab(p, 'Catatan').fill('Dipinjam tanpa dicatat');
  await p.getByRole('button', { name: 'Simpan hasil' }).click();
  await p.getByText(`${A[1]}: Tidak sesuai`).waitFor();
  check('beda lokasi tercatat Tidak sesuai', true);
  await lab(p, 'Atau masukkan kode inventaris').fill('halo bukan kode');
  await p.getByRole('button', { name: 'Lanjut' }).click();
  await p.getByText('Isi QR bukan kode aset SIMA.').waitFor();
  check('isi QR non-SIMA ditolak di halaman periksa', true);

  // (3) offline: simpan di perangkat, sinkron otomatis saat kembali online
  await P.ctx.setOffline(true);
  await lab(p, 'Atau masukkan kode inventaris').fill(A[2]);
  await p.getByRole('button', { name: 'Lanjut' }).click();
  await p.getByRole('button', { name: 'Simpan hasil' }).click();
  await p.getByText(/Offline: catatan disimpan di perangkat/).waitFor();
  await p.getByText(/1 catatan menunggu sinkronisasi/).waitFor();
  check('offline: catatan masuk antrean perangkat dan terlihat pengguna', true);
  check('antrean tersimpan di penyimpanan perangkat', JSON.parse(await p.evaluate((id) => localStorage.getItem(`sima:opname-queue:${id}`), oId)).length === 1);
  await p.screenshot({ path: path.join(OUT, 't5-periksa-offline.png') });
  const serverSide = (await api(R, s, 'GET', `/stock-opnames/${oId}`)).body.data.summary;
  check('server belum menerima catatan offline', serverSide.MATCH === 1 && serverSide.MISMATCH === 1 && serverSide.NOT_CHECKED === 2, JSON.stringify(serverSide));
  await P.ctx.setOffline(false);
  await p.getByText(/catatan offline tersinkron/).waitFor({ timeout: 15000 });
  const after = (await api(R, s, 'GET', `/stock-opnames/${oId}`)).body.data.summary;
  check('kembali online: catatan tersinkron otomatis ke server', after.MATCH === 2 && after.NOT_CHECKED === 1, JSON.stringify(after));
  check('antrean perangkat dikosongkan setelah sinkron', (await p.evaluate((id) => localStorage.getItem(`sima:opname-queue:${id}`), oId)) === null);

  // pengajuan: aset ke-4 belum diperiksa
  await p.goto(oUrl);
  await p.getByRole('button', { name: 'Ajukan hasil' }).click();
  await p.getByText(/1 aset/).first().waitFor();
  check('pengajuan diblokir selama ada aset belum diperiksa', await p.getByRole('dialog').getByRole('button', { name: 'Ajukan hasil' }).isDisabled());
  await p.getByLabel(/Tandai 1 aset yang belum diperiksa sebagai tidak ditemukan/).check();
  await p.getByRole('dialog').getByRole('button', { name: 'Ajukan hasil' }).click();
  await p.getByText('Hasil pemeriksaan diajukan untuk verifikasi').waitFor();
  const master = (await assetRes(A[1]));
  check('master aset belum berubah sebelum verifikasi', master.location.name === 'Ruang 101' && (await assetRes(A[3])).status === 'AVAILABLE');

  // verifikasi: pembuat sesi ditolak, verifikator independen berhasil
  await x.goto(oUrl);
  await x.getByRole('button', { name: 'Verifikasi hasil' }).click();
  await x.getByRole('button', { name: 'Terapkan semua' }).click();
  await x.getByRole('button', { name: 'Simpan verifikasi' }).click();
  await x.getByText(/tidak membuat sesi atau memeriksa di lapangan/).waitFor();
  check('pembuat sesi tidak dapat memverifikasi hasilnya sendiri', true);
  await x.keyboard.press('Escape');
  await a.goto(oUrl);
  await a.getByRole('button', { name: 'Verifikasi hasil' }).click();
  await a.getByRole('dialog').getByRole('radiogroup').first().waitFor();
  check('simpan verifikasi tertahan sampai semua temuan diputuskan', await a.getByRole('button', { name: /temuan belum diputuskan/ }).isDisabled());
  await a.getByRole('radio', { name: 'Terapkan' }).first().click();
  await a.getByRole('radio', { name: 'Tolak' }).nth(1).click();
  await a.screenshot({ path: path.join(OUT, 't5-verifikasi.png') });
  await a.getByRole('button', { name: 'Simpan verifikasi' }).click();
  await a.getByText('Hasil pemeriksaan diverifikasi').waitFor();
  const [m1, m3] = [await assetRes(A[1]), await assetRes(A[3])];
  const applied = [m1.location.name, m3.status];
  check('keputusan menerapkan/menolak diterapkan ke master aset', (applied[0] === 'Lantai 2' && applied[1] === 'AVAILABLE') || (applied[0] === 'Ruang 101' && applied[1] === 'MISSING'), applied.join(','));
  await a.getByText('Terverifikasi').first().waitFor();
  check('sesi berstatus Terverifikasi', true);

  // ------------------------------------------------------------ D. mobile
  await p.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/pemeliharaan', mUrl.replace(BASE, ''), '/perbaikan/riwayat', '/penghapusan', dUrl.replace(BASE, ''), '/penghapusan-riwayat', '/opname', `/opname/${oId}`, `/opname/${oId}/periksa`, '/pemeliharaan/baru', '/penghapusan/baru']) {
    await p.goto(BASE + route);
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(300);
    const over = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(`mobile ${route.replace(/[0-9a-f-]{36}/, ':id')}: tanpa overflow horizontal`, !over);
  }

  check('tidak ada console error tak terduga', consoleErrors.length === 0, consoleErrors.join(' || ').slice(0, 300));
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} lulus`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  if (lastPage) await lastPage.screenshot({ path: path.join(OUT, 'error5.png') }).catch(() => {});
  console.error('E2E ERROR', String(e.message).split('\n').slice(0, 8).join('\n'));
  process.exit(2);
});
