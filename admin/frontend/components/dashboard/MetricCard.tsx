import type { ReactNode } from 'react'
import { cn } from '../../lib/shadcn/utils'
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: ReactNode
  sublabel?: ReactNode
  icon?: LucideIcon
  trend?: { value: string; direction: 'up' | 'down'; positive?: boolean }
  tone?: 'default' | 'success' | 'warning' | 'critical' | 'info' | 'model'
  footer?: ReactNode
  className?: string
  onClick?: () => void
}

const TONE_ICON_CLASSES: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  critical: 'text-destructive',
  info: 'zc-text-info',
  model: 'zc-text-model',
}

export function MetricCard({ label, value, sublabel, icon: Icon, trend, tone = 'default', footer, className, onClick }: MetricCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-density-sm rounded-lg border border-border bg-card p-density-lg shadow-retool-sm',
        onClick && 'cursor-pointer transition-colors hover:border-foreground/20',
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn('h-4 w-4', TONE_ICON_CLASSES[tone])} />}
      </div>
      <div className="flex items-baseline gap-density-sm">
        <span className="text-2xl font-semibold tracking-tight text-foreground">{value}</span>
        {trend && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-xs font-medium',
              trend.positive === false ? 'text-destructive' : trend.positive ? 'text-success' : 'text-muted-foreground'
            )}
          >
            {trend.direction === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {trend.value}
          </span>
        )}
      </div>
      {sublabel && <span className="text-sm text-muted-foreground">{sublabel}</span>}
      {footer && <div className="mt-density-xs border-t border-border pt-density-sm">{footer}</div>}
    </div>
  )
}
