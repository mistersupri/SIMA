import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const button = cva(
  // transisi hanya pada properti yang berubah; :active memberi umpan balik tekan 
  'inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap select-none transition-[background-color,border-color,transform,opacity] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-navy text-white hover:bg-brand',
        secondary: 'border border-line bg-surface text-ink hover:bg-wash',
        ghost: 'text-ink hover:bg-wash',
        danger: 'bg-danger-ink text-white hover:bg-danger',
      },
      size: {
        md: 'min-h-11 px-4 text-sm sm:min-h-10',
        sm: 'min-h-11 px-3 text-sm sm:min-h-8',
        icon: 'size-11 sm:size-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, Props>(({ className, variant, size, asChild, type = 'button', ...p }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} {...(asChild ? {} : { type })} className={cn(button({ variant, size }), className)} {...p} />;
});
Button.displayName = 'Button';
