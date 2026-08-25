import { cn } from '../../lib/shadcn/utils'
import { toneForStatus, formatStatusLabel, TONE_CLASSES, type StatusTone } from '../../utils/status'

interface StatusBadgeProps {
  status: string
  tone?: StatusTone
  label?: string
  className?: string
  dense?: boolean
}

export function StatusBadge({ status, tone, label, className, dense }: StatusBadgeProps) {
  const resolvedTone = tone ?? toneForStatus(status)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium whitespace-nowrap',
        dense ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        TONE_CLASSES[resolvedTone],
        className
      )}
    >
      {label ?? formatStatusLabel(status)}
    </span>
  )
}
