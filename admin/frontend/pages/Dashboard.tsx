import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, HeartPulse, History, ListOrdered, Server, Boxes, Siren, Radar, ArrowRight,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line,
} from 'recharts'
import { PageHeader } from '../components/layout/PageHeader'
import { MetricCard } from '../components/dashboard/MetricCard'
import { AlertFeed } from '../components/dashboard/AlertFeed'
import { StatusBadge } from '../components/status/StatusBadge'
import { HealthIndicator } from '../components/status/HealthIndicator'
import { ProgressBar } from '../components/status/ProgressBar'
import {
  getSystemHealthPct, getPredictionCoverage, getRollingForecast, getQueueHealthSummary,
  getProviderHealthSummary, getIncidentSummary, get7DayTimeline, getPredictionProductionSeries,
} from '../utils/metrics'
import { QUEUES } from '../mock/data/queues'
import { PROVIDERS } from '../mock/data/providers'
import { ACTIVE_MODEL } from '../mock/data/models'
import { ALERTS } from '../mock/data/alerts'
import { fetchHistoricalBootstrapSnapshot, type HistoricalBootstrapSnapshot, type HistoricalSeasonProgress } from '../integrations/archiveLive'

function numberValue(value?: number | null) { return value == null ? '—' : value.toLocaleString() }
function progressValue(row?: HistoricalSeasonProgress | null) {
  if (!row || row.backfill_jobs <= 0) return 0
  return Math.max(0, Math.min(100, ((row.backfill_succeeded + row.backfill_failed) / row.backfill_jobs) * 100))
}
function seasonStatus(row: HistoricalSeasonProgress) {
  if (row.gate_state) return row.gate_state
  if (row.backfill_failed > 0 && row.backfill_active === 0 && row.backfill_succeeded + row.backfill_failed >= row.backfill_jobs) return 'COMPLETED_WITH_FAILURES'
  if (row.backfill_active > 0) return 'RUNNING'
  if (row.backfill_succeeded > 0 && row.backfill_succeeded >= row.backfill_jobs) return 'READY'
  if (row.backfill_jobs > 0) return 'QUEUED'
  return 'DRAFT'
}

export default function Dashboard() {
  const systemHealthPct = getSystemHealthPct()
  const coverage = getPredictionCoverage()
  const rolling = getRollingForecast()
  const queueHealth = getQueueHealthSummary()
  const providerHealth = getProviderHealthSummary()
  const incidents = getIncidentSummary()
  const timeline = get7DayTimeline()
  const productionSeries = getPredictionProductionSeries()
  const quotaLength = Math.max(...PROVIDERS.map((p) => p.quotaHistory.length), 0)
  const quotaChartData = Array.from({ length: quotaLength }, (_, i) => {
    const point: Record<string, number> = { tick: i }
    for (const p of PROVIDERS) point[p.id] = p.quotaHistory[i] ?? 0
    return point
  })

  const [historical, setHistorical] = useState<HistoricalBootstrapSnapshot | null>(null)
  const [historicalError, setHistoricalError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const snapshot = await fetchHistoricalBootstrapSnapshot()
        if (!cancelled) {
          setHistorical(snapshot)
          setHistoricalError(null)
        }
      } catch (error) {
        if (!cancelled) setHistoricalError(error instanceof Error ? error.message : 'Unable to load historical bootstrap status')
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])

  const liveSeasons = useMemo(() => {
    const map = new Map<number, HistoricalSeasonProgress>()
    for (const row of historical?.seasons ?? []) map.set(Number(row.season), row)
    return [...map.values()].sort((a, b) => b.season - a.season).slice(0, 7)
  }, [historical?.seasons])

  const campaign = historical?.campaign ?? {}
  const liveCampaignStatus = String(campaign.status ?? 'UNKNOWN').toUpperCase()
  const campaignSeason = liveSeasons[0]?.season ?? campaign.target_start_season ?? null
  const campaignProgress = campaignSeason != null ? progressValue(liveSeasons.find((s) => s.season === campaignSeason)) : 0
  const validationOk = Boolean(campaign.last_successful_watermark && (campaign.last_successful_watermark as Record<string, unknown>).validation_ok === true)
  const systemStatus = systemHealthPct >= 98 ? 'healthy' : systemHealthPct >= 92 ? 'warning' : 'critical'

  return (
    <div className="flex flex-col gap-density-xl">
      <PageHeader
        title="Command Center"
        description="Is Zahrly healthy right now? Production health, prediction reliability, and everything that requires action — in one view."
      />

      <div className="grid grid-cols-2 gap-density-md md:grid-cols-4 xl:grid-cols-4">
        <MetricCard label="System Health" value={`${systemHealthPct}%`} icon={HeartPulse} tone={systemStatus === 'healthy' ? 'success' : systemStatus === 'warning' ? 'warning' : 'critical'} sublabel={<StatusBadge status={systemStatus} dense />} />
        <MetricCard label="Prediction Coverage" value={`${coverage.covered} / ${coverage.total}`} icon={Activity} tone={coverage.pct >= 95 ? 'success' : 'warning'} sublabel={`${coverage.pct}% of eligible fixtures have an immutable baseline`} />
        <MetricCard label="7-Day Rolling" value={`${rolling.pct}%`} icon={Radar} tone={rolling.pct >= 90 ? 'success' : rolling.pct >= 75 ? 'warning' : 'critical'} sublabel={`${rolling.processed}/${rolling.due} due-fixture workload processed`} />
        <MetricCard
          label="Historical Bootstrap"
          value={campaignSeason == null ? '—' : `${campaignSeason}/${campaignSeason + 1}`}
          icon={History}
          tone={liveCampaignStatus === 'RUNNING' ? 'info' : validationOk ? 'success' : 'warning'}
          sublabel={historicalError ? historicalError : `${campaignProgress.toFixed(1)}% · ${numberValue(campaign.requests_used)} requests · ${liveCampaignStatus}`}
        />
        <MetricCard label="Queue Health" value={`${queueHealth.pending} pending`} icon={ListOrdered} tone={queueHealth.worstSla === 'critical' ? 'critical' : queueHealth.worstSla === 'warning' ? 'warning' : 'success'} sublabel={`${queueHealth.retrying} retrying · ${queueHealth.deadLetter} dead-letter`} />
        <MetricCard label="Active Model" value={ACTIVE_MODEL.version} icon={Boxes} tone="model" sublabel={<StatusBadge status={ACTIVE_MODEL.status} dense />} />
        <MetricCard label="Incidents" value={`${incidents.warnings} warnings`} icon={Siren} tone={incidents.critical > 0 ? 'critical' : incidents.warnings > 0 ? 'warning' : 'success'} sublabel={`${incidents.critical} critical · ${incidents.high} high`} />
        <div className="flex flex-col gap-density-sm rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider Health</span><Server className="h-4 w-4 text-muted-foreground" /></div>
          <div className="flex flex-col gap-1.5">{providerHealth.providers.map((p) => <div key={p.id} className="flex items-center justify-between text-sm"><span className="text-foreground">{p.name}</span><HealthIndicator status={p.status} label={p.status} size="sm" /></div>)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-density-lg xl:grid-cols-3">
        <div className="flex flex-col gap-density-md rounded-lg border border-border bg-card p-density-lg shadow-retool-sm xl:col-span-2">
          <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-foreground">7-Day Production Timeline</h2><p className="text-sm text-muted-foreground">Protected rolling production path — separate from historical bootstrap.</p></div><Link to="/predictions" className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline">Prediction Monitor <ArrowRight className="h-3.5 w-3.5" /></Link></div>
          <div className="grid grid-cols-4 gap-density-sm sm:grid-cols-8">{timeline.map((day) => <div key={day.date} className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/30 p-density-sm"><span className="text-xs font-semibold text-foreground">{day.label}</span><span className="text-lg font-semibold text-foreground">{day.fixtures}</span><span className="text-[11px] text-muted-foreground">fixtures</span><ProgressBar value={day.predictionReadinessPct} showValue={false} size="sm" tone={day.predictionReadinessPct >= 90 ? 'success' : day.predictionReadinessPct >= 70 ? 'warning' : 'critical'} /><span className="text-[11px] text-muted-foreground">{day.predicted}/{day.fixtures} predicted</span>{day.warnings > 0 && <span className="inline-flex w-fit items-center rounded-full zc-chip-warning px-1.5 py-0.5 text-[10px] font-medium">{day.warnings} warning{day.warnings === 1 ? '' : 's'}</span>}</div>)}</div>
          <div className="h-56 pt-density-sm"><ResponsiveContainer width="100%" height="100%"><LineChart data={productionSeries}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" /><YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" /><Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 12 }} /><Line type="monotone" dataKey="fixtures" name="Due fixtures" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="predicted" name="Predictions completed" stroke="hsl(var(--success))" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
        </div>
        <div className="flex flex-col gap-density-md rounded-lg border border-border bg-card p-density-lg shadow-retool-sm"><div className="flex items-center justify-between"><h2 className="text-base font-semibold text-foreground">Live Operational Alerts</h2><Link to="/incidents" className="text-sm font-medium text-foreground hover:underline">View all</Link></div><AlertFeed alerts={ALERTS} limit={8} /></div>
      </div>

      <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="mb-density-md flex items-center justify-between">
          <div><h2 className="text-base font-semibold text-foreground">Historical Bootstrap Progress</h2><p className="text-sm text-muted-foreground">Live campaign telemetry — refreshed every 30 seconds.</p></div>
          <div className="flex items-center gap-3"><StatusBadge status={liveCampaignStatus} dense /><Link to="/bootstrap" className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline">Open Bootstrap Control Center <ArrowRight className="h-3.5 w-3.5" /></Link></div>
        </div>
        {liveSeasons.length === 0 ? <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">{historicalError ?? 'Loading live historical bootstrap telemetry…'}</div> : <div className="grid grid-cols-2 gap-density-md sm:grid-cols-4 lg:grid-cols-7">{liveSeasons.map((season) => { const progress = progressValue(season); return <div key={season.season} className="flex flex-col gap-2 rounded-md border border-border p-density-sm"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-foreground">{season.season}/{season.season + 1}</span><StatusBadge status={seasonStatus(season)} dense /></div><ProgressBar value={progress} showValue={false} size="sm" tone={progress >= 95 ? 'success' : progress >= 50 ? 'warning' : 'critical'} /><span className="text-xs text-muted-foreground">{progress.toFixed(1)}% · {numberValue(season.backfill_succeeded)} succeeded / {numberValue(season.backfill_jobs)} jobs</span><span className="text-[11px] text-muted-foreground">Archive {((season.archive_completeness ?? 0) * 100).toFixed(1)}%</span></div> })}</div>}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Campaign requests" value={numberValue(campaign.requests_used)} />
          <Metric label="Quota used" value={numberValue((historical?.quota as Record<string, unknown> | undefined)?.quota_used as number | undefined)} />
          <Metric label="Backfill remaining" value={numberValue((historical?.quota as Record<string, unknown> | undefined)?.backfill_budget as number | undefined)} />
          <Metric label="Validation" value={validationOk ? 'PASSED' : 'NOT PASSED'} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-density-lg lg:grid-cols-2"><div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm"><h2 className="mb-density-sm text-base font-semibold text-foreground">Queue Pressure</h2><div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={QUEUES} layout="vertical" margin={{ left: 24 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} /><XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" /><YAxis dataKey="label" type="category" width={90} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" /><Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="depth" name="Depth" fill="hsl(var(--chart-2))" radius={[0, 3, 3, 0]} /><Bar dataKey="retrying" name="Retrying" fill="hsl(var(--warning))" radius={[0, 3, 3, 0]} /><Bar dataKey="deadLetter" name="Dead-letter" fill="hsl(var(--destructive))" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div></div><div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm"><h2 className="mb-density-sm text-base font-semibold text-foreground">Provider Quota Burn-down</h2><div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={quotaChartData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="tick" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'days ago → now', position: 'insideBottom', offset: -2, fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" unit="%" /><Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 12 }} />{PROVIDERS.map((p, i) => <Line key={p.id} type="monotone" dataKey={p.id} name={p.name} stroke={`hsl(var(--chart-${(i % 5) + 1}))`} strokeWidth={2} dot={false} />)}</LineChart></ResponsiveContainer></div></div></div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) { return <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-sm font-semibold text-foreground">{value}</div></div> }
