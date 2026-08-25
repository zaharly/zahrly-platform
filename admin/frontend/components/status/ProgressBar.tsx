import { cn } from '../../lib/shadcn/utils'

interface ProgressBarProps {
  value: number
  max?: number
  label?: string
  showValue?: boolean
  tone?: 'default' | 'success' | 'warning' | 'critical' | 'info' | 'model'
  className?: string
  size?: 'sm' | 'md'
}

const TONE_BAR_CLASSES: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  default: 'bg-foreground',
  success: 'bg-success',
  warning: 'bg-warning',
  critical: 'bg-destructive',
  info: 'zc-dot-info',
  model: 'zc-dot-model',
}

/** Labeled progress bar used for completeness, coverage, and quota metrics. */
export function ProgressBar({ value, max = 100, label, showValue = true, tone = 'default', className, size = 'md' }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {label && <span>{label}</span>}
          {showValue && <span className="font-medium text-foreground">{value.toFixed(1)}%</span>}
        </div>
      )}
      <div className={cn('w-full overflow-hidden rounded-full bg-secondary', size === 'sm' ? 'h-1.5' : 'h-2.5')}>
        <div
          className={cn('h-full rounded-full transition-all', TONE_BAR_CLASSES[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
