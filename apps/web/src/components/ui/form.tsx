import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-control border border-line bg-surface px-3 text-base text-ink placeholder:text-muted/70 transition-colors duration-150 hover:border-slate-300 focus-visible:border-brand disabled:bg-wash disabled:text-muted aria-[invalid=true]:border-danger sm:text-sm';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(control, 'min-h-11 sm:min-h-10', className)} {...p} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(control, 'min-h-20 py-2', className)} {...p} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(control, 'min-h-11 sm:min-h-10', className)} {...p}>
    {children}
  </select>
));
Select.displayName = 'Select';

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}

/** Label + kontrol + pesan galat, terhubung lewat id dan aria-describedby. */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const descId = error || hint ? `${id}-desc` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span className="text-danger-ink" aria-hidden> *</span>}
      </label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': descId })}
      {(error || hint) && (
        <p id={descId} className={cn('text-sm', error ? 'text-danger-ink' : 'text-muted')} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Checkbox({ label, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-center gap-2.5 text-sm sm:min-h-8', className)}>
      <input type="checkbox" className="size-4 shrink-0 accent-brand" {...p} />
      <span>{label}</span>
    </label>
  );
}
