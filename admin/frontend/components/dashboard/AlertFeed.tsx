import { Link } from 'react-router-dom'
import { AlertTriangle, Info, XCircle } from 'lucide-react'
import type { Alert } from '../../types/domain'
import { cn } from '../../lib/shadcn/utils'

const SEVERITY_STYLE: Record<Alert['severity'], { icon: typeof AlertTriangle; className: string }> = {
  critical: { icon: XCircle, className: 'text-destructive' },
  warning: { icon: AlertTriangle, className: 'text-warning' },
  info: { icon: Info, className: 'zc-text-info' },
}

interface AlertFeedProps {
  alerts: Alert[]
  limit?: number
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Live operational alert feed used on the Command Center. */
export function AlertFeed({ alerts, limit }: AlertFeedProps) {
  const list = limit ? alerts.slice(0, limit) : alerts
  if (list.length === 0) return <p className="text-sm text-muted-foreground">No active alerts.</p>
  return (
    <ul className="flex flex-col divide-y divide-border">
      {list.map((alert) => {
        const style = SEVERITY_STYLE[alert.severity]
        const Icon = style.icon
        return (
          <li key={alert.id}>
            <Link to={alert.linkTo} className="flex items-start gap-density-sm rounded-md px-1 py-density-sm hover:bg-muted/40">
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.className)} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">{alert.title}</span>
                <span className="text-xs text-muted-foreground">{alert.message}</span>
                <span className="text-[11px] text-muted-foreground">{alert.owner} · {timeAgo(alert.createdAt)}</span>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
