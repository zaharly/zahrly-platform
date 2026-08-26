import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, ChevronDown, Database, Plus, Play, RefreshCw } from 'lucide-react'
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
import {
  fetchHistoricalBootstrapScope,
  type HistoricalBootstrapScope,
  type HistoricalBootstrapDatasetPlan,
} from '../../integrations/historicalBootstrapScope'

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
  return [...bySeason.values()].sort((a, b) => b.season - a.season)
}

function datasetStatus(dataset: HistoricalBootstrapDatasetPlan) {
  if (!dataset.execution_supported || dataset.available_count === 0) return 'UNAVAILABLE'
  if (dataset.available_count < dataset.scope_count) return 'PARTIAL'
  return 'AVAILABLE'
}

function fmtDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '—'
}

function seasonStatus(row: HistoricalSeasonProgress) {
  if (row.gate_state) return row.gate_state
  if (row.backfill_failed > 0) return 'FAILED'
  if (row.backfill_active > 0) return 'RUNNING'
  if (row.backfill_succeeded > 0 && row.backfill_succeeded >= row.backfill_jobs) return 'READY'
  if (row.backfill_jobs > 0) return 'QUEUED'
  return 'DRAFT'
}

export default function HistoricalBootstrapLive() {
  const [snapshot, setSnapshot] = useState<HistoricalBootstrapSnapshot | null>(null)
  const [selectedSeason, setSelectedSeason] = useState(2020)
  const [detailSeason, setDetailSeason] = useState<number | null>(null)
  const [scope, setScope] = useState<HistoricalBootstrapScope | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [datasetOpen, setDatasetOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const seasons = useMemo(() => {
    const rows = dedupeSeasons(snapshot?.seasons ?? [])
    return rows.filter((row) => row.backfill_jobs > 0 || row.archive_campaigns > 0 || row.backfill_active > 0 || row.backfill_succeeded > 0 || row.backfill_failed > 0)
  }, [snapshot?.seasons])

  const detailRow = useMemo(
    () => seasons.find((row) => row.season === detailSeason) ?? null,
    [seasons, detailSeason],
  )

  async function loadSnapshot() {
    setLoading(true)
    try {
      const historical = await fetchHistoricalBootstrapSnapshot()
      setSnapshot(historical)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load historical campaigns')
    } finally {
      setLoading(false)
    }
  }

  async function openCampaign(season: number) {
    setDetailSeason(season)
    setDatasetOpen(false)
    setDetailLoading(true)
    try {
      const resolvedScope = await fetchHistoricalBootstrapScope(season)
      setScope(resolvedScope)
    } catch (error) {
      setScope(null)
      toast.error(error instanceof Error ? error.message : 'Unable to load campaign details')
    } finally {
      setDetailLoading(false)
    }
  }

  function closeCampaign() {
    setDetailSeason(null)
    setScope(null)
    setDatasetOpen(false)
  }

  useEffect(() => { void loadSnapshot() }, [])

  async function createCampaign() {
    setCreating(true)
    try {
      await startHistoricalCampaign(selectedSeason, selectedSeason)
      toast.success(`Campaign ${displaySeason(selectedSeason)} created`, {
        description: 'The campaign is ready for preparation. No dataset jobs were started.',
      })
      setCreateOpen(false)
      await loadSnapshot()
      await openCampaign(selectedSeason)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create campaign')
    } finally {
      setCreating(false)
    }
  }

  async function prepareOnly() {
    if (detailSeason == null) return
    setPreparing(true)
    try {
      const result = await prepareHistoricalSeason(detailSeason, 100)
      toast.success(`Season ${displaySeason(detailSeason)} prepared`, {
        description: `${result.jobs_total} dataset jobs in scope.`,
      })
      await loadSnapshot()
      await openCampaign(detailSeason)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to prepare season')
    } finally {
      setPreparing(false)
    }
  }

  async function startBootstrap() {
    if (detailSeason == null) return
    setStarting(true)
    try {
      const result = await prepareHistoricalSeason(detailSeason, 100)
      toast.success(`Historical ${displaySeason(detailSeason)} started`, {
        description: `${result.jobs_total} dataset jobs prepared from the enabled season scope.`,
      })
      await loadSnapshot()
      await openCampaign(detailSeason)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start historical bootstrap')
    } finally {
      setStarting(false)
    }
  }

  if (detailSeason != null) {
    return (
      <CampaignDetail
        season={detailSeason}
        row={detailRow}
        scope={scope}
        loading={detailLoading}
        preparing={preparing}
        starting={starting}
        datasetOpen={datasetOpen}
        onToggleDataset={() => setDatasetOpen((value) => !value)}
        onBack={closeCampaign}
        onRefresh={() => void openCampaign(detailSeason)}
        onPrepare={() => void prepareOnly()}
        onStart={() => void startBootstrap()}
      />
    )
  }

  return (
    <>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 pb-8">
        <PageHeader
          title="Historical Bootstrap"
          description="Manage historical data campaigns and their execution. Dataset details stay inside each campaign."
          tag={<StatusBadge status={loading ? 'LOADING' : `${seasons.length} CAMPAIGNS`} />}
          actions={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Create Campaign</Button>}
        />

        <section className="rounded-xl border border-border bg-card shadow-retool-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Campaigns</h2>
              <p className="mt-1 text-xs text-muted-foreground">Only campaign-level information is shown here.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadSnapshot()} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading campaigns…</div>
          ) : seasons.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-sm font-semibold">No campaigns yet</div>
              <p className="mt-1 text-xs text-muted-foreground">Create a historical campaign to begin preparing a season.</p>
              <Button className="mt-4" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Create Campaign</Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {seasons.map((row) => <CampaignListRow key={row.season} row={row} onOpen={() => void openCampaign(row.season)} />)}
            </div>
          )}
        </section>
      </div>

      {createOpen && (
        <CreateCampaignDialog
          selectedSeason={selectedSeason}
          onSeasonChange={setSelectedSeason}
          creating={creating}
          onClose={() => setCreateOpen(false)}
          onCreate={() => void createCampaign()}
        />
      )}
    </>
  )
}

function CampaignListRow({ row, onOpen }: { row: HistoricalSeasonProgress; onOpen: () => void }) {
  const status = seasonStatus(row)
  const progress = Math.max(0, Math.min(100, Number(row.backfill_progress ?? 0)))
  return (
    <button type="button" onClick={onOpen} className="flex w-full flex-col gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/25 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Run {displaySeason(row.season)}</h3>
          <StatusBadge status={status} dense />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Historical Bootstrap campaign</p>
      </div>
      <div className="grid grid-cols-3 gap-6 text-xs sm:grid-cols-4 lg:min-w-[430px] lg:grid-cols-4">
        <CompactMetric label="Season" value={displaySeason(row.season)} />
        <CompactMetric label="Provider leagues" value={String(row.provider_leagues ?? 0)} />
        <CompactMetric label="Jobs" value={String(row.backfill_jobs ?? 0)} />
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Progress</div>
          <div className="mt-1 flex items-center gap-2"><div className="w-16"><ProgressBar value={progress} /></div><span className="text-xs font-semibold">{progress.toFixed(0)}%</span></div>
        </div>
      </div>
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">View campaign →</span>
    </button>
  )
}

function CampaignDetail({
  season,
  row,
  scope,
  loading,
  preparing,
  starting,
  datasetOpen,
  onToggleDataset,
  onBack,
  onRefresh,
  onPrepare,
  onStart,
}: {
  season: number
  row: HistoricalSeasonProgress | null
  scope: HistoricalBootstrapScope | null
  loading: boolean
  preparing: boolean
  starting: boolean
  datasetOpen: boolean
  onToggleDataset: () => void
  onBack: () => void
  onRefresh: () => void
  onPrepare: () => void
  onStart: () => void
}) {
  const campaign = scope?.campaign ?? {}
  const datasetPlan = scope?.dataset_plan ?? []
  const status = row ? seasonStatus(row) : (scope?.available_league_count ? 'READY' : 'BLOCKED')
  const progress = Math.max(0, Math.min(100, Number(row?.backfill_progress ?? 0)))
  const isActionable = Boolean(scope?.available_league_count)

  const datasetByCategory = {
    CORE: datasetPlan.filter((x) => x.category === 'CORE'),
    ENRICHMENT: datasetPlan.filter((x) => x.category === 'ENRICHMENT'),
    MARKET: datasetPlan.filter((x) => x.category === 'MARKET'),
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back to Campaigns</Button>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
      </div>

      <PageHeader
        title={`Run ${displaySeason(season)}`}
        description="Historical Bootstrap campaign"
        tag={<StatusBadge status={loading ? 'LOADING' : status} />}
        actions={<div className="flex gap-2"><Button variant="outline" onClick={onPrepare} disabled={preparing || starting || loading || !isActionable}><Database className="h-4 w-4" /> {preparing ? 'Preparing…' : 'Prepare Jobs'}</Button><Button onClick={onStart} disabled={starting || preparing || loading || !isActionable}><Play className="h-4 w-4" /> {starting ? 'Starting…' : 'Start Bootstrap'}</Button></div>}
      />

      <section className="rounded-xl border border-border bg-card p-5 shadow-retool-sm">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <CompactMetric label="Season" value={displaySeason(season)} />
          <CompactMetric label="Status" value={status} />
          <CompactMetric label="Scope" value={`${scope?.available_league_count ?? row?.provider_leagues ?? 0} leagues`} />
          <CompactMetric label="Jobs" value={String(row?.backfill_jobs ?? 0)} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card shadow-retool-sm">
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">Campaign Overview</h2>
              <p className="mt-1 text-xs text-muted-foreground">Only campaign-specific metadata is shown here.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoMetric label="Campaign ID" value={campaign.campaign_id ?? '—'} mono />
            <InfoMetric label="Created" value={fmtDate(campaign.created_at)} />
            <InfoMetric label="Planned start" value={fmtDate(campaign.planned_start_at)} />
            <InfoMetric label="Target end" value={fmtDate(campaign.minimum_target_end_at)} />
          </div>
        </div>
        <div className="border-t border-border px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">Dataset Plan</h2>
              <p className="mt-1 text-xs text-muted-foreground">{datasetPlan.length} datasets · {scope?.available_league_count ?? 0} leagues in scope</p>
            </div>
            <Button variant="outline" size="sm" onClick={onToggleDataset}><ChevronDown className={`h-4 w-4 transition-transform ${datasetOpen ? 'rotate-180' : ''}`} /> {datasetOpen ? 'Hide details' : 'View Dataset Plan'}</Button>
          </div>
          {datasetOpen && (
            <div className="mt-4 grid gap-3 xl:grid-cols-3">
              <DatasetGroup title="Historical core" datasets={datasetByCategory.CORE} />
              <DatasetGroup title="Historical enrichment" datasets={datasetByCategory.ENRICHMENT} />
              <DatasetGroup title="Market / optional" datasets={datasetByCategory.MARKET} />
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-retool-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Execution</h2>
            <p className="mt-1 text-xs text-muted-foreground">Job preparation and bootstrap progress for this campaign.</p>
          </div>
          <span className="text-xs font-semibold text-muted-foreground">{progress.toFixed(0)}%</span>
        </div>
        <div className="mt-4"><ProgressBar value={progress} /></div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <CompactMetric label="Queued" value={String(row?.backfill_jobs ?? 0)} />
          <CompactMetric label="Succeeded" value={String(row?.backfill_succeeded ?? 0)} />
          <CompactMetric label="Active" value={String(row?.backfill_active ?? 0)} />
          <CompactMetric label="Failed" value={String(row?.backfill_failed ?? 0)} />
        </div>
      </section>
    </div>
  )
}

function CreateCampaignDialog({
  selectedSeason,
  onSeasonChange,
  creating,
  onClose,
  onCreate,
}: {
  selectedSeason: number
  onSeasonChange: (season: number) => void
  creating: boolean
  onClose: () => void
  onCreate: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="create-campaign-title">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl">
        <div>
          <h2 id="create-campaign-title" className="text-base font-semibold">Create Campaign</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Create a campaign definition first. This does not prepare dataset jobs or start the provider run.</p>
        </div>
        <div className="mt-5 rounded-lg border border-border bg-background p-4">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Season</label>
          <select value={selectedSeason} onChange={(event) => onSeasonChange(Number(event.target.value))} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-ring">
            {seasonOptions.map((season) => <option key={season} value={season}>{displaySeason(season)}</option>)}
          </select>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <CompactMetric label="Mode" value="Historical" />
            <CompactMetric label="Jobs" value="Not prepared" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={creating}>Cancel</Button>
          <Button onClick={onCreate} disabled={creating}>{creating ? 'Creating…' : 'Create Campaign'}</Button>
        </div>
      </div>
    </div>
  )
}

function DatasetGroup({ title, datasets }: { title: string; datasets: HistoricalBootstrapDatasetPlan[] }) {
  if (!datasets.length) {
    return <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">No datasets in this category.</div>
  }
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-xs font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{datasets.length}</span>
      </div>
      <div className="mt-2 flex max-h-[360px] flex-col gap-1.5 overflow-auto">
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

function InfoMetric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className={`mt-1 truncate text-sm font-semibold ${mono ? 'font-mono text-xs' : ''}`}>{value}</div></div>
}
