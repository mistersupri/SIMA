const dateFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const qtyFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });
const rupiahFmt = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

export const formatDate = (v?: string | Date | null) => (v ? dateFmt.format(new Date(v)) : '-');
export const formatDateTime = (v?: string | Date | null) => (v ? dateTimeFmt.format(new Date(v)) : '-');
export const formatQty = (v?: string | number | null) => (v === null || v === undefined || v === '' ? '-' : qtyFmt.format(Number(v)));
export const formatRupiah = (v?: string | number | null) => (v === null || v === undefined || v === '' ? '-' : rupiahFmt.format(Number(v)));
export const todayIso = () => new Date().toISOString().slice(0, 10);
