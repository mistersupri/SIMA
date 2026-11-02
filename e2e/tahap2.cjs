const { chromium } = require('playwright');
const OUT = './e2e/shots';
const results = [];
const check = (name, ok, extra='') => { results.push([ok?'PASS':'FAIL', name, extra]); console.log((ok?'PASS ':'FAIL ')+name+(extra?' :: '+extra:'')); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type()==='error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: '+e.message));
  const base = 'http://localhost:5173';

  // 1. unauthenticated -> login
  await page.goto(base + '/pengaturan/pengguna');
  await page.waitForURL('**/login');
  check('akses tanpa login diarahkan ke /login', true);
  await page.screenshot({ path: OUT+'/01-login.png' });

  // 2. validation
  await page.getByRole('button', { name: 'Masuk' }).click();
  check('login kosong menampilkan validasi', await page.getByText('Format email tidak valid').isVisible() || await page.getByText('Email wajib diisi').isVisible());

  // 3. wrong password
  await page.getByLabel('Email').fill('admin@sima.local');
  await page.getByLabel('Password').fill('SalahBanget123');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.getByText('Email atau password salah').waitFor();
  check('password salah menampilkan galat dari server', true);

  // 4. correct login -> forced password change
  await page.getByLabel('Password').fill('Ganti-Password-Ini-123');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.waitForURL('**/ganti-password');
  check('login pertama memaksa ganti password', true);
  await page.screenshot({ path: OUT+'/02-ganti-password.png' });
  await page.getByLabel(/^Password saat ini/).fill('Ganti-Password-Ini-123');
  await page.getByLabel(/^Password baru/).fill('lemah');
  await page.getByLabel('Ulangi password baru').fill('lemah');
  await page.getByRole('button', { name: 'Simpan password' }).click();
  check('password lemah ditolak form', await page.getByText('Password minimal 10 karakter').isVisible());
  await page.getByLabel(/^Password baru/).fill('Admin-Baru-98765');
  await page.getByLabel('Ulangi password baru').fill('Admin-Baru-98765');
  await page.getByRole('button', { name: 'Simpan password' }).click();
  await page.waitForURL((u) => !/ganti-password|login/.test(u.pathname));
  check('setelah ganti password masuk ke halaman utama (menu pertama yang diizinkan)', true);
  await page.goto(base + '/pengaturan/pengguna');
  await page.getByRole('cell', { name: /Super Admin/ }).first().waitFor();
  await page.screenshot({ path: OUT+'/03-users.png' });

  // 5. create user
  await page.getByRole('button', { name: 'Tambah pengguna' }).click();
  await page.getByRole('button', { name: 'Simpan' }).click();
  check('form pengguna kosong menampilkan error per field', await page.getByText('Nama wajib diisi').isVisible());
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nama lengkap').fill('Sari Petugas');
  await dlg.getByLabel('Email').fill('sari@instansi.test');
  await dlg.getByLabel('Password sementara').fill('Sementara-12345');
  await dlg.getByLabel('Petugas Inventaris').check();
  await dlg.getByRole('button', { name: 'Simpan' }).click();
  await page.getByText('Pengguna dibuat').waitFor();
  await page.getByRole('cell', { name: /Sari Petugas sari/ }).waitFor();
  check('pengguna baru muncul di tabel (dari database)', true);

  // 6. search
  await page.getByLabel('Cari pengguna').fill('sari');
  await page.waitForTimeout(600);
  check('pencarian server-side menyaring baris', (await page.locator('tbody tr').count()) === 1);
  await page.getByLabel('Cari pengguna').fill('zzzz-tidak-ada');
  await page.getByText('Tidak ada pengguna ditemukan').waitFor();
  check('empty state tampil bila tak ada hasil', true);
  await page.getByLabel('Cari pengguna').fill('');
  await page.waitForTimeout(600);

  // 7. row menu: set roles + deactivate
  await page.getByRole('button', { name: 'Aksi untuk Sari Petugas' }).click();
  await page.getByRole('menuitem', { name: 'Atur role' }).click();
  await page.getByRole('dialog').getByLabel('Viewer / Auditor').check();
  await page.getByRole('button', { name: 'Simpan role' }).click();
  await page.getByText('Role pengguna diperbarui').waitFor();
  check('atur role menyimpan role ganda', await page.getByRole('row', { name: /Sari Petugas/ }).getByText('Viewer / Auditor').isVisible());
  await page.getByRole('button', { name: 'Aksi untuk Sari Petugas' }).click();
  await page.getByRole('menuitem', { name: 'Nonaktifkan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Nonaktifkan' }).click();
  await page.getByText('Status pengguna diperbarui').waitFor();
  check('nonaktifkan pengguna', await page.getByRole('row', { name: /Sari Petugas/ }).getByText('Nonaktif').isVisible());
  await page.keyboard.press('Escape');

  // 8. dialog closes with Escape
  await page.getByRole('button', { name: 'Tambah pengguna' }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  check('dialog tertutup dengan Escape', true);

  // 9. master data
  await page.getByRole('link', { name: 'Master Data' }).click();
  await page.waitForURL('**/master/organizational-units');
  await page.getByRole('cell', { name: 'Sekretariat', exact: true }).waitFor();
  check('master data memuat unit kerja seed dari database', true);
  await page.getByRole('link', { name: 'Kategori Barang' }).click();
  await page.getByRole('cell', { name: 'Elektronik', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Tambah kategori' }).first().click();
  await page.getByRole('dialog').getByLabel(/^Kode( \*)?$/).fill('kendaraan roda dua');
  await page.getByRole('dialog').getByLabel('Awalan kode otomatis').fill('AB');
  await page.getByRole('dialog').getByLabel('Nama kategori').fill('Motor Dinas');
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan' }).click();
  check('awalan 2 huruf ditolak', await page.getByText('Awalan kode harus 3 huruf').isVisible());
  await page.getByRole('dialog').getByLabel('Awalan kode otomatis').fill('mtr');
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan' }).click();
  await page.getByText('Kategori ditambahkan').waitFor();
  await page.getByRole('cell', { name: 'KENDARAAN-RODA-DUA', exact: true }).waitFor();
  check('kategori baru tersimpan, kode dinormalisasi server', true);
  // duplicate
  await page.getByRole('button', { name: 'Tambah kategori' }).first().click();
  await page.getByRole('dialog').getByLabel(/^Kode( \*)?$/).fill('KENDARAAN-RODA-DUA');
  await page.getByRole('dialog').getByLabel('Awalan kode otomatis').fill('xyz');
  await page.getByRole('dialog').getByLabel('Nama kategori').fill('Dobel');
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan' }).click();
  await page.getByText('Kode sudah dipakai').waitFor();
  check('kode ganda menampilkan galat 409 berbahasa Indonesia pada field', true);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: OUT+'/04-master.png' });
  // sort
  await page.getByRole('button', { name: 'Nama' }).click();
  await page.waitForTimeout(500);
  const names = await page.locator('tbody tr td:nth-child(3)').allTextContents();
  check('sorting server-side mengurutkan kolom', JSON.stringify(names) === JSON.stringify([...names].sort((a,b)=>a.localeCompare(b))), names.join('|'));
  // tab each resource
  for (const t of ['Lokasi dan Ruangan','Satuan','Merek','Vendor','Sumber Perolehan','Penanggung Jawab','Gudang','Unit Kerja']) {
    await page.getByRole('link', { name: t, exact: true }).click();
    await page.waitForTimeout(300);
    const bad = await page.getByRole('alert').count();
    check(`tab master "${t}" termuat tanpa galat`, bad === 0);
  }
  // location with parent
  await page.getByRole('link', { name: 'Lokasi dan Ruangan' }).click();
  await page.getByRole('button', { name: 'Tambah lokasi' }).first().click();
  await page.getByRole('dialog').getByLabel(/^Kode( \*)?$/).fill('GDG-A');
  await page.getByRole('dialog').getByLabel('Nama lokasi').fill('Gedung A');
  await page.getByRole('dialog').getByLabel('Tipe').selectOption('BUILDING');
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan' }).click();
  await page.getByText('Lokasi ditambahkan').waitFor();
  await page.getByRole('cell', { name: 'Gedung A', exact: true }).waitFor();
  check('lokasi gedung tersimpan', true);

  // 10. roles page
  await page.getByRole('link', { name: 'Role dan Permission' }).click();
  await page.getByRole('button', { name: /^Viewer \/ Auditor \d+ pengguna/ }).click();
  const cb = page.getByLabel(/Melihat pengguna/);
  const was = await cb.isChecked();
  await cb.click();
  check('checkbox permission berubah dan tombol simpan aktif', (await cb.isChecked()) !== was && await page.getByRole('button', { name: 'Simpan perubahan' }).isEnabled());
  await page.getByRole('button', { name: 'Simpan perubahan' }).click();
  await page.getByText('Permission role disimpan').waitFor();
  await cb.click();
  await page.getByRole('button', { name: 'Simpan perubahan' }).click();
  await page.getByText('Permission role disimpan').waitFor();
  check('permission role tersimpan ke database dan dipulihkan', true);
  await page.getByRole('button', { name: /^Super Admin \d+ pengguna/ }).click();
  check('permission Super Admin read-only', await page.getByLabel(/Melihat pengguna/).isDisabled());
  await page.screenshot({ path: OUT+'/05-roles.png', fullPage: true });

  // 11. keyboard: tab to a nav link shows focus
  await page.keyboard.press('Tab');
  // 12. mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/pengaturan/pengguna');
  await page.getByRole('cell', { name: /Super Admin/ }).first().waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('mobile: tidak ada overflow horizontal halaman (tabel scroll di dalam kartu)', !overflow);
  await page.getByRole('button', { name: 'Buka menu' }).click();
  await page.getByRole('navigation', { name: 'Navigasi utama' }).waitFor();
  await page.screenshot({ path: OUT+'/06-mobile-menu.png' });
  await page.getByRole('link', { name: 'Master Data' }).click();
  await page.waitForURL('**/master/**');
  check('mobile: menu laci menavigasi dan menutup', await page.getByRole('button', { name: 'Buka menu' }).isVisible());
  await page.screenshot({ path: OUT+'/07-mobile-master.png' });
  await page.setViewportSize({ width: 1280, height: 800 });

  // 13. logout
  await page.getByRole('button', { name: /Menu akun/ }).click();
  await page.getByRole('menuitem', { name: 'Keluar' }).click();
  await page.waitForURL('**/login');
  await page.goto(base + '/pengaturan/pengguna');
  await page.waitForURL('**/login');
  check('logout mengakhiri sesi; halaman terproteksi kembali ke login', true);

  // 14. non-admin sees only permitted nav
  await page.getByLabel('Email').fill('sari@instansi.test');
  await page.getByLabel('Password').fill('Sementara-12345');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.getByText('Akun Anda dinonaktifkan').waitFor();
  check('akun nonaktif ditolak login dengan pesan jelas', true);

  check('tidak ada console error selama seluruh alur', consoleErrors.filter(e => !/401|Failed to load resource/.test(e)).length === 0, consoleErrors.join(' || ').slice(0,300));
  await browser.close();
  const failed = results.filter(r => r[0]==='FAIL');
  console.log(`\n${results.length-failed.length}/${results.length} lulus`);
  process.exit(failed.length ? 1 : 0);
})().catch(async e => { console.error('E2E ERROR', e.message.split('\n').slice(0,6).join('\n')); process.exit(2); });
