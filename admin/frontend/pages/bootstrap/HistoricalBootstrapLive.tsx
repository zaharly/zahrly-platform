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
import { fetchProviderCatalogLive, type LiveCompetition } from '../../integrations/providerCatalogLive'

const MIN_SEASON = 2008
const MAX_SEASON = 2026
const DATASETS = ['Standings', 'Fixtures', 'Fixture events', 'Lineups', 'Team statistics', 'Player statistics']
const seasonOptions = Array.from({ length: MAX_SEASON - MIN_SEASON + 1 }, (_, i) => MIN_SEASON + i)

function displaySeason(season: number) {
  return `${season}/${season + 1}`
}

function dedupeSeasons(rows: HistoricalSeasonProgress[]) {
  const bySeason = new Map<number, HistoricalSeasonProgress>()
  for (const row of rows) {
    const season = Number(row.season)
    if (!Number.isInteger(season)) continue
    bySeason.set(season, { ...(bySeason.get(season) ?? {}), ...row, season })
  }
  return [...bySeason.values()].sort((a, b) => a.season - b.season)
}

function enabledScope(live: { countries: Array<{ id: string; processing_state: string | null }>; competitions: LiveCompetition[] }, season: number) {
  const enabledCountries = new Set(live.countries.filter((c) => c.processing_state === 'ENABLED').map((c) => c.id))
  return live.competitions.filter((league) => {
    if (league.processing_state !== 'ENABLED' || !enabledCountries.has(league.country_id)) return false
    return league.seasons.some((s) => Number(s.season) === season)
  })
}

export default function HistoricalBootstrapLive() {
  const [selectedSeason, setSelectedSeason] = useState(2020)
  const [snapshot, setSnapshot] = useState<HistoricalBootstrapSnapshot | null>(null)
  const [live, setLive] = useState<{ countries: Array<{ id: string; name: string; processing_state: string | null }>; competitions: LiveCompetition[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [preparing, setPreparing] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [historical, provider] = await Promise.all([fetchHistoricalBootstrapSnapshot(), fetchProviderCatalogLive()])
      setSnapshot(historical)
      setLive({ countries: provider.countries.map((c) => ({ id: c.id, name: c.name, processing_state: c.processing_state })), competitions: provider.competitions })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load historical bootstrap')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const scope = useMemo(() => live ? enabledScope(live, selectedSeason) : [], [live, selectedSeason])
  const enabledCountries = useMemo(() => {
    if (!live) return []
    const ids = new Set(scope.map((x) => x.country_id))
    return live.countries.filter((c) => ids.has(c.id))
  }, [live, scope])
  const seasonRow = useMemo(() => dedupeSeasons(snapshot?.seasons ?? []).find((x) => x.season === selectedSeason) ?? null, [snapshot?.seasons, selectedSeason])
  const campaign = snapshot?.campaign && 'campaign_id' in snapshot.campaign ? snapshot.campaign : null

  async function startBootstrap() {
    setStarting(true)
    try {
      await startHistoricalCampaign(selectedSeason, selectedSeason)
      const result = await prepareHistoricalSeason(selectedSeason, 100)
      toast.success(`Historical ${displaySeason(selectedSeason)} started`, { description: `${result.jobs_total} jobs created from the enabled scope.` })
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start historical bootstrap')
    } finally {
      setStarting(false)
    }
  }

  async function prepareOnly() {
    setPreparing(true)
    try {
      const result = await prepareHistoricalSeason(selectedSeason, 100)
      toast.success(`Season ${displaySeason(selectedSeason)} prepared`, { description: `${result.jobs_total} backfill jobs in scope.` })
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to prepare season')
    } finally {
      setPreparing(false)
    }
  }

  return (
    <div className="flex flex-col gap-density-xl">
      <PageHeader title="Historical Bootstrap" description="Choose one season. Zahrly resolves the enabled Countries + Leagues from the provider catalog, builds the dataset plan, then creates historical jobs." tag={<StatusBadge status={loading ? 'LOADING' : seasonRow?.gate_state ?? 'READY'} />} actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="grid gap-density-lg lg:grid-cols-[280px,1fr]">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Season</label>
            <select value={selectedSeason} onChange={(e) => setSelectedSeason(Number(e.target.value))} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
              {seasonOptions.map((season) => <option key={season} value={season}>{displaySeason(season)}</option>)}
            </select>
            <div className="mt-3 text-xs text-muted-foreground">Canonical season key: <span className="font-mono font-semibold text-foreground">{selectedSeason}</span></div>
          </div>

          <div>
            <div className="flex items-center gap-2"><Database className="h-5 w-5" /><h2 className="text-base font-semibold">Scope resolution</h2></div>
            <p className="mt-1 text-sm text-muted-foreground">No Country or League is selected manually. The season is filtered against the synchronized catalog and the ingestion toggles.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Metric label="Enabled countries" value={String(enabledCountries.length)} />
              <Metric label="Enabled leagues" value={String(scope.length)} />
              <Metric label="Campaign" value={campaign?.status ?? 'Not started'} />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Dataset plan</h2><p className="mt-1 text-sm text-muted-foreground">The historical contract collects these datasets for the resolved season scope. Archive completeness is measured after a season run, not stored as a permanent League property.</p></div><StatusBadge status="PRE-S3" dense /></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{DATASETS.map((dataset) => <div key={dataset} className="rounded-md border border-border p-3 text-sm"><div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{dataset}</div></div>)}</div>
      </section>

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="flex flex-col gap-density-lg lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2"><h2 className="text-base font-semibold">Review {displaySeason(selectedSeason)}</h2><StatusBadge status={seasonRow?.gate_state ?? 'READY'} dense /></div>
            <p className="mt-1 text-sm text-muted-foreground">The final scope below is exactly what the campaign will process: Country enabled AND League enabled AND season available in the provider catalog.</p>
          </div>
          <div className="flex gap-2"><Button onClick={() => void prepareOnly()} disabled={preparing || starting || loading || scope.length === 0} variant="outline"><Database className="h-4 w-4" /> {preparing ? 'Preparing…' : 'Prepare jobs'}</Button><Button onClick={() => void startBootstrap()} disabled={starting || preparing || loading || scope.length === 0}><Play className="h-4 w-4" /> {starting ? 'Starting…' : 'Start Historical Bootstrap'}</Button></div>
        </div>

        {scope.length === 0 ? <Notice title="No enabled scope for this season" text="Enable at least one Country and one League on the Countries / Leagues pages before starting the campaign." /> : <div className="mt-5 max-h-[420px] overflow-auto rounded-md border border-border"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="px-3 py-2">Country</th><th className="px-3 py-2">League</th><th className="px-3 py-2">Provider season</th><th className="px-3 py-2">Ingestion</th></tr></thead><tbody>{scope.map((league) => <tr key={league.id} className="border-b last:border-0"><td className="px-3 py-3">{live?.countries.find((c) => c.id === league.country_id)?.name ?? '—'}</td><td className="px-3 py-3 font-medium">{league.name}</td><td className="px-3 py-3">{displaySeason(selectedSeason)}</td><td className="px-3 py-3"><StatusBadge status="ENABLED" dense /></td></tr>)}</tbody></table></div>}
      </section>

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">Season progress</h2><p className="mt-1 text-sm text-muted-foreground">Archive completeness is interpreted per season. A complete 2010 season does not imply that a disabled 2026 League should be processed.</p></div><div className="text-xs text-muted-foreground">{seasonRow ? `${seasonRow.backfill_succeeded}/${seasonRow.backfill_jobs} jobs succeeded` : 'Not started'}</div></div>
        <div className="mt-4"><ProgressBar value={Math.max(0, Math.min(100, Number(seasonRow?.backfill_progress ?? 0)))} /></div>
        <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-muted-foreground md:grid-cols-4"><Metric label="Queued" value={String(seasonRow?.backfill_jobs ?? 0)} /><Metric label="Succeeded" value={String(seasonRow?.backfill_succeeded ?? 0)} /><Metric label="Failed" value={String(seasonRow?.backfill_failed ?? 0)} /><Metric label="Archive completeness" value={seasonRow ? `${(Number(seasonRow.archive_completeness ?? 0) * 100).toFixed(1)}%` : '—'} /></div>
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) { return <div><div className="text-xs uppercase text-muted-foreground">{label}</div><div className="mt-1 font-semibold">{value}</div></div> }
function Notice({ title, text }: { title: string; text: string }) { return <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-density-md text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><div className="font-medium">{title}</div><div className="mt-1 text-muted-foreground">{text}</div></div></div> }
