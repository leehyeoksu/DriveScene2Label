import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui Button API, styled with the design's `.btn` tokens instead of the default shadcn theme. */
const buttonVariants = cva('btn', {
  variants: {
    variant: { default: '', primary: 'btn--primary', ghost: 'btn--ghost', weak: 'btn--weak' },
    size: { default: '', sm: 'btn--sm', icon: 'btn--icon', 'icon-sm': 'btn--sm btn--icon', block: 'btn--block' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type = 'button', ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...(asChild ? {} : { type })} {...props} />;
}
