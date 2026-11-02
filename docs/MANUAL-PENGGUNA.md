# Manual pengguna SIMA

SIMA mencatat dua jenis barang:

- **Inventaris (aset individual)**: setiap unit punya kode unik dan **QR Code** (laptop, meja, kendaraan).
- **Persediaan**: dicatat jumlahnya per gudang (kertas, tinta). **Tidak memakai QR**.

Menu yang tampil mengikuti hak akses Anda. Menu yang tidak terlihat berarti role Anda tidak memilikinya; minta administrator bila perlu.

## 1. Role

| Role | Untuk | Bisa |
|---|---|---|
| Super Admin | Administrator sistem | Semua, termasuk pengguna, role, pengaturan aplikasi, dan memutuskan persetujuan |
| Admin Inventaris | Pengelola data | Semua operasi data dan master data, impor, laporan; **tidak** memutuskan persetujuan dan tidak mengatur pengguna |
| Petugas Inventaris | Operasional | Input barang/aset, stok masuk-keluar, pengajuan, serah terima, scan, stock opname lapangan |
| Approver (Kepala Unit) | Pemberi persetujuan | Melihat data; menyetujui/menolak pengajuan; memverifikasi hasil opname |
| Viewer (Auditor) | Pemeriksa | Hanya melihat, termasuk audit log, dan export laporan |

Aturan penting: **orang yang mengajukan atau membuat dokumen tidak dapat menyetujuinya sendiri** (berlaku juga untuk Super Admin).

## 2. Masuk dan akun

1. Buka alamat aplikasi, isi email dan password, klik **Masuk**.
2. Akun baru atau yang di-reset administrator **wajib mengganti password** (minimal 10 karakter).
3. Setelah 5 kali salah, akun terkunci 15 menit.
4. Lupa password: hubungi administrator (menu Pengguna → Atur ulang password). Aplikasi tidak mengirim email.
5. Keluar: klik nama Anda di pojok kanan atas → **Keluar**.

## 3. Menyiapkan data (Admin)

Urutan yang disarankan:

1. **Pengaturan → Pengaturan Aplikasi**: nama, alamat, telepon, email instansi (tampil di login, menu, dan kepala laporan).
2. **Pengaturan → Master Data**: unit kerja, lokasi (bertingkat: gedung → lantai → ruang), kategori, satuan, merek, vendor, sumber perolehan, penanggung jawab, gudang. Data yang sudah dipakai tidak dihapus, hanya dinonaktifkan.
3. **Pengaturan → Pengguna**: tambah pengguna, pilih role, batasi akses per unit kerja bila perlu.
4. **Data Barang**: daftarkan jenis barang (Aset atau Persediaan). Kodenya otomatis (`BRG-ELK-000001`, `PRS-ATK-000001`). Jenis tidak dapat diubah setelah dibuat.
5. Isi data awal sekaligus lewat **Pengaturan → Impor Excel** (bagian 9).

## 4. Inventaris (aset)

**Mendaftarkan aset**: menu **Aset → Registrasi**. Pilih barang, jumlah unit (1–100 sekaligus), tahun, unit kerja, lokasi, kondisi, nilai, nomor seri per unit. Sistem membuat kode seperti `INV-ELK-2026-000001`. Perolehan resmi sebaiknya lewat **Pengadaan → Penerimaan** (bagian 6) agar tercatat dokumennya.

**Detail aset** memiliki tab identitas, QR Code, foto, riwayat lokasi, riwayat kondisi, mutasi/peminjaman, pemeliharaan. Mengubah kondisi memerlukan alasan.

**QR Code**: di detail aset (unduh PNG/SVG) atau pilih beberapa aset di daftar lalu **Cetak QR** untuk label massal. Tempel di barang.

**Memindai**: menu **Scan QR**: arahkan kamera ke QR (izinkan akses kamera), atau ketik kode manual bila kamera tidak tersedia. Hasilnya membuka detail aset. QR yang dipindai dengan kamera bawaan ponsel juga langsung membuka aset (perlu login).

## 5. Persediaan

Menu **Persediaan**:

- **Barang masuk / keluar**: pilih gudang dan barang (banyak baris sekaligus). Keluar tidak boleh melebihi saldo; jika tidak cukup, seluruh transaksi ditolak.
- **Kartu stok**: riwayat per barang dan gudang dalam periode, dengan saldo pembuka dan akhir.
- **Stok menipis**: barang di bawah stok minimum.
- **Penyesuaian stok** (selisih/koreksi): diajukan, saldo **baru berubah setelah disetujui**.

## 6. Pengadaan dan penerimaan

1. **Pengadaan → Baru**: isi vendor, tanggal, baris barang (jumlah dan harga). Simpan sebagai draft, lalu **Ajukan persetujuan**.
2. Approver membuka **Menunggu Persetujuan** → Setujui, atau Tolak (alasan wajib). Yang ditolak dapat diperbaiki dan diajukan ulang.
3. Barang datang: **Penerimaan Barang** → buat penerimaan terhadap pengadaan (boleh sebagian) → **Konfirmasi** oleh petugas lain. Pada saat konfirmasi unit aset dan stok baru **terbentuk**; tidak ada sebelumnya.

## 7. Mutasi, peminjaman, pemeliharaan, penghapusan

Semuanya mengikuti alur: **Draft → Ajukan → Disetujui → dilaksanakan**. Data aset baru berubah pada tahap pelaksanaan.

- **Mutasi**: memindahkan aset antar lokasi/unit/penanggung jawab. Setelah disetujui, petugas menekan **Selesaikan**; lokasi aset berubah dan riwayat tercatat. Satu aset tidak bisa berada di dua mutasi terbuka.
- **Peminjaman**: pilih aset dan peminjam, tanggal jatuh tempo. Setelah disetujui: **Serah terima** (status Dipinjam), lalu **Pengembalian** dengan kondisi aktual (boleh sebagian). Aset yang sedang dipinjam, diperbaiki, atau dihapuskan tidak bisa dipinjam. Keterlambatan terdeteksi otomatis dan menghasilkan notifikasi.
- **Pemeliharaan/perbaikan**: lapor kerusakan → ajukan → setujui → **Mulai perbaikan** (aset otomatis Dalam perbaikan) → **Selesaikan** (tindakan, biaya, kondisi akhir). **Riwayat Perbaikan** menampilkan seluruh catatan.
- **Penghapusan**: ajukan → setujui → finalisasi. Aset berstatus **Dihapuskan**; datanya tetap ada untuk audit dan tidak dapat dipakai lagi.

Pengajuan yang masih draft/ditolak dapat dibatalkan oleh pembuatnya. Dokumen yang sudah diajukan tidak dapat diedit langsung.

## 8. Stock opname (pemeriksaan fisik)

1. **Admin/pembuat**: **Stock Opname → Baru**: judul, periode, lokasi dan/atau unit, tunjuk petugas → **Mulai**. Daftar aset dibekukan saat dimulai.
2. **Petugas** (di lokasi, boleh ponsel): buka sesi → **Periksa**: scan QR atau ketik kode → pilih hasil (Sesuai, Tidak sesuai/ada selisih kondisi-lokasi, Tidak ditemukan), catatan, **Simpan hasil**. Barang yang discan tapi tidak ada di daftar dicatat sebagai *barang tidak terdaftar*.
3. **Offline**: bila sinyal hilang, catatan disimpan di perangkat dan otomatis dikirim saat online (banner menunjukkan antrean). Pastikan sesi sudah dibuka sebelum masuk ke area tanpa sinyal.
4. Setelah selesai, petugas **Ajukan hasil**. **Verifikator** (bukan pembuat sesi atau petugas lapangan) memutuskan per temuan **Terapkan** (data aset diperbarui dan histori OPNAME tercatat) atau **Tolak**.

## 9. Impor Excel

Menu **Pengaturan → Impor Excel** (4 jenis: master barang, aset, lokasi, saldo awal persediaan).

1. Pilih jenis → **Unduh template** (lembar Data, Petunjuk, Referensi kode dari master data Anda).
2. Isi lembar Data. Jangan ubah judul kolom. Maks. 5.000 baris; format `.xlsx`.
3. **Unggah dan periksa file**: tiap baris diberi status valid/bermasalah beserta alasan; duplikat (di file dan di database) terdeteksi. **Unduh laporan kesalahan** untuk memperbaiki.
4. **Impor**: baris bermasalah **tidak pernah** diimpor. Jika ada kesalahan, Anda harus menyatakan "lewati baris bermasalah" secara eksplisit. Seluruh impor atomik; batch berlaku 24 jam dan hanya sekali pakai.
5. Saldo awal persediaan dicatat sebagai transaksi *Saldo awal* dan ditolak bila barang di gudang itu sudah punya riwayat.

Catatan: merek dan master lain harus sudah ada; kode pada template merujuk ke Master Data.

## 10. Persetujuan dan notifikasi

- **Persetujuan → Menunggu Persetujuan**: pengajuan yang menunggu keputusan Anda; buka, periksa, Setujui/Tolak (alasan wajib saat menolak).
- **Riwayat Persetujuan**: keputusan lampau.
- **Lonceng** di atas: notifikasi pribadi (perlu persetujuan, disetujui/ditolak, jatuh tempo/terlambat, stok menipis).

## 11. Dashboard dan laporan

- **Dashboard**: kartu statistik (klik untuk melihat daftarnya), grafik aset per kategori/kondisi/lokasi, pengadaan per bulan, pengajuan menunggu, aktivitas terbaru.
- **Laporan**: 9 laporan (inventaris, persediaan, kondisi, mutasi, peminjaman, pemeliharaan, pengadaan, penghapusan, stock opname) dengan filter. **Export XLSX/PDF** (maks. 20.000 baris) dan **Cetak**. Setiap export tercatat di audit log dan memuat nama instansi.
- **Audit Log** (Pengaturan): siapa, kapan, apa; rincian sebelum/sesudah; tidak dapat diubah.

## 12. Memakai di ponsel (PWA)

Buka aplikasi di Chrome/Safari → **Pasang aplikasi / Tambahkan ke layar utama**. Aplikasi dapat dibuka tanpa jaringan, tetapi hanya pemeriksaan stock opname yang dapat dikerjakan offline; transaksi, persetujuan, dan data terbaru butuh koneksi. Perlu pernah login di perangkat itu saat online. Keluar (logout) menghapus profil tersimpan.

## 13. Bantuan cepat

| Masalah | Penyebab/solusi |
|---|---|
| Menu tidak ada | Role Anda tidak punya izin; hubungi administrator |
| "Anda tidak berwenang menyetujui" | Anda pembuat/pengaju dokumen itu, atau role tidak punya izin approve |
| Kamera tidak menyala | Izinkan kamera pada browser (HTTPS wajib); gunakan input kode manual |
| Aset tidak bisa dipinjam/dimutasi | Sedang dipinjam, diperbaiki, ada mutasi terbuka, atau sudah dihapuskan |
| Stok keluar ditolak | Saldo tidak cukup |
| "Terlalu banyak permintaan" | Tunggu sesuai detik yang tertera |
| Halaman memuat galat saat offline | Wajar; buka kembali saat online |
