import { cn } from '../../lib/shadcn/utils'
import { toneForStatus, TONE_DOT_CLASSES, type StatusTone } from '../../utils/status'

interface HealthIndicatorProps {
  status: string
  tone?: StatusTone
  label?: string
  size?: 'sm' | 'md'
  pulse?: boolean
  className?: string
}

export function HealthIndicator({ status, tone, label, size = 'md', pulse, className }: HealthIndicatorProps) {
  const resolvedTone = tone ?? toneForStatus(status)
  const dotSize = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2'
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="relative inline-flex">
        {pulse && (resolvedTone === 'critical' || resolvedTone === 'warning') && (
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', TONE_DOT_CLASSES[resolvedTone])} />
        )}
        <span className={cn('relative inline-flex rounded-full', dotSize, TONE_DOT_CLASSES[resolvedTone])} />
      </span>
      <span className={cn('font-medium', size === 'sm' ? 'text-xs' : 'text-sm')}>{label ?? status}</span>
    </span>
  )
}
