import { useMemo } from 'react'
import { INCIDENTS } from '../mock/data/incidents'
import { DATA_QUALITY_DOMAINS } from '../mock/data/dataQuality'
import { CONSISTENCY_CHECKS } from '../mock/data/consistency'
import { PROVIDERS } from '../mock/data/providers'
import { SCHEMA_DRIFT_EVENTS } from '../mock/data/schemaDrift'
import { QUEUES } from '../mock/data/queues'
import { DEAD_LETTER_JOBS } from '../mock/data/jobs'
import { DRIFT_METRICS } from '../mock/data/driftMetrics'
import { SECRET_ROTATIONS } from '../mock/data/security'

/** Computes sidebar notification-badge counts from mock operational state. */
export function useNavBadges(): Record<string, number> {
  return useMemo(() => {
    const propline = PROVIDERS.find((p) => p.id === 'propline')
    return {
      incidents: INCIDENTS.filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING').length,
      dataQuality: DATA_QUALITY_DOMAINS.filter((d) => d.status === 'STALE' || d.status === 'MISSING').length,
      consistency: CONSISTENCY_CHECKS.filter((c) => c.state === 'FAILED').length,
      propline: propline && propline.status !== 'healthy' ? 1 : 0,
      schemaDrift: SCHEMA_DRIFT_EVENTS.filter((e) => e.status === 'DETECTED' || e.status === 'QUARANTINED').length,
      queues: QUEUES.filter((q) => q.slaStatus === 'critical' || q.slaStatus === 'warning').length,
      dlq: DEAD_LETTER_JOBS.length,
      drift: DRIFT_METRICS.filter((d) => d.severity === 'WARNING' || d.severity === 'CRITICAL').length,
      secrets: SECRET_ROTATIONS.filter((s) => s.status === 'expired' || s.status === 'warning').length,
    }
  }, [])
}
