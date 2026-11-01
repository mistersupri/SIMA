# DESIGN.md, arah desain SIMA

Sumber arah: brief pemilik produk (palet, gaya "official enterprise dashboard", Bahasa Indonesia).

Design Read: dashboard inventaris internal untuk pegawai satu instansi (5-15 pengguna), bahasa visual resmi dan padat data, dial **ENERGY 1 / RHYTHM 1 / MOTION 1**.
Dial rendah itu pilihan sadar: pengguna bekerja berjam-jam di tabel dan form, jadi keseragaman dan ketenangan lebih berguna daripada kejutan komposisi.

## Palet (maks. 2 warna inti + 1 aksen, sesuai brief)

| Peran | Nilai | Alasan |
|---|---|---|
| Inti 1, navy | `#172554` | Sidebar, judul, tombol utama. Identitas "resmi" dari brief. |
| Inti 2, teks | `#1E293B` | Teks isi. Kontras tinggi di atas `#F8FAFC`. |
| Aksen, biru | `#2563EB` | Satu-satunya aksen: tautan, fokus, item aktif, aksi utama kedua. 5,2:1 di atas putih. |
| Latar | `#F8FAFC` | Latar halaman. Permukaan (kartu, tabel, form) putih `#FFFFFF`. |
| Status | hijau `#16A34A`, kuning `#D97706`, merah `#DC2626` | Hanya untuk makna status (kondisi aset, stok menipis, galat). Tidak dipakai dekoratif. |

Teks berwarna status memakai varian lebih gelap (`#166534`, `#92400E`, `#B91C1C`) karena warna dasar hijau/kuning tidak lolos 4,5:1 sebagai teks kecil.
Mode gelap tidak dikirim: tidak ada alasan produk, dan brief tidak memintanya. Satu tema, diuji penuh.

## Tipografi

- **IBM Plex Sans** (self-host lewat @fontsource, tanpa CDN agar PWA bekerja offline). Alasan: dirancang untuk antarmuka padat data, angka tabular jelas, nuansa institusional, terbaca di ukuran 13-14 px.
- **IBM Plex Mono** hanya untuk kode inventaris dan nomor dokumen. Alasan fungsional: kode `INV-ELK-2026-000001` harus sejajar antar baris dan mudah dibaca ulang saat stock opname.
- Tidak ada heading monospace besar, tidak ada label kapital ber-tracking lebar.

## Bentuk dan kedalaman

- Radius: 6 px kontrol (tombol, input), 8 px kartu dan tabel, 4 px badge status. Tidak ada elemen pil.
- Bayangan hanya untuk lapisan yang melayang (menu, dialog, toast). Kartu dan tabel memakai garis 1 px `#E2E8F0`.
- Tanpa gradien, glow, blur, grid latar, atau dekorasi. Tidak ada ilustrasi.

## Motif identitas

Kode inventaris dan nomor dokumen selalu ditampilkan sebagai "cap kode": Plex Mono, latar `#F1F5F9`, garis 1 px, radius 4 px. Satu gestur yang diulang di seluruh aplikasi (tabel, detail, label QR) dan membedakan SIMA dari dashboard generik.

## Ikon

Lucide, sesuai keputusan pemilik di brief (R-37: pola ikon-library dipertahankan atas arahan pemilik). Dipakai hemat: hanya ikon yang relevan dengan isi menu atau aksi, tidak pada setiap tombol, tanpa ikon sparkle/bintang/petir.

## Gerak (MOTION 1)

Mengikuti prinsip skill emil-design-eng: transisi 120-180 ms, `ease-out`, hanya `transform`/`opacity`, tidak ada animasi pada aksi keyboard atau tindakan berfrekuensi tinggi (sort, paginasi, buka baris). Dialog dan menu boleh fade+scale kecil. `prefers-reduced-motion` mematikan transisi.

## Komponen dan state

Setiap tampilan data punya state kosong, memuat, dan galat. Setiap kontrol dapat dioperasikan dengan keyboard dengan indikator fokus 2 px biru. Target sentuh minimum 44 px di layar sempit. Form satu kolom di ponsel.
