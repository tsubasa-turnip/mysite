import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'default';
  }
>(function Button({ className, variant = 'primary', size = 'default', ...props }, ref) {
  return (
    <button
      ref={ref}
      className={twMerge(clsx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className))}
      {...props}
    />
  );
});
