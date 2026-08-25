import { FIXTURES } from '../mock/data/fixtures'
import { PREDICTIONS } from '../mock/data/predictions'
import { QUEUES } from '../mock/data/queues'
import { PROVIDERS } from '../mock/data/providers'
import { INCIDENTS } from '../mock/data/incidents'
import { LEAGUES } from '../mock/data/leagues'
import { round } from '../mock/factories/rng'

export function getEligibleFixtures() {
  const activeLeagueIds = new Set(LEAGUES.filter((l) => l.status === 'ENABLED').map((l) => l.id))
  return FIXTURES.filter((f) => activeLeagueIds.has(f.leagueId))
}

export function getPredictionCoverage() {
  const eligible = getEligibleFixtures()
  const withBaseline = eligible.filter((f) => f.baselineStatus === 'LOCKED')
  return {
    covered: withBaseline.length,
    total: eligible.length,
    pct: eligible.length > 0 ? round((withBaseline.length / eligible.length) * 100) : 0,
  }
}

export function getRollingForecast() {
  const now = Date.now()
  const horizon = now + 7 * 24 * 3600_000
  const due = getEligibleFixtures().filter((f) => {
    const t = new Date(f.kickoff).getTime()
    return t >= now && t <= horizon
  })
  const processed = due.filter((f) => f.predictionState === 'COMPLETED' || f.predictionState === 'PROCESSING')
  const overdue = due.filter((f) => f.predictionState === 'FAILED' || (f.predictionState === 'PENDING' && f.dataReadinessPct < 70))
  return {
    due: due.length,
    processed: processed.length,
    overdue: overdue.length,
    pct: due.length > 0 ? round((processed.length / due.length) * 100) : 100,
  }
}

export function getQueueHealthSummary() {
  const pending = QUEUES.reduce((sum, q) => sum + q.depth, 0)
  const retrying = QUEUES.reduce((sum, q) => sum + q.retrying, 0)
  const deadLetter = QUEUES.reduce((sum, q) => sum + q.deadLetter, 0)
  const worstSla = QUEUES.some((q) => q.slaStatus === 'critical')
    ? 'critical'
    : QUEUES.some((q) => q.slaStatus === 'warning')
      ? 'warning'
      : 'healthy'
  return { pending, retrying, deadLetter, worstSla: worstSla as 'critical' | 'warning' | 'healthy' }
}

export function getProviderHealthSummary() {
  const degraded = PROVIDERS.filter((p) => p.status !== 'healthy')
  return { providers: PROVIDERS, degradedCount: degraded.length }
}

export function getIncidentSummary() {
  const open = INCIDENTS.filter((i) => i.status !== 'RESOLVED' && i.status !== 'CLOSED')
  return {
    critical: open.filter((i) => i.severity === 'P0').length,
    high: open.filter((i) => i.severity === 'P1').length,
    warnings: open.filter((i) => i.severity === 'P2' || i.severity === 'P3').length,
    total: open.length,
  }
}

export function getSystemHealthPct() {
  const incidentSummary = getIncidentSummary()
  const queueSummary = getQueueHealthSummary()
  let score = 100
  score -= incidentSummary.critical * 6
  score -= incidentSummary.high * 2.5
  score -= incidentSummary.warnings * 0.8
  if (queueSummary.worstSla === 'critical') score -= 3
  else if (queueSummary.worstSla === 'warning') score -= 1.2
  return round(Math.max(85, Math.min(100, score)), 1)
}

export interface DayTimelineEntry {
  label: string
  date: string
  fixtures: number
  predicted: number
  oddsCoveragePct: number
  dataReadinessPct: number
  predictionReadinessPct: number
  warnings: number
}

export function get7DayTimeline(): DayTimelineEntry[] {
  const eligible = getEligibleFixtures()
  const days: DayTimelineEntry[] = []
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  for (let i = 0; i < 8; i++) {
    const dayStart = new Date(now.getTime() + i * 24 * 3600_000)
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000)
    const dayFixtures = eligible.filter((f) => {
      const t = new Date(f.kickoff).getTime()
      return t >= dayStart.getTime() && t < dayEnd.getTime()
    })
    const predicted = dayFixtures.filter((f) => f.predictionState === 'COMPLETED')
    const warnings = dayFixtures.filter((f) => f.hasIncident || f.predictionState === 'FAILED')
    const avg = (arr: number[]) => (arr.length > 0 ? round(arr.reduce((a, b) => a + b, 0) / arr.length) : 100)
    days.push({
      label: i === 0 ? 'Today' : `+${i}`,
      date: dayStart.toISOString(),
      fixtures: dayFixtures.length,
      predicted: predicted.length,
      oddsCoveragePct: avg(dayFixtures.map((f) => f.oddsReadinessPct)),
      dataReadinessPct: avg(dayFixtures.map((f) => f.dataReadinessPct)),
      predictionReadinessPct: dayFixtures.length > 0 ? round((predicted.length / dayFixtures.length) * 100) : 100,
      warnings: warnings.length,
    })
  }
  return days
}

export function getPredictionProductionSeries() {
  // Rolling 7-day count of predictions produced, used for the production chart.
  return get7DayTimeline().slice(0, 7).map((d) => ({ day: d.label, predicted: d.predicted, fixtures: d.fixtures }))
}

export { PREDICTIONS }
