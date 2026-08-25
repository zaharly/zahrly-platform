import * as React from 'react'
import { cn } from './utils'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'destructive' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'default', type = 'button', ...props }, ref,
) {
  return <button ref={ref} type={type} className={cn(
    'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    variant === 'default' && 'bg-foreground text-background hover:opacity-90',
    variant === 'outline' && 'border border-border bg-background hover:bg-muted',
    variant === 'destructive' && 'bg-destructive text-destructive-foreground hover:opacity-90',
    variant === 'secondary' && 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    variant === 'ghost' && 'hover:bg-muted',
    variant === 'link' && 'text-primary underline-offset-4 hover:underline',
    size === 'default' && 'h-9 px-4 py-2',
    size === 'sm' && 'h-8 px-3',
    size === 'lg' && 'h-10 px-5',
    size === 'icon' && 'h-9 w-9',
    className,
  )} {...props} />
})
