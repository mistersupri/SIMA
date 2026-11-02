export type ImportKey = 'items' | 'assets' | 'locations' | 'opening-stock';
export const IMPORT_DB_TYPE = { items: 'ITEMS', assets: 'ASSETS', locations: 'LOCATIONS', 'opening-stock': 'OPENING_STOCK' } as const;
export const IMPORT_PERMISSION: Record<ImportKey, string> = { items: 'items.import', assets: 'assets.import', locations: 'master.manage', 'opening-stock': 'stocks.import' };
export const IMPORT_LABEL: Record<ImportKey, string> = { items: 'Master barang', assets: 'Aset', locations: 'Lokasi', 'opening-stock': 'Saldo awal persediaan' };
export const MAX_IMPORT_ROWS = 5000;

export interface ColumnDef { key: string; header: string; required?: boolean; note: string; example: string }
export type RawRow = Record<string, string>;
export interface RowResult { row: number; raw: RawRow; errors: string[]; warnings: string[] }

export const COLUMNS: Record<ImportKey, ColumnDef[]> = {
  items: [
    { key: 'jenis', header: 'Jenis', required: true, note: 'Inventaris atau Persediaan', example: 'Inventaris' },
    { key: 'nama', header: 'Nama Barang', required: true, note: 'Maksimal 200 karakter', example: 'Laptop Lenovo ThinkPad E14' },
    { key: 'kategori', header: 'Kode Kategori', required: true, note: 'Kode kategori aktif di Master Data', example: 'ELK' },
    { key: 'satuan', header: 'Kode Satuan', required: true, note: 'Kode satuan aktif di Master Data', example: 'UNIT' },
    { key: 'merek', header: 'Merek', note: 'Nama merek yang sudah ada di Master Data', example: 'Lenovo' },
    { key: 'model', header: 'Tipe/Model', note: 'Opsional', example: 'E14 Gen 5' },
    { key: 'spesifikasi', header: 'Spesifikasi', note: 'Opsional', example: 'Core i5, 16 GB RAM' },
    { key: 'stokMinimum', header: 'Stok Minimum', note: 'Hanya untuk Persediaan; angka >= 0', example: '0' },
  ],
  assets: [
    { key: 'kodeBarang', header: 'Kode Barang', required: true, note: 'Kode master barang jenis Inventaris (BRG-...)', example: 'BRG-ELK-000001' },
    { key: 'nomorSeri', header: 'Nomor Seri', note: 'Unik per master barang. Kosongkan bila tidak ada', example: 'SN-0001' },
    { key: 'tahun', header: 'Tahun Perolehan', required: true, note: 'Empat digit', example: '2026' },
    { key: 'tanggal', header: 'Tanggal Perolehan', note: 'YYYY-MM-DD atau DD/MM/YYYY', example: '2026-03-15' },
    { key: 'harga', header: 'Harga Perolehan', note: 'Angka tanpa titik/koma. Kosong = 0', example: '12500000' },
    { key: 'kondisi', header: 'Kondisi', note: 'Baik, Rusak ringan, atau Rusak berat. Kosong = Baik', example: 'Baik' },
    { key: 'unit', header: 'Kode Unit', required: true, note: 'Kode unit kerja pengelola', example: 'UNIT-UTAMA' },
    { key: 'lokasi', header: 'Kode Lokasi', required: true, note: 'Kode lokasi fisik', example: 'R-101' },
    { key: 'penanggungJawab', header: 'NIP Penanggung Jawab', note: 'NIP pegawai di Master Data. Opsional', example: '198001012005011001' },
    { key: 'sumber', header: 'Kode Sumber Perolehan', note: 'Opsional', example: 'ANGGARAN' },
    { key: 'vendor', header: 'Kode Vendor', note: 'Opsional', example: 'PT-MAJU' },
    { key: 'catatan', header: 'Catatan', note: 'Opsional', example: '' },
  ],
  locations: [
    { key: 'kode', header: 'Kode Lokasi', required: true, note: 'Unik', example: 'GDG-A' },
    { key: 'nama', header: 'Nama Lokasi', required: true, note: 'Maksimal 150 karakter', example: 'Gedung A' },
    { key: 'tipe', header: 'Tipe', required: true, note: 'Gedung, Lantai, Ruangan, Area gudang, atau Lainnya', example: 'Gedung' },
    { key: 'induk', header: 'Kode Lokasi Induk', note: 'Boleh merujuk baris lain dalam file yang sama', example: '' },
    { key: 'unit', header: 'Kode Unit', note: 'Opsional', example: 'UNIT-UTAMA' },
  ],
  'opening-stock': [
    { key: 'kodeBarang', header: 'Kode Barang', required: true, note: 'Kode master barang jenis Persediaan (PRS-...)', example: 'PRS-ATK-000001' },
    { key: 'gudang', header: 'Kode Gudang', required: true, note: 'Kode gudang aktif', example: 'GDG-UTAMA' },
    { key: 'jumlah', header: 'Jumlah', required: true, note: 'Angka > 0', example: '100' },
    { key: 'harga', header: 'Harga Satuan', note: 'Opsional', example: '50000' },
    { key: 'tanggal', header: 'Tanggal Saldo', required: true, note: 'YYYY-MM-DD atau DD/MM/YYYY', example: '2026-01-01' },
    { key: 'catatan', header: 'Catatan', note: 'Opsional', example: '' },
  ],
};
