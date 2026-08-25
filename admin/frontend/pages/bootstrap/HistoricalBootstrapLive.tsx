import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, Play, RefreshCw } from 'lucide-react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import {
  fetchHistoricalBootstrapSnapshot,
  prepareHistoricalSeason,
  startHistoricalCampaign,
  type HistoricalBootstrapSnapshot,
  type HistoricalSeasonProgress,
} from '../../integrations/archiveLive'
import { fetchHistoricalBootstrapScope, type HistoricalBootstrapScope, type HistoricalBootstrapDatasetPlan } from '../../integrations/historicalBootstrapScope'

const MIN_SEASON = 2008
const MAX_SEASON = 2026
const seasonOptions = Array.from({ length: MAX_SEASON - MIN_SEASON + 1 }, (_, i) => MIN_SEASON + i)

function displaySeason(season: number) { return `${season}/${season + 1}` }

function dedupeSeasons(rows: HistoricalSeasonProgress[]) {
  const bySeason = new Map<number, HistoricalSeasonProgress>()
  for (const row of rows) {
    const season = Number(row.season)
    if (!Number.isInteger(season)) continue
    bySeason.set(season, { ...(bySeason.get(season) ?? {}), ...row, season })
  }
  return [...bySeason.values()].sort((a, b) => a.season - b.season)
}

function datasetStatus(dataset: HistoricalBootstrapDatasetPlan) {
  if (!dataset.execution_supported || dataset.available_count === 0) return 'UNAVAILABLE'
  if (dataset.available_count < dataset.scope_count) return 'PARTIAL'
  return 'AVAILABLE'
}

function fmtDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '—'
}

export default function HistoricalBootstrapLive() {
  const [selectedSeason, setSelectedSeason] = useState(2020)
  const [snapshot, setSnapshot] = useState<HistoricalBootstrapSnapshot | null>(null)
  const [scope, setScope] = useState<HistoricalBootstrapScope | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [preparing, setPreparing] = useState(false)

  async function load(season = selectedSeason) {
    setLoading(true)
    try {
      const [historical, resolvedScope] = await Promise.all([
        fetchHistoricalBootstrapSnapshot(),
        fetchHistoricalBootstrapScope(season),
      ])
      setSnapshot(historical)
      setScope(resolvedScope)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load historical bootstrap')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load(selectedSeason) }, [selectedSeason])

  const seasonRow = useMemo(() => dedupeSeasons(snapshot?.seasons ?? []).find((row) => row.season === selectedSeason) ?? null, [snapshot?.seasons, selectedSeason])
  const campaign = snapshot?.campaign && 'campaign_id' in snapshot.campaign ? snapshot.campaign : null
  const enabledCountries = scope?.countries ?? []
  const availableLeagues = scope?.competitions ?? []
  const datasetPlan = scope?.dataset_plan ?? []
  const coreDatasets = datasetPlan.filter((x) => x.category === 'CORE')
  const enrichmentDatasets = datasetPlan.filter((x) => x.category === 'ENRICHMENT')
  const marketDatasets = datasetPlan.filter((x) => x.category === 'MARKET')
  const quota = scope?.quota ?? {}
  const seasonGate = seasonRow?.gate_state ?? (availableLeagues.length ? 'READY' : 'BLOCKED')

  async function startBootstrap() {
    setStarting(true)
    try {
      await startHistoricalCampaign(selectedSeason, selectedSeason)
      const result = await prepareHistoricalSeason(selectedSeason, 100)
      toast.success(`Historical ${displaySeason(selectedSeason)} started`, { description: `${result.jobs_total} dataset jobs prepared from the enabled season scope.` })
      await load(selectedSeason)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start historical bootstrap')
    } finally { setStarting(false) }
  }

  async function prepareOnly() {
    setPreparing(true)
    try {
      const result = await prepareHistoricalSeason(selectedSeason, 100)
      toast.success(`Season ${displaySeason(selectedSeason)} prepared`, { description: `${result.jobs_total} dataset jobs in scope.` })
      await load(selectedSeason)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to prepare season')
    } finally { setPreparing(false) }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 pb-8">
      <PageHeader
        title="Historical Bootstrap"
        description="Prepare and execute one historical season against the enabled ingestion scope. Dataset availability is resolved for the selected season before jobs are created."
        tag={<StatusBadge status={loading ? 'LOADING' : seasonGate} />}
        actions={<Button variant="outline" onClick={() => void load(selectedSeason)} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />

      <section className="rounded-xl border border-border bg-card shadow-retool-sm">
        <div className="grid gap-0 lg:grid-cols-[240px,1fr]">
          <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Historical season</div>
            <select value={selectedSeason} onChange={(event) => setSelectedSeason(Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-ring">
              {seasonOptions.map((season) => <option key={season} value={season}>{displaySeason(season)}</option>)}
            </select>
            <div className="mt-2 text-xs text-muted-foreground">Canonical key <span className="font-mono font-medium text-foreground">{selectedSeason}</span></div>
          </div>
          <div className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2"><Database className="h-4 w-4" /><h2 className="text-sm font-semibold">Resolved scope</h2></div>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Enabled scope stays stable. Only provider availability for {displaySeason(selectedSeason)} decides which league entries enter this historical run.</p>
              </div>
              <StatusBadge status={seasonGate} dense />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <CompactMetric label="Enabled countries" value={String(scope?.enabled_country_count ?? 0)} />
              <CompactMetric label="Enabled leagues" value={String(scope?.enabled_league_count ?? 0)} />
              <CompactMetric label="Available this season" value={String(scope?.available_league_count ?? 0)} />
              <CompactMetric label="Campaign" value={campaign?.status ?? scope?.campaign?.status ?? 'Not started'} />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-retool-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Provider guardrails</h2>
              <p className="mt-1 text-xs text-muted-foreground">Quota is automatic and read-only here.</p>
            </div>
            <StatusBadge status="AUTO-QUOTA" dense />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
            <CompactMetric label="Daily budget" value={quota.daily_budget == null ? '—' : String(quota.daily_budget)} />
            <CompactMetric label="Quota used" value={quota.quota_used == null ? '—' : String(quota.quota_used)} />
            <CompactMetric label="Backfill remaining" value={quota.backfill_budget == null ? '—' : String(quota.backfill_budget)} />
            <CompactMetric label="Campaign requests" value={String(scope?.campaign?.requests_used ?? 0)} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-retool-sm">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <InfoMetric label="Planned start" value={fmtDate(scope?.campaign?.planned_start_at)} />
            <InfoMetric label="Target end" value={fmtDate(scope?.campaign?.minimum_target_end_at)} />
            <InfoMetric label="Reserve policy" value={quota.reserve_policy_version ?? '—'} />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-retool-sm">
        <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Dataset plan</h2>
            <p className="mt-1 text-xs text-muted-foreground">Compact operational view. Green means fully fetchable for the selected season scope.</p>
          </div>
          <div className="text-xs text-muted-foreground">{datasetPlan.length} datasets</div>
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          <DatasetGroup title="Historical core" datasets={coreDatasets} />
          <DatasetGroup title="Historical enrichment" datasets={enrichmentDatasets} />
          <DatasetGroup title="Market / optional" datasets={marketDatasets} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-retool-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Run {displaySeason(selectedSeason)}</h2><StatusBadge status={seasonGate} dense /></div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Only enabled Countries + enabled Leagues + season availability enter the campaign. Prepare jobs without starting the provider run, or start the historical bootstrap directly.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button onClick={() => void prepareOnly()} disabled={preparing || starting || loading || availableLeagues.length === 0} variant="outline"><Database className="h-4 w-4" /> {preparing ? 'Preparing…' : 'Prepare jobs'}</Button>
            <Button onClick={() => void startBootstrap()} disabled={starting || preparing || loading || availableLeagues.length === 0}><Play className="h-4 w-4" /> {starting ? 'Starting…' : 'Start Historical Bootstrap'}</Button>
          </div>
        </div>

        {availableLeagues.length === 0 ? (
          <Notice title="No enabled scope for this season" text="No enabled Country + League combination is available for this season in the provider catalog." />
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Season scope</span><span>{availableLeagues.length} leagues</span>
            </div>
            <div className="max-h-[300px] overflow-auto">
              {availableLeagues.map((league) => (
                <div key={league.id} className="grid grid-cols-[1fr,1.4fr,110px,80px] items-center gap-3 border-b px-3 py-2.5 text-xs last:border-0 hover:bg-muted/20">
                  <div className="truncate text-muted-foreground">{enabledCountries.find((country) => country.id === league.country_id)?.name ?? '—'}</div>
                  <div className="truncate font-medium">{league.name}</div>
                  <div className="text-muted-foreground">{displaySeason(selectedSeason)}</div>
                  <div><StatusBadge status="ENABLED" dense /></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-retool-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Season progress</h2>
            <p className="mt-1 text-xs text-muted-foreground">Completeness is seasonal; finishing one season does not force another season to run.</p>
          </div>
          <div className="text-xs font-medium text-muted-foreground">{seasonRow ? `${seasonRow.backfill_succeeded}/${seasonRow.backfill_jobs} jobs succeeded` : 'Not started'}</div>
        </div>
        <div className="mt-4"><ProgressBar value={Math.max(0, Math.min(100, Number(seasonRow?.backfill_progress ?? 0)))} /></div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CompactMetric label="Queued" value={String(seasonRow?.backfill_jobs ?? 0)} />
          <CompactMetric label="Succeeded" value={String(seasonRow?.backfill_succeeded ?? 0)} />
          <CompactMetric label="Failed" value={String(seasonRow?.backfill_failed ?? 0)} />
          <CompactMetric label="Archive completeness" value={seasonRow ? `${(Number(seasonRow.archive_completeness ?? 0) * 100).toFixed(1)}%` : '—'} />
        </div>
      </section>
    </div>
  )
}

function DatasetGroup({ title, datasets }: { title: string; datasets: HistoricalBootstrapDatasetPlan[] }) {
  if (!datasets.length) return null
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-xs font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{datasets.length}</span>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {datasets.map((dataset) => {
          const state = datasetStatus(dataset)
          const isGreen = state === 'AVAILABLE'
          return (
            <div key={dataset.dataset_key} className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${isGreen ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-card'}`}>
              <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${isGreen ? 'text-emerald-600' : 'text-muted-foreground'}`} />
              <div className="min-w-0 flex-1">
                <div className={`truncate text-xs font-medium ${isGreen ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground'}`}>{dataset.label}</div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{dataset.endpoint}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
                <span>{dataset.available_count}/{dataset.scope_count}</span>
                {state !== 'AVAILABLE' && <span className="rounded-full bg-muted px-1.5 py-0.5 font-medium">{state}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 truncate text-sm font-semibold">{value}</div></div>
}

function InfoMetric({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 truncate text-xs font-medium text-foreground">{value}</div></div>
}

function Notice({ title, text }: { title: string; text: string }) {
  return <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><div className="font-medium">{title}</div><div className="mt-1 text-muted-foreground">{text}</div></div></div>
}
