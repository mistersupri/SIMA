// E2E Tahap 4: pengadaan, penerimaan, approval, mutasi, peminjaman, penyesuaian stok, notifikasi.
// Memakai tiga pengguna berbeda di tiga konteks browser. Prasyarat: stack dev di database KOSONG yang baru di-seed.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUT = path.resolve(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
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
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function apiCall(request, session, method, url, body) {
  const res = await request.fetch(`${BASE}/api/v1${url}`, { method, data: body, headers: session ? { 'x-csrf-token': session.csrf } : {} });
  const json = await res.json().catch(() => null);
  return { status: res.status(), body: json };
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

(async () => {
  const consoleErrors = [];
  const browser = await chromium.launch();
  const mk = async (width = 1280) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    return { ctx, page };
  };

  // ---------------------------------------------------------------- setup lewat API (admin)
  const setupCtx = await browser.newContext();
  const R = setupCtx.request;
  let s = await apiLogin(R, 'admin@sima.local', 'Ganti-Password-Ini-123');
  await apiCall(R, s, 'POST', '/auth/change-password', { currentPassword: 'Ganti-Password-Ini-123', newPassword: 'Admin-Baru-98765', confirmPassword: 'Admin-Baru-98765' });
  s = await apiLogin(R, 'admin@sima.local', 'Admin-Baru-98765');
  const roles = (await apiCall(R, s, 'GET', '/roles/options')).body.data;
  const roleId = (code) => roles.find((r) => r.code === code).id;
  const PW = 'Sandi-Uji-12345';
  for (const [name, email, role] of [['Dewi Petugas', 'petugas@sima.test', 'PETUGAS_INVENTARIS'], ['Budi Approver', 'approver@sima.test', 'APPROVER'], ['Rani Admin', 'admin2@sima.test', 'ADMIN_INVENTARIS']]) {
    const r = await apiCall(R, s, 'POST', '/users', { name, email, password: PW, roleIds: [roleId(role)] });
    if (r.status !== 201) throw new Error('buat user gagal: ' + JSON.stringify(r.body));
  }
  const opt = async (p) => (await apiCall(R, s, 'GET', `${p}?limit=100`)).body.data;
  const [cats, uoms] = [await opt('/categories'), await opt('/units')];
  const cat = (code) => cats.find((c) => c.code === code).id;
  const uom = (code) => uoms.find((u) => u.code === code).id;
  const mkItem = async (b) => (await apiCall(R, s, 'POST', '/items', b)).body.data;
  await mkItem({ name: 'Laptop Lenovo ThinkPad', type: 'ASSET', categoryId: cat('ELK'), unitOfMeasureId: uom('UNIT') });
  await mkItem({ name: 'Kertas HVS A4', type: 'SUPPLY', categoryId: cat('ATK'), unitOfMeasureId: uom('RIM'), minStock: 50 });
  await apiCall(R, s, 'POST', '/vendors', { code: 'PT-MAJU', name: 'PT Maju Jaya' });
  const loc1 = (await apiCall(R, s, 'POST', '/locations', { code: 'GD-A', name: 'Gudang Barang', type: 'ROOM' })).body.data;
  const loc2 = (await apiCall(R, s, 'POST', '/locations', { code: 'R-KEPALA', name: 'Ruang Kepala', type: 'ROOM' })).body.data;
  await apiCall(R, s, 'POST', '/persons', { name: 'Bu Sari', position: 'Staf' });
  void loc1; void loc2;
  check('setup via API: 3 pengguna, master, barang', true);

  const P = await mk(); const A = await mk(); const X = await mk();
  lastPage = P.page;
  // login pertama memaksa ganti password; lakukan lewat API agar E2E fokus pada alur transaksi
  for (const [email] of [['petugas@sima.test'], ['approver@sima.test'], ['admin2@sima.test']]) {
    const ses = await apiLogin(R, email, PW);
    await apiCall(R, ses, 'POST', '/auth/change-password', { currentPassword: PW, newPassword: PW + 'x', confirmPassword: PW + 'x' });
  }
  const PW2 = PW + 'x';
  await uiLogin(P.page, 'petugas@sima.test', PW2);
  await uiLogin(A.page, 'approver@sima.test', PW2);
  await uiLogin(X.page, 'admin2@sima.test', PW2);
  const navP = await P.page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link').allTextContents();
  check('menu sesuai role: petugas tidak melihat Pengguna/Role', !navP.includes('Pengguna') && !navP.includes('Role dan Permission') && navP.includes('Pengadaan'), navP.join('|'));

  // ---------------------------------------------------------------- A. pengadaan oleh petugas
  const p = P.page;
  await p.goto(BASE + '/pengadaan');
  await p.getByText('Belum ada pengadaan').waitFor();
  await p.getByRole('link', { name: 'Buat pengadaan' }).click();
  await p.getByRole('button', { name: 'Simpan draft' }).click();
  check('form pengadaan kosong menampilkan validasi', await p.getByText(/Vendor tidak valid|ID tidak valid|Barang tidak valid/).first().isVisible());
  await pick(lab(p, 'Vendor'), 'PT Maju');
  await pick(p.getByLabel(/^Barang 1/), 'Laptop');
  await p.getByLabel(/^Jumlah/).nth(0).fill('2');
  await p.getByLabel(/^Harga satuan/).nth(0).fill('10000000');
  await p.getByRole('button', { name: 'Tambah baris' }).click();
  await pick(p.getByLabel(/^Barang 2/), 'Kertas');
  await p.getByLabel(/^Jumlah/).nth(1).fill('100');
  await p.getByLabel(/^Harga satuan/).nth(1).fill('50000');
  check('total dihitung live di form', await p.getByText(/Rp\s*25\.000\.000/).first().isVisible());
  await p.getByRole('button', { name: 'Simpan draft' }).click();
  await p.waitForURL(/\/pengadaan\/[0-9a-f-]{36}$/);
  const procUrl = p.url();
  const procId = procUrl.split('/').pop();
  await p.getByRole('heading', { name: /^Pengadaan PGD-/ }).waitFor();
  check('draft pengadaan tersimpan dengan total Rp 25.000.000', await p.getByText(/Rp\s*25\.000\.000/).first().isVisible());
  check('draft belum bisa menerima barang', (await p.getByRole('button', { name: 'Terima barang' }).count()) === 0);
  await p.getByRole('button', { name: 'Ajukan persetujuan' }).click();
  await p.getByText('Pengadaan diajukan untuk persetujuan').waitFor();
  await p.getByText('Menunggu persetujuan').first().waitFor();
  await p.getByRole('link', { name: 'Ubah' }).waitFor({ state: 'detached' });
  check('pengajuan mengubah status menjadi Menunggu persetujuan', true);
  await p.screenshot({ path: path.join(OUT, 't4-pengadaan.png') });

  // ---------------------------------------------------------------- B. approver: notifikasi, tinjau, setujui
  const a = A.page;
  await a.goto(BASE + '/pengadaan');
  await a.getByRole('button', { name: /^Notifikasi, 1 belum dibaca/ }).waitFor();
  check('approver menerima notifikasi persetujuan (lonceng menunjukkan 1)', true);
  await a.getByRole('button', { name: /^Notifikasi/ }).click();
  await a.getByText(/Persetujuan diperlukan: Pengadaan PGD-/).waitFor();
  await a.screenshot({ path: path.join(OUT, 't4-notif.png') });
  await a.getByText(/Persetujuan diperlukan: Pengadaan PGD-/).click();
  await a.waitForURL(`**/pengadaan/${procId}`);
  check('klik notifikasi membuka dokumen terkait', true);
  await a.getByRole('button', { name: /^Notifikasi$/ }).waitFor();
  check('notifikasi ditandai sudah dibaca', true);
  await a.getByRole('link', { name: 'Menunggu Persetujuan' }).click();
  await a.getByRole('button', { name: 'Tinjau' }).first().click();
  await a.getByRole('dialog').getByText(/Diajukan oleh/).first().waitFor();
  await a.getByRole('dialog').getByRole('button', { name: 'Tolak' }).click();
  await a.getByRole('dialog').last().getByRole('button', { name: 'Tolak' }).click();
  check('penolakan tanpa alasan diblokir', await a.getByRole('alert').filter({ hasText: 'Alasan penolakan wajib diisi' }).isVisible());
  await a.keyboard.press('Escape');
  await a.getByRole('dialog').getByRole('button', { name: 'Setujui' }).click();
  await a.getByRole('dialog').last().getByLabel(/^Catatan/).fill('Sesuai anggaran');
  await a.getByRole('dialog').last().getByRole('button', { name: 'Setujui' }).click();
  await a.getByText('Dokumen disetujui').waitFor();
  check('approver menyetujui dari daftar persetujuan', true);
  await a.getByText('Tidak ada dokumen yang menunggu persetujuan Anda').waitFor();
  await a.getByRole('link', { name: 'Riwayat Persetujuan' }).click();
  await a.getByRole('cell', { name: /PGD-/ }).first().waitFor();
  check('riwayat persetujuan memuat keputusan', await a.getByText('Disetujui').first().isVisible());

  // petugas (pembuat) tidak melihat dokumen itu di daftar tunggunya dan status sudah Disetujui
  await p.goto(BASE + '/persetujuan/menunggu');
  await p.getByText('Tidak ada dokumen yang menunggu persetujuan Anda').waitFor();
  await p.goto(procUrl);
  await p.getByText('Disetujui oleh Budi Approver').waitFor();
  check('timeline menampilkan siapa yang menyetujui dan catatannya', await p.getByText('Sesuai anggaran').isVisible());
  check('dokumen disetujui tidak bisa diedit langsung', (await p.getByRole('link', { name: 'Ubah' }).count()) === 0);
  await p.goto(BASE + '/aset');
  await p.getByText('Belum ada aset').waitFor();
  check('persetujuan belum menambah inventaris', true);

  // ---------------------------------------------------------------- C. penerimaan oleh petugas, konfirmasi oleh admin lain
  await p.goto(procUrl);
  await p.getByRole('button', { name: 'Terima barang' }).click();
  let d = p.getByRole('dialog');
  await pick(lab(d, 'Gudang \\(persediaan\\)'), 'Gudang Utama');
  await pick(lab(d, 'Unit pengelola \\(aset\\)'), 'Sekretariat');
  await pick(lab(d, 'Lokasi awal \\(aset\\)'), 'Gudang Barang');
  await d.getByLabel(/^Nomor seri Laptop/).fill('SN-001\nSN-002');
  await d.getByLabel(/^Jumlah diterima: Laptop/).fill('3');
  await d.getByRole('button', { name: 'Catat penerimaan' }).click();
  await p.getByText(/Melebihi sisa/).waitFor();
  check('jumlah melebihi sisa pengadaan ditolak', true);
  await d.getByLabel(/^Jumlah diterima: Laptop/).fill('2');
  await d.getByRole('button', { name: 'Catat penerimaan' }).click();
  await p.getByText(/Penerimaan TRM-\d{4}-\d{4} dicatat/).waitFor();
  await p.goto(BASE + '/aset');
  await p.getByText('Belum ada aset').waitFor();
  check('penerimaan belum dikonfirmasi: inventaris masih kosong', true);
  await p.goto(BASE + '/penerimaan');
  await p.getByRole('button', { name: /^Aksi untuk TRM-/ }).click();
  await p.getByRole('menuitem', { name: 'Konfirmasi penerimaan' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await p.getByText(/harus dilakukan oleh petugas lain/).waitFor();
  check('pencatat tidak bisa memverifikasi penerimaannya sendiri', true);
  await p.keyboard.press('Escape');

  const x = X.page;
  await x.goto(BASE + '/penerimaan');
  await x.getByRole('button', { name: /^Aksi untuk TRM-/ }).click();
  await x.getByRole('menuitem', { name: 'Konfirmasi penerimaan' }).click();
  await x.getByRole('dialog').getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await x.getByText('Penerimaan dikonfirmasi').first().waitFor();
  await x.goto(BASE + '/aset');
  await x.locator('tbody tr').nth(1).waitFor();
  const codes = await x.locator('tbody tr .code-stamp').allInnerTexts();
  check('konfirmasi melahirkan 2 unit aset dengan kode unik', codes.length === 2 && new Set(codes).size === 2, codes.join(','));
  check('nomor seri dari penerimaan tersimpan', await x.getByText('SN SN-001').isVisible() && await x.getByText('SN SN-002').isVisible());
  await x.goto(BASE + '/persediaan');
  await x.getByRole('row', { name: /Kertas HVS A4/ }).getByText(/\b100 Rim/).waitFor();
  check('konfirmasi menambah stok kertas 100', true);
  await x.goto(procUrl);
  await x.getByText('Selesai').first().waitFor();
  check('pengadaan berstatus Selesai setelah seluruh barang diterima dan dikonfirmasi', true);

  // ---------------------------------------------------------------- D. mutasi
  const assetsRes = (await apiCall(R, s, 'GET', '/assets?limit=10')).body.data;
  const assetA = assetsRes[0], assetB = assetsRes[1];
  await p.goto(BASE + '/mutasi');
  await p.getByRole('link', { name: 'Buat mutasi' }).click();
  await lab(p, 'Alasan mutasi').fill('Dipindah ke ruang kepala');
  await p.getByLabel('Tambah aset').fill(assetA.code.slice(0, 12));
  await p.getByRole('listbox', { name: 'Hasil pencarian aset' }).getByRole('option').first().waitFor();
  await p.getByRole('listbox', { name: 'Hasil pencarian aset' }).getByRole('option').first().click();
  await p.getByRole('button', { name: 'Simpan draft' }).click();
  await p.getByText(/Pilih unit|ID tidak valid|Unit tujuan/).first().waitFor();
  check('tujuan mutasi wajib diisi', true);
  await pick(lab(p, 'Unit tujuan'), 'Sekretariat');
  await pick(lab(p, 'Lokasi tujuan'), 'Ruang Kepala');
  await p.getByRole('button', { name: 'Simpan draft' }).click();
  await p.waitForURL(/\/mutasi\/[0-9a-f-]{36}$/);
  const mutUrl = p.url();
  await p.getByRole('button', { name: 'Ajukan persetujuan' }).click();
  await p.getByText('Mutasi diajukan untuk persetujuan').waitFor();
  await a.goto(BASE + '/persetujuan/menunggu');
  await a.getByRole('button', { name: 'Tinjau' }).first().click();
  await a.getByRole('dialog').getByRole('button', { name: 'Setujui' }).click();
  await a.getByRole('dialog').last().getByRole('button', { name: 'Setujui' }).click();
  await a.getByText('Dokumen disetujui').waitFor();
  await p.goto(mutUrl);
  await p.getByText('Disetujui').first().waitFor();
  await p.goto(`${BASE}/aset/${assetA.id}`);
  await p.getByText('Gudang Barang').first().waitFor();
  check('setelah disetujui, lokasi aset belum berubah', !(await p.getByText('Ruang Kepala').count()));
  await p.goto(mutUrl);
  await p.getByRole('button', { name: 'Catat pemindahan' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Catat pemindahan' }).click();
  await p.getByText(/Pemindahan dicatat/).waitFor();
  await p.getByRole('button', { name: 'Konfirmasi selesai' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Konfirmasi selesai' }).click();
  await p.getByText('Mutasi selesai, lokasi aset diperbarui').waitFor();
  await p.goto(`${BASE}/aset/${assetA.id}`);
  await p.getByText('Ruang Kepala').first().waitFor();
  await p.getByRole('tab', { name: 'Histori lokasi' }).click();
  await p.getByRole('cell', { name: 'Mutasi', exact: true }).first().waitFor();
  check('mutasi selesai: lokasi berubah dan histori mencatat Mutasi', true);

  // ---------------------------------------------------------------- E. peminjaman
  await p.goto(BASE + '/peminjaman/baru');
  await pick(lab(p, 'Peminjam'), 'Bu Sari');
  await lab(p, 'Rencana pengembalian').fill(day(3));
  await lab(p, 'Keperluan').fill('Rapat di luar kantor');
  await p.getByLabel('Tambah aset').fill(assetB.code);
  await p.getByRole('listbox', { name: 'Hasil pencarian aset' }).getByRole('option').first().click();
  await p.getByRole('button', { name: 'Simpan draft' }).click();
  await p.waitForURL(/\/peminjaman\/[0-9a-f-]{36}$/);
  const loanUrl = p.url();
  await p.getByRole('button', { name: 'Ajukan persetujuan' }).click();
  await p.getByText('Peminjaman diajukan untuk persetujuan').waitFor();

  // pengguna lain mencoba meminjam aset yang sama (draft lalu ajukan)
  await x.goto(BASE + '/peminjaman/baru');
  await pick(lab(x, 'Peminjam'), 'Bu Sari');
  await lab(x, 'Rencana pengembalian').fill(day(2));
  await lab(x, 'Keperluan').fill('Dobel');
  await x.getByLabel('Tambah aset').fill(assetB.code);
  await x.getByRole('listbox', { name: 'Hasil pencarian aset' }).getByRole('option').first().click();
  await x.getByRole('button', { name: 'Simpan draft' }).click();
  await x.waitForURL(/\/peminjaman\/[0-9a-f-]{36}$/);
  await x.getByRole('button', { name: 'Ajukan persetujuan' }).click();
  await x.getByText(/peminjaman lain yang masih berjalan/).waitFor();
  check('pinjam ganda ditolak saat diajukan', true);

  await a.goto(BASE + '/persetujuan/menunggu');
  await a.getByRole('button', { name: 'Tinjau' }).first().click();
  await a.getByRole('dialog').getByRole('button', { name: 'Setujui' }).click();
  await a.getByRole('dialog').last().getByRole('button', { name: 'Setujui' }).click();
  await a.getByText('Dokumen disetujui').waitFor();
  await p.goto(loanUrl);
  await p.getByRole('button', { name: 'Serah terima' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Catat serah terima' }).click();
  await p.getByText('Serah terima dicatat, aset berstatus dipinjam').waitFor();
  await p.goto(`${BASE}/aset/${assetB.id}`);
  await p.getByText('Dipinjam').first().waitFor();
  check('aset berstatus Dipinjam setelah serah terima', true);

  await p.goto(BASE + '/peminjaman/baru');
  await p.getByLabel('Tambah aset').fill(assetB.code);
  await p.getByText(/Tidak ada aset yang cocok dan tersedia/).waitFor();
  check('aset yang sedang dipinjam tidak muncul sebagai pilihan', true);

  await p.goto(loanUrl);
  await p.getByRole('button', { name: 'Proses pengembalian' }).click();
  await lab(p.getByRole('dialog'), 'Kondisi saat kembali').selectOption('MINOR_DAMAGE');
  await p.getByRole('dialog').getByRole('button', { name: 'Catat pengembalian' }).click();
  await p.getByText(/peminjaman selesai/).waitFor();
  await p.goto(`${BASE}/aset/${assetB.id}`);
  await p.getByText('Rusak ringan').first().waitFor();
  await p.getByText('Tersedia').first().waitFor();
  check('pengembalian mencatat kondisi baru dan aset tersedia lagi', true);
  await p.getByRole('tab', { name: 'Peminjaman' }).click();
  await p.getByRole('cell', { name: /PJM-/ }).first().waitFor();
  check('tab peminjaman aset memuat riwayat', true);

  // ---------------------------------------------------------------- F. penyesuaian stok
  await p.goto(BASE + '/persediaan/penyesuaian');
  await p.getByRole('button', { name: 'Buat penyesuaian' }).click();
  d = p.getByRole('dialog');
  await pick(lab(d, 'Barang'), 'Kertas');
  await pick(lab(d, 'Gudang'), 'Gudang Utama');
  await lab(d, 'Selisih jumlah').fill('-10');
  await lab(d, 'Alasan').fill('Hasil hitung fisik');
  await d.getByRole('button', { name: 'Simpan draft' }).click();
  await p.getByText(/Penyesuaian PNY-\d{4}-\d{4} dibuat/).waitFor();
  await p.getByRole('button', { name: /^Aksi untuk PNY-/ }).click();
  await p.getByRole('menuitem', { name: 'Ajukan persetujuan' }).click();
  await p.getByText('Penyesuaian diajukan untuk persetujuan').waitFor();
  await a.goto(BASE + '/persetujuan/menunggu');
  await a.getByRole('button', { name: 'Tinjau' }).first().click();
  await a.getByRole('dialog').getByRole('button', { name: 'Setujui' }).click();
  await a.getByRole('dialog').last().getByRole('button', { name: 'Setujui' }).click();
  await a.getByText('Dokumen disetujui').waitFor();
  await p.goto(BASE + '/persediaan');
  await p.getByRole('row', { name: /Kertas HVS A4/ }).getByText(/\b90 Rim/).waitFor();
  check('penyesuaian disetujui mengubah saldo 100 menjadi 90', true);
  await p.getByRole('link', { name: /Kertas HVS A4/ }).click();
  await p.getByRole('cell', { name: 'Penyesuaian' }).first().waitFor();
  check('kartu stok mencatat transaksi penyesuaian', true);

  // ---------------------------------------------------------------- G. mobile
  await p.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/pengadaan', procUrl.replace(BASE, ''), '/mutasi', mutUrl.replace(BASE, ''), '/peminjaman', loanUrl.replace(BASE, ''), '/penerimaan', '/persetujuan/riwayat', '/pengadaan/baru', '/peminjaman/baru']) {
    await p.goto(BASE + route);
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(300);
    const over = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(`mobile ${route.replace(/[0-9a-f-]{36}/, ':id')}: tanpa overflow horizontal`, !over);
  }
  await p.getByRole('button', { name: /^Notifikasi/ }).click();
  const box = await p.locator('[role=dialog], [data-radix-popper-content-wrapper]').first().boundingBox();
  check('mobile: popover notifikasi muat di layar', !box || (box.x >= 0 && box.x + box.width <= 390));
  await p.screenshot({ path: path.join(OUT, 't4-mobile-notif.png') });

  check('tidak ada console error tak terduga', consoleErrors.length === 0, consoleErrors.join(' || ').slice(0, 300));
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} lulus`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  if (lastPage) await lastPage.screenshot({ path: path.join(OUT, 'error4.png') }).catch(() => {});
  console.error('E2E ERROR', String(e.message).split('\n').slice(0, 8).join('\n'));
  process.exit(2);
});
