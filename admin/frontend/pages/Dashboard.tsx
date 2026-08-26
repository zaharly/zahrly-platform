import { useEffect, useMemo, useState } from 'react'
import { History, HeartPulse, ListOrdered, Server, Activity, AlertTriangle, Boxes } from 'lucide-react'
import { PageHeader } from '../components/layout/PageHeader'
import { MetricCard } from '../components/dashboard/MetricCard'
import { StatusBadge } from '../components/status/StatusBadge'
import { HealthIndicator } from '../components/status/HealthIndicator'
import { ProgressBar } from '../components/status/ProgressBar'
import { fetchCommandCenterSnapshot, type CommandCenterSnapshot } from '../lib/adminLive'

export default function Dashboard() {
  const [snapshot, setSnapshot] = useState<CommandCenterSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchCommandCenterSnapshot()
      .then((data) => active && setSnapshot(data))
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Unable to load command center'))
    return () => { active = false }
  }, [])

  const queueSummary = useMemo(() => {
    const rows = snapshot?.queues ?? []
    return rows.reduce((acc, row) => ({
      queued: acc.queued + row.queued,
      running: acc.running + row.running,
      retrying: acc.retrying + row.retrying,
      deadLetter: acc.deadLetter + row.dead_letter,
    }), { queued: 0, running: 0, retrying: 0, deadLetter: 0 })
  }, [snapshot])

  if (error) {
    return (
      <div className="space-y-density-lg">
        <PageHeader title="Command Center" description="Live operational state from the administrative backend." />
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-density-lg text-sm text-destructive">{error}</div>
      </div>
    )
  }

  if (!snapshot) {
    return <div className="space-y-density-lg"><PageHeader title="Command Center" description="Loading live operational state…" /><div className="h-32 animate-pulse rounded-lg border border-border bg-muted/30" /></div>
  }

  const providerHealthy = snapshot.providers.length > 0 && snapshot.providers.every((p) => p.status === 'healthy')
  const deadLetters = snapshot.incidents.dead_letter_jobs
  const providerFailures = snapshot.incidents.provider_failures_24h
  const posture = providerHealthy && deadLetters === 0 && providerFailures === 0 ? 'healthy' : 'warning'
  const campaign = snapshot.bootstrap?.campaign ?? {}
  const seasons = snapshot.bootstrap?.seasons ?? []
  const completeness = Number(campaign.completeness_score ?? 0) * 100
  const modelVersion = snapshot.active_model.version ?? 'Not initialized'

  return (
    <div className="flex flex-col gap-density-xl">
      <PageHeader title="Command Center" description="Live operational state. Supabase is authoritative; this view contains no mock telemetry." />

      <div className="grid grid-cols-2 gap-density-md lg:grid-cols-4">
        <MetricCard label="Operational Posture" value={posture} icon={HeartPulse} tone={posture === 'healthy' ? 'success' : 'warning'} sublabel={<StatusBadge status={posture} dense />} />
        <MetricCard label="7-Day Prediction Coverage" value={`${snapshot.production.with_baseline} / ${snapshot.production.due_fixtures}`} icon={Activity} tone={snapshot.production.coverage_pct >= 95 ? 'success' : 'warning'} sublabel={`${snapshot.production.coverage_pct}% from canonical prediction baselines`} />
        <MetricCard label="Queue Workload" value={`${queueSummary.queued} queued`} icon={ListOrdered} tone={queueSummary.deadLetter > 0 ? 'critical' : queueSummary.retrying > 0 ? 'warning' : 'success'} sublabel={`${queueSummary.running} running · ${queueSummary.retrying} retrying · ${queueSummary.deadLetter} DLQ`} />
        <MetricCard label="Active Model" value={modelVersion} icon={Boxes} tone="model" sublabel={snapshot.active_model.family ?? 'Prediction backend'} />
      </div>

      <div className="grid grid-cols-1 gap-density-lg xl:grid-cols-3">
        <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm xl:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Provider Health</h2>
              <p className="text-sm text-muted-foreground">Latest quota snapshot and provider request telemetry.</p>
            </div>
            <Server className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-density-lg grid gap-density-md md:grid-cols-2">
            {snapshot.providers.map((provider) => (
              <div key={provider.provider} className="rounded-md border border-border p-density-md">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{provider.provider}</span>
                  <HealthIndicator status={provider.status} label={provider.status} size="sm" />
                </div>
                <div className="mt-density-md">
                  <ProgressBar label="Quota used" value={provider.quota_used} max={provider.daily_budget ?? 0} showValue={false} tone={provider.quota_pct !== null && provider.quota_pct >= 90 ? 'critical' : 'info'} />
                  <div className="mt-1 text-xs text-muted-foreground">{provider.quota_used.toLocaleString()} / {(provider.daily_budget ?? 0).toLocaleString()} requests</div>
                </div>
                <div className="mt-density-md grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>24h requests: {provider.requests_24h}</span>
                  <span>24h failures: {provider.failed_24h}</span>
                  <span>Rate used: {provider.rate_used}</span>
                  <span>Last status: {provider.last_provider_status ?? '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Immediate Attention</h2>
          </div>
          <div className="mt-density-lg space-y-density-sm text-sm">
            <div className="flex items-center justify-between rounded-md border border-border p-density-sm"><span>Dead-letter jobs</span><strong>{deadLetters}</strong></div>
            <div className="flex items-center justify-between rounded-md border border-border p-density-sm"><span>Provider failures (24h)</span><strong>{providerFailures}</strong></div>
            <div className="flex items-center justify-between rounded-md border border-border p-density-sm"><span>Captured at</span><span className="text-xs text-muted-foreground">{new Date(snapshot.captured_at).toLocaleString()}</span></div>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="flex items-center gap-2"><History className="h-4 w-4 text-muted-foreground" /><h2 className="text-base font-semibold">Historical Bootstrap</h2></div>
        <p className="mt-1 text-sm text-muted-foreground">Read-only operational snapshot; the Bootstrap page remains the control surface.</p>
        <div className="mt-density-lg grid gap-density-md md:grid-cols-4">
          <MetricCard label="Campaign completeness" value={`${completeness.toFixed(2)}%`} icon={History} tone="info" />
          <MetricCard label="Status" value={String(campaign.status ?? '—')} icon={History} />
          <MetricCard label="Requests used" value={Number(campaign.requests_used ?? 0).toLocaleString()} icon={ListOrdered} />
          <MetricCard label="Target window" value={`${campaign.target_start_season ?? '—'} → ${campaign.target_end_season ?? '—'}`} icon={History} />
        </div>
        {seasons.length > 0 && (
          <div className="mt-density-lg grid grid-cols-2 gap-density-sm sm:grid-cols-4 lg:grid-cols-7">
            {seasons.map((season) => (
              <div key={season.season} className="rounded-md border border-border p-density-sm">
                <div className="text-sm font-semibold">{season.season}</div>
                <div className="mt-2 text-xs text-muted-foreground">{Number(season.backfill_progress ?? 0).toFixed(0)}% backfill</div>
                <ProgressBar value={Number(season.backfill_progress ?? 0)} size="sm" showValue={false} tone={Number(season.backfill_progress ?? 0) >= 95 ? 'success' : 'warning'} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
