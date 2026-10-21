import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium transition-colors border',
  {
    variants: {
      variant: {
        default:   'border-border bg-muted text-soft-foreground',
        success:   'border-ok-border bg-ok-soft text-ok',
        warning:   'border-warn-border bg-warn-soft text-warn',
        blue:      'border-info-border bg-info-soft text-info',
        gray:      'border-idle-border bg-idle-soft text-idle',
        destructive: 'border-bad-border bg-bad-soft text-bad',
        secondary: 'border-border bg-muted text-soft-foreground',
        outline:   'border-border-strong bg-transparent text-soft-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
