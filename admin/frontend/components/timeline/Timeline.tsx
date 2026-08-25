import type { ReactNode } from 'react'
import { cn } from '../../lib/shadcn/utils'
import type { StatusTone } from '../../utils/status'
import { TONE_DOT_CLASSES } from '../../utils/status'

export interface TimelineItem {
  id: string
  timestamp: string
  title: ReactNode
  description?: ReactNode
  tone?: StatusTone
  meta?: ReactNode
}

interface TimelineProps {
  items: TimelineItem[]
  emptyMessage?: string
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Vertical append-only timeline for evidence updates, incidents, and audit trails. */
export function Timeline({ items, emptyMessage = 'No events recorded yet.' }: TimelineProps) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>
  }
  return (
    <ol className="relative flex flex-col gap-density-lg border-l border-border pl-density-lg">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            className={cn(
              'absolute -left-[1.45rem] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-background',
              TONE_DOT_CLASSES[item.tone ?? 'neutral']
            )}
          />
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-density-md gap-y-0.5">
              <span className="text-sm font-medium text-foreground">{item.title}</span>
              <span className="font-mono text-xs text-muted-foreground">{formatTimestamp(item.timestamp)}</span>
            </div>
            {item.description && <div className="text-sm text-muted-foreground">{item.description}</div>}
            {item.meta && <div className="text-xs text-muted-foreground">{item.meta}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}
