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
    } finally {
      setLoading(false)
    }
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
    <div className="flex flex-col gap-density-xl">
      <PageHeader
        title="Historical Bootstrap"
        description="Choose one season. Zahrly keeps the enabled catalog scope stable, filters availability for that season, builds the complete historical dataset plan, then creates dataset jobs."
        tag={<StatusBadge status={loading ? 'LOADING' : seasonRow?.gate_state ?? (availableLeagues.length ? 'READY' : 'BLOCKED')} />}
        actions={<Button variant="outline" onClick={() => void load(selectedSeason)} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="grid gap-density-lg lg:grid-cols-[280px,1fr]">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Season</label>
            <select value={selectedSeason} onChange={(event) => setSelectedSeason(Number(event.target.value))} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
              {seasonOptions.map((season) => <option key={season} value={season}>{displaySeason(season)}</option>)}
            </select>
            <div className="mt-3 text-xs text-muted-foreground">Canonical season key: <span className="font-mono font-semibold text-foreground">{selectedSeason}</span></div>
          </div>
          <div>
            <div className="flex items-center gap-2"><Database className="h-5 w-5" /><h2 className="text-base font-semibold">Scope resolution</h2></div>
            <p className="mt-1 text-sm text-muted-foreground">Enabled is a permanent ingestion decision. Season availability is evaluated separately and only affects whether that league enters this campaign.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <Metric label="Enabled countries" value={String(scope?.enabled_country_count ?? 0)} />
              <Metric label="Enabled leagues" value={String(scope?.enabled_league_count ?? 0)} />
              <Metric label="Available this season" value={String(scope?.available_league_count ?? 0)} />
              <Metric label="Campaign" value={campaign?.status ?? 'Not started'} />
            </div>
          </div>
        </div>
      </section>

      <DatasetSection title="Historical core" datasets={coreDatasets} />
      <DatasetSection title="Historical enrichment" datasets={enrichmentDatasets} />
      <DatasetSection title="Market / optional historical enrichment" datasets={marketDatasets} />

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="flex flex-col gap-density-lg lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2"><h2 className="text-base font-semibold">Review {displaySeason(selectedSeason)}</h2><StatusBadge status={seasonRow?.gate_state ?? (availableLeagues.length ? 'READY' : 'BLOCKED')} dense /></div>
            <p className="mt-1 text-sm text-muted-foreground">Only enabled Countries + enabled Leagues + season availability enter the campaign. The enabled-league count itself does not change with season.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void prepareOnly()} disabled={preparing || starting || loading || availableLeagues.length === 0} variant="outline"><Database className="h-4 w-4" /> {preparing ? 'Preparing…' : 'Prepare jobs'}</Button>
            <Button onClick={() => void startBootstrap()} disabled={starting || preparing || loading || availableLeagues.length === 0}><Play className="h-4 w-4" /> {starting ? 'Starting…' : 'Start Historical Bootstrap'}</Button>
          </div>
        </div>

        {availableLeagues.length === 0 ? (
          <Notice title="No enabled scope for this season" text="No enabled Country + League combination is available for this season in the provider catalog." />
        ) : (
          <div className="mt-5 max-h-[420px] overflow-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="px-3 py-2">Country</th><th className="px-3 py-2">League</th><th className="px-3 py-2">Provider season</th><th className="px-3 py-2">Ingestion</th></tr></thead>
              <tbody>{availableLeagues.map((league) => <tr key={league.id} className="border-b last:border-0"><td className="px-3 py-3">{enabledCountries.find((country) => country.id === league.country_id)?.name ?? '—'}</td><td className="px-3 py-3 font-medium">{league.name}</td><td className="px-3 py-3">{displaySeason(selectedSeason)}</td><td className="px-3 py-3"><StatusBadge status="ENABLED" dense /></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">Season progress</h2><p className="mt-1 text-sm text-muted-foreground">Completeness is seasonal. A complete historical season does not force another season to be processed.</p></div><div className="text-xs text-muted-foreground">{seasonRow ? `${seasonRow.backfill_succeeded}/${seasonRow.backfill_jobs} jobs succeeded` : 'Not started'}</div></div>
        <div className="mt-4"><ProgressBar value={Math.max(0, Math.min(100, Number(seasonRow?.backfill_progress ?? 0)))} /></div>
        <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-muted-foreground md:grid-cols-4"><Metric label="Queued" value={String(seasonRow?.backfill_jobs ?? 0)} /><Metric label="Succeeded" value={String(seasonRow?.backfill_succeeded ?? 0)} /><Metric label="Failed" value={String(seasonRow?.backfill_failed ?? 0)} /><Metric label="Archive completeness" value={seasonRow ? `${(Number(seasonRow.archive_completeness ?? 0) * 100).toFixed(1)}%` : '—'} /></div>
      </section>
    </div>
  )
}

function DatasetSection({ title, datasets }: { title: string; datasets: HistoricalBootstrapDatasetPlan[] }) {
  if (!datasets.length) return null
  return <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
    <div><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">Green means the dataset is fetchable for the selected season scope. Partial means only some enabled leagues expose the provider capability.</p></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {datasets.map((dataset) => {
        const state = datasetStatus(dataset)
        const isGreen = state === 'AVAILABLE'
        return <div key={dataset.dataset_key} className={`rounded-md border p-3 text-sm ${isGreen ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-card'}`}>
          <div className="flex items-center gap-2"><CheckCircle2 className={`h-4 w-4 ${isGreen ? 'text-emerald-600' : 'text-muted-foreground'}`} /><span className={isGreen ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'font-medium'}>{dataset.label}</span></div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span>{dataset.endpoint}</span><span>{dataset.available_count}/{dataset.scope_count}</span></div>
        </div>
      })}
    </div>
  </section>
}

function Metric({ label, value }: { label: string; value: string }) { return <div><div className="text-xs uppercase text-muted-foreground">{label}</div><div className="mt-1 font-semibold">{value}</div></div> }
function Notice({ title, text }: { title: string; text: string }) { return <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-density-md text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><div className="font-medium">{title}</div><div className="mt-1 text-muted-foreground">{text}</div></div></div> }
