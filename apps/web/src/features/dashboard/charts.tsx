import { cn } from '@/lib/utils';

export interface BarDatum { name: string; value: number; tone?: 'brand' | 'success' | 'warning' | 'danger' }
const TONE = { brand: 'bg-brand', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' } as const;

/** Daftar batang horizontal: nilai selalu tertulis sebagai teks sehingga tidak bergantung pada warna. */
export function BarList({ data, label, empty }: { data: BarDatum[]; label: string; empty: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length || data.every((d) => d.value === 0)) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul aria-label={label} className="flex flex-col gap-2.5">
      {data.map((d) => (
        <li key={d.name} className="grid grid-cols-[minmax(6rem,38%)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate" title={d.name}>{d.name}</span>
          <span className="h-2.5 overflow-hidden rounded-tag bg-wash" aria-hidden><span className={cn('block h-full rounded-tag transition-[width] duration-300 ease-out', TONE[d.tone ?? 'brand'])} style={{ width: `${(d.value / max) * 100}%` }} /></span>
          <span className="w-10 text-right font-medium">{d.value}</span>
        </li>
      ))}
    </ul>
  );
}

const rupiahShort = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(1).replace('.0', '')} M` : v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.0', '')} jt` : v >= 1e3 ? `${Math.round(v / 1e3)} rb` : String(v));

/** Diagram kolom per bulan (SVG). Tabel tersembunyi menyediakan angka lengkap untuk pembaca layar. */
export function MonthChart({ data }: { data: { label: string; total: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const W = 560, H = 190, padL = 8, padB = 26, padT = 18, bw = (W - padL) / data.length;
  if (data.every((d) => d.total === 0)) return <p className="py-6 text-center text-sm text-muted">Belum ada pengadaan yang disetujui dalam 12 bulan terakhir.</p>;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Nilai pengadaan disetujui per bulan, 12 bulan terakhir" className="h-auto w-full">
        <title>Nilai pengadaan disetujui per bulan</title>
        <line x1={padL} x2={W} y1={H - padB} y2={H - padB} stroke="#E2E8F0" />
        {data.map((d, i) => {
          const h = ((H - padB - padT) * d.total) / max;
          const x = padL + i * bw;
          return (
            <g key={d.label}>
              <rect x={x + bw * 0.18} y={H - padB - h} width={bw * 0.64} height={Math.max(h, d.total ? 2 : 0)} rx={3} fill="#2563EB"><title>{`${d.label}: Rp ${d.total.toLocaleString('id-ID')}`}</title></rect>
              {d.total > 0 && <text x={x + bw / 2} y={H - padB - h - 5} textAnchor="middle" fontSize="9" fill="#475569">{rupiahShort(d.total)}</text>}
              <text x={x + bw / 2} y={H - 9} textAnchor="middle" fontSize="9.5" fill="#475569">{d.label}</text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only"><caption>Nilai pengadaan disetujui per bulan</caption><tbody>{data.map((d) => <tr key={d.label}><th scope="row">{d.label}</th><td>Rp {d.total.toLocaleString('id-ID')}</td></tr>)}</tbody></table>
    </div>
  );
}
