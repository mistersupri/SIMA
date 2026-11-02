import { useState } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown>;
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, danger, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      className="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(); onOpenChange(false); }
              catch { /* pemanggil sudah menampilkan galat; dialog tetap terbuka agar pengguna bisa mencoba lagi atau batal */ }
              finally { setBusy(false); }
            }}
          >
            {busy ? 'Memproses…' : confirmLabel}
          </Button>
        </>
      }
    >
      <span className="sr-only">{description}</span>
    </Dialog>
  );
}
