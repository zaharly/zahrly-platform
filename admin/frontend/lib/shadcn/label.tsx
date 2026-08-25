import * as React from 'react'
import { cn } from './utils'

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(function Label({ className, ...props }, ref) {
  return <label ref={ref} className={cn('text-sm font-medium leading-none text-foreground', className)} {...props} />
})
