import React from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

const styles: Record<BadgeVariant, string> = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  success: 'bg-emerald-600 text-white',
  warning: 'bg-amber-500 text-white',
  destructive: 'bg-destructive text-destructive-foreground',
  outline: 'border border-border text-foreground',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        styles[variant],
        className
      )}
      {...props}
    />
  );
}

/** 状态标签配色映射 */
export function statusVariant(status: string): BadgeVariant {
  const s = (status || '').toLowerCase();
  if (['completed', 'approved', 'closed', 'success', 'published', 'active', 'delivered'].includes(s)) return 'success';
  if (['failed', 'rejected', 'error', 'cancelled', 'infeasible'].includes(s)) return 'destructive';
  if (['pending', 'executing', 'observed', 'oriented', 'optionsready', 'pendingapproval', 'draft'].includes(s)) return 'warning';
  return 'secondary';
}
