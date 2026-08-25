import { ShieldCheck } from 'lucide-react'
import { cn } from '../../lib/shadcn/utils'
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from '../../lib/shadcn/tooltip'

interface PolicyBadgeProps {
  version: string
  description?: string
  className?: string
}

/** Small badge indicating a value is governed by a named, versioned policy. */
export function PolicyBadge({ version, description, className }: PolicyBadgeProps) {
  const badge = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground',
        className
      )}
    >
      <ShieldCheck className="h-3 w-3" />
      {version}
    </span>
  )
  if (!description) return badge
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-xs">{description}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
