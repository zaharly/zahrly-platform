import type { Incident } from '../../types/domain'
import { StatusBadge } from '../status/StatusBadge'
import { cn } from '../../lib/shadcn/utils'

const SEVERITY_TONE: Record<Incident['severity'], 'critical' | 'warning' | 'info'> = {
  P0: 'critical',
  P1: 'critical',
  P2: 'warning',
  P3: 'info',
}

interface IncidentPanelProps {
  incidents: Incident[]
  onSelect?: (incident: Incident) => void
  limit?: number
  className?: string
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Compact incident list used on the Command Center and Operations pages. */
export function IncidentPanel({ incidents, onSelect, limit, className }: IncidentPanelProps) {
  const list = limit ? incidents.slice(0, limit) : incidents
  if (list.length === 0) {
    return <p className="text-sm text-muted-foreground">No active incidents.</p>
  }
  return (
    <ul className={cn('flex flex-col divide-y divide-border', className)}>
      {list.map((incident) => (
        <li
          key={incident.id}
          className={cn('flex items-start gap-density-sm py-density-sm', onSelect && 'cursor-pointer hover:bg-muted/40 -mx-density-sm px-density-sm rounded-md')}
          onClick={() => onSelect?.(incident)}
        >
          <StatusBadge status={incident.severity} tone={SEVERITY_TONE[incident.severity]} dense />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-foreground">{incident.title}</span>
            <span className="text-xs text-muted-foreground">
              {incident.category} · {incident.owner} · {timeAgo(incident.updatedAt)}
            </span>
          </div>
          <StatusBadge status={incident.status} dense />
        </li>
      ))}
    </ul>
  )
}
