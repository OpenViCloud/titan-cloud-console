import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      <input
        ref={ref}
        className={cn(
          'w-full rounded-md border bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-faint',
          'focus:outline-none focus:ring-1 focus:ring-ring focus:border-border-strong',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'transition-colors',
          error ? 'border-bad-border' : 'border-border',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  )
)
Input.displayName = 'Input'

export { Input }
