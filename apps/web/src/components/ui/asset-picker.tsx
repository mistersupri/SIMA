import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, buildQuery } from '@/lib/api';
import { useDebounced } from '@/hooks/use-debounced';
import { cn } from '@/lib/utils';
import { Input } from './form';

export interface PickedAsset {
  id: string;
  code: string;
  name: string;
  location?: string;
}
interface AssetHit { id: string; code: string; item: { name: string }; location: { name: string }; status: string }

interface Props {
  onSelect: (asset: PickedAsset) => void;
  /** Filter status di server, misalnya AVAILABLE agar hanya aset yang bisa dipakai tampil. */
  status?: string;
  excludeIds?: string[];
  placeholder?: string;
  'aria-label'?: string;
  invalid?: boolean;
  id?: string;
}

/** Combobox pencarian aset di server (kode, nomor seri, nama). Navigasi panah, Enter, Escape. */
export function AssetPicker({ onSelect, status, excludeIds = [], placeholder = 'Cari kode, nomor seri, atau nama aset', invalid, id, ...rest }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const term = useDebounced(text.trim(), 250);
  const q = useQuery({
    queryKey: ['asset-picker', term, status],
    enabled: open,
    queryFn: async ({ signal }) => (await api.get<AssetHit[]>(`/assets${buildQuery({ search: term, status, limit: 10, sortBy: 'code', sortOrder: 'asc' })}`, signal)).data,
  });
  // Hasil lama disembunyikan selama teks belum sinkron dengan pencarian, agar tidak salah pilih.
  const stale = text.trim() !== term;
  const hits = stale ? [] : (q.data ?? []).filter((h) => !excludeIds.includes(h.id));
  const pick = (h: AssetHit) => { onSelect({ id: h.id, code: h.code, name: h.item.name, location: h.location.name }); setText(''); setOpen(false); setActive(0); };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <Input
        id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-invalid={invalid} aria-label={rest['aria-label']}
        aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
        autoComplete="off" className="pl-9" placeholder={placeholder} value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && open && hits[active]) { e.preventDefault(); pick(hits[active]!); }
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="Hasil pencarian aset" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-card border border-line bg-surface py-1 shadow-lg">
          {(stale || (q.isFetching && !q.data)) && <li className="px-3 py-2 text-sm text-muted">Mencari…</li>}
          {!stale && q.data && hits.length === 0 && <li className="px-3 py-2 text-sm text-muted">Tidak ada aset yang cocok{status ? ' dan tersedia' : ''}.</li>}
          {hits.map((h, i) => (
            <li key={h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)} onMouseEnter={() => setActive(i)}
              className={cn('flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1.5 text-sm sm:min-h-0', i === active && 'bg-wash')}>
              <span><span className="code-stamp">{h.code}</span> <span className="ml-1 font-medium">{h.item.name}</span></span>
              <span className="text-xs text-muted">{h.location.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
