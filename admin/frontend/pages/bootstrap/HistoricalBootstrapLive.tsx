import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, ChevronDown, Database, Info, Plus, Play, RefreshCw, XCircle } from 'lucide-react'
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

type CreateStage = 'review' | 'preparing' | 'creating'

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

function numberValue(value?: number | null) {
  return value == null ? '—' : value.toLocaleString()
}

/** Completion is derived from terminal jobs, not the backend progress hint. */
function progressValue(row?: HistoricalSeasonProgress | null) {
  if (!row || row.backfill_jobs <= 0) return 0
  const completed = Math.max(0, row.backfill_succeeded + row.backfill_failed)
  return Math.max(0, Math.min(100, (completed / row.backfill_jobs) * 100))
}

function seasonStatus(row: HistoricalSeasonProgress) {
  if (row.gate_state) return row.gate_state
  if (row.backfill_failed > 0 && row.backfill_active === 0 && row.backfill_succeeded + row.backfill_failed >= row.backfill_jobs) return 'COMPLETED_WITH_FAILURES'
  if (row.backfill_active > 0) return 'RUNNING'
  if (row.backfill_succeeded > 0 && row.backfill_succeeded >= row.backfill_jobs) return 'READY'
  if (row.backfill_jobs > 0) return 'QUEUED'
  return 'DRAFT'
}

function datasetSummary(datasets: HistoricalBootstrapDatasetPlan[]) {
  const processable = datasets.filter((dataset) => datasetStatus(dataset) !== 'UNAVAILABLE')
  const blocked = datasets.filter((dataset) => datasetStatus(dataset) === 'UNAVAILABLE')
  return { processable, blocked }
}

export default function HistoricalBootstrapLive() {
  const [snapshot, setSnapshot] = useState<HistoricalBootstrapSnapshot | null>(null)
  const [selectedSeason, setSelectedSeason] = useState(2020)
  const [detailSeason, setDetailSeason] = useState<number | null>(null)
  const [scope, setScope] = useState<HistoricalBootstrapScope | null>(null)
  const [createScope, setCreateScope] = useState<HistoricalBootstrapScope | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [createScopeLoading, setCreateScopeLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createStage, setCreateStage] = useState<CreateStage>('review')
  const [createJobsTotal, setCreateJobsTotal] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const [datasetOpen, setDatasetOpen] = useState(false)

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
      setSnapshot(await fetchHistoricalBootstrapSnapshot())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load historical campaigns')
    } finally {
      setLoading(false)
    }
  }

  async function loadCreateScope(season: number) {
    setCreateScopeLoading(true)
    try {
      setCreateScope(await fetchHistoricalBootstrapScope(season))
    } catch (error) {
      setCreateScope(null)
      toast.error(error instanceof Error ? error.message : 'Unable to resolve campaign scope')
    } finally {
      setCreateScopeLoading(false)
    }
  }

  async function openCreateCampaign() {
    setCreateOpen(true)
    setCreateStage('review')
    setCreateJobsTotal(null)
    await loadCreateScope(selectedSeason)
  }

  async function openCampaign(season: number) {
    setDetailSeason(season)
    setDatasetOpen(false)
    setDetailLoading(true)
    try {
      setScope(await fetchHistoricalBootstrapScope(season))
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
    if (!createScope || createScope.available_league_count === 0) return
    setCreateStage('preparing')
    try {
      const prepared = await prepareHistoricalSeason(selectedSeason, 100)
      setCreateJobsTotal(prepared.jobs_total)
      setCreateStage('creating')
      await startHistoricalCampaign(selectedSeason, selectedSeason)
      toast.success(`Campaign ${displaySeason(selectedSeason)} created`, {
        description: `${prepared.jobs_total} dataset jobs were prepared automatically before campaign creation.`,
      })
      setCreateOpen(false)
      await loadSnapshot()
      await openCampaign(selectedSeason)
    } catch (error) {
      setCreateStage('review')
      toast.error(error instanceof Error ? error.message : 'Unable to create campaign')
    }
  }

  async function startBootstrap() {
    if (detailSeason == null) return
    setStarting(true)
    try {
      await startHistoricalCampaign(detailSeason, detailSeason)
      toast.success(`Historical ${displaySeason(detailSeason)} started`, {
        description: 'The campaign is now handed to the historical bootstrap execution flow.',
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
        starting={starting}
        datasetOpen={datasetOpen}
        onToggleDataset={() => setDatasetOpen((value) => !value)}
        onBack={closeCampaign}
        onRefresh={() => void openCampaign(detailSeason)}
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
          tag={<span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">{loading ? 'Loading…' : `${seasons.length} campaigns`}</span>}
          actions={<Button onClick={() => void openCreateCampaign()}><Plus className="h-4 w-4" /> Create Campaign</Button>}
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
              <p className="mt-1 text-xs text-muted-foreground">Create a historical campaign to prepare and create the first season campaign.</p>
              <Button className="mt-4" onClick={() => void openCreateCampaign()}><Plus className="h-4 w-4" /> Create Campaign</Button>
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
          scope={createScope}
          loading={createScopeLoading}
          stage={createStage}
          jobsTotal={createJobsTotal}
          onSeasonChange={(season) => { setSelectedSeason(season); void loadCreateScope(season) }}
          onClose={() => setCreateOpen(false)}
          onCreate={() => void createCampaign()}
        />
      )}
    </>
  )
}

function CampaignListRow({ row, onOpen }: { row: HistoricalSeasonProgress; onOpen: () => void }) {
  const status = seasonStatus(row)
  const progress = progressValue(row)
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
        <CompactMetric label="Provider leagues" value={numberValue(row.provider_leagues)} />
        <CompactMetric label="Jobs" value={numberValue(row.backfill_jobs)} />
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Progress</div>
          <div className="mt-1 flex items-center gap-2"><div className="w-16"><ProgressBar value={progress} /></div><span className="text-xs font-semibold">{progress.toFixed(1)}%</span></div>
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
  starting,
  datasetOpen,
  onToggleDataset,
  onBack,
  onRefresh,
  onStart,
}: {
  season: number
  row: HistoricalSeasonProgress | null
  scope: HistoricalBootstrapScope | null
  loading: boolean
  starting: boolean
  datasetOpen: boolean
  onToggleDataset: () => void
  onBack: () => void
  onRefresh: () => void
  onStart: () => void
}) {
  const campaign = scope?.campaign ?? {}
  const datasetPlan = scope?.dataset_plan ?? []
  const status = row ? seasonStatus(row) : (scope?.available_league_count ? 'READY' : 'BLOCKED')
  const progress = progressValue(row)
  const archiveCompleteness = row?.archive_completeness == null ? null : Number(row.archive_completeness) * 100
  const datasetInfo = datasetSummary(datasetPlan)
  const quota = scope?.quota ?? {}

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
        actions={<Button onClick={onStart} disabled={starting || loading || !scope?.available_league_count}><Play className="h-4 w-4" /> {starting ? 'Starting…' : 'Start Bootstrap'}</Button>}
      />

      <section className="rounded-xl border border-border bg-card p-5 shadow-retool-sm">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <CompactMetric label="Season" value={displaySeason(season)} />
          <CompactMetric label="Status" value={status} />
          <CompactMetric label="Enabled countries" value={numberValue(scope?.enabled_country_count)} />
          <CompactMetric label="Enabled leagues" value={numberValue(scope?.enabled_league_count)} />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <CompactMetric label="Available leagues" value={numberValue(scope?.available_league_count)} />
          <CompactMetric label="Supported leagues" value={numberValue(row?.supported_leagues)} />
          <CompactMetric label="Provider leagues" value={numberValue(row?.provider_leagues)} />
          <CompactMetric label="Archive campaigns" value={numberValue(row?.archive_campaigns)} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-retool-sm">
        <div className="flex items-center gap-2"><Database className="h-4 w-4" /><h2 className="text-sm font-semibold">Quota & Budget</h2></div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <CompactMetric label="Daily budget" value={numberValue(quota.daily_budget)} />
          <CompactMetric label="Quota used" value={numberValue(quota.quota_used)} />
          <CompactMetric label="Backfill remaining" value={numberValue(quota.backfill_budget)} />
          <CompactMetric label="Campaign requests" value={numberValue(campaign.requests_used)} />
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">Reserve policy: <span className="font-medium text-foreground">{quota.reserve_policy_version ?? '—'}</span></div>
      </section>

      <section className="rounded-xl border border-border bg-card shadow-retool-sm">
        <div className="px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Campaign Overview</h2>
            <p className="mt-1 text-xs text-muted-foreground">Campaign identity, lifecycle and archive state.</p>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoMetric label="Campaign ID" value={campaign.campaign_id ?? '—'} mono />
            <InfoMetric label="Created" value={fmtDate(campaign.created_at)} />
            <InfoMetric label="Planned start" value={fmtDate(campaign.planned_start_at)} />
            <InfoMetric label="Target end" value={fmtDate(campaign.minimum_target_end_at)} />
            <InfoMetric label="Campaign completeness" value={campaign.completeness_score == null ? '—' : `${(campaign.completeness_score * 100).toFixed(1)}%`} />
            <InfoMetric label="Archive completeness" value={archiveCompleteness == null ? '—' : `${archiveCompleteness.toFixed(1)}%`} />
            <InfoMetric label="Ready for archive" value={row?.ready_for_archive ? 'Yes' : 'No'} />
            <InfoMetric label="Last watermark" value={campaign.last_successful_watermark ? 'Present' : '—'} />
          </div>
        </div>
        <div className="border-t border-border px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">Dataset Plan</h2>
              <p className="mt-1 text-xs text-muted-foreground">{datasetPlan.length} dataset definitions · {datasetInfo.processable.length} processable · {datasetInfo.blocked.length} unavailable</p>
            </div>
            <Button variant="outline" size="sm" onClick={onToggleDataset}><ChevronDown className={`h-4 w-4 transition-transform ${datasetOpen ? 'rotate-180' : ''}`} /> {datasetOpen ? 'Hide details' : 'View Dataset Plan'}</Button>
          </div>
          {datasetOpen && <DatasetPlanTable datasets={datasetPlan} />}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-retool-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Execution</h2>
            <p className="mt-1 text-xs text-muted-foreground">Completion is derived from terminal jobs: succeeded + failed, divided by total jobs.</p>
          </div>
          <span className="text-xs font-semibold text-muted-foreground">{progress.toFixed(1)}%</span>
        </div>
        <div className="mt-4"><ProgressBar value={progress} /></div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <CompactMetric label="Total jobs" value={numberValue(row?.backfill_jobs)} />
          <CompactMetric label="Succeeded" value={numberValue(row?.backfill_succeeded)} />
          <CompactMetric label="Active" value={numberValue(row?.backfill_active)} />
          <CompactMetric label="Failed" value={numberValue(row?.backfill_failed)} />
          <CompactMetric label="Archive succeeded" value={numberValue(row?.archive_succeeded)} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <InfoMetric label="Backfill progress" value={row ? `${progress.toFixed(1)}%` : '—'} />
          <InfoMetric label="Archive completeness" value={archiveCompleteness == null ? '—' : `${archiveCompleteness.toFixed(1)}%`} />
          <InfoMetric label="Ready for archive" value={row?.ready_for_archive ? 'Yes' : 'No'} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-retool-sm">
        <div className="flex items-start gap-3"><Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div><h2 className="text-sm font-semibold">Bootstrap action</h2><p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">The campaign is prepared automatically during creation. Start Bootstrap is the explicit execution handoff; it does not re-run job preparation here.</p></div></div>
      </section>
    </div>
  )
}

function CreateCampaignDialog({
  selectedSeason,
  scope,
  loading,
  stage,
  jobsTotal,
  onSeasonChange,
  onClose,
  onCreate,
}: {
  selectedSeason: number
  scope: HistoricalBootstrapScope | null
  loading: boolean
  stage: CreateStage
  jobsTotal: number | null
  onSeasonChange: (season: number) => void
  onClose: () => void
  onCreate: () => void
}) {
  const datasetPlan = scope?.dataset_plan ?? []
  const { processable, blocked } = datasetSummary(datasetPlan)
  const quota = scope?.quota ?? {}
  const ready = Boolean(scope && scope.available_league_count > 0)
  const busy = stage !== 'review'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-background/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="create-campaign-title">
      <div className="w-full max-w-5xl rounded-xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="create-campaign-title" className="text-base font-semibold">Create Campaign</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">The creation flow has two automatic stages: first prepare the dataset jobs, then create the campaign immediately after preparation succeeds.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Close</Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-2">
          <StepCard index="1" title="Prepare Jobs" state={stage === 'review' ? 'READY TO START' : stage === 'preparing' ? 'RUNNING' : 'COMPLETED'} active={stage === 'preparing'} />
          <StepCard index="2" title="Create Campaign" state={stage === 'creating' ? 'RUNNING' : stage === 'review' ? 'WAITING' : 'COMPLETED'} active={stage === 'creating'} />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[240px,1fr]">
          <div className="rounded-lg border border-border bg-background p-4">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Season</label>
            <select value={selectedSeason} onChange={(event) => onSeasonChange(Number(event.target.value))} disabled={busy} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-ring disabled:opacity-60">
              {seasonOptions.map((season) => <option key={season} value={season}>{displaySeason(season)}</option>)}
            </select>
            <div className="mt-4 grid gap-3">
              <CompactMetric label="Mode" value="Historical" />
              <CompactMetric label="Prepared jobs" value={jobsTotal == null ? '—' : numberValue(jobsTotal)} />
            </div>
          </div>

          <div className="grid gap-4">
            <section className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between"><div><h3 className="text-xs font-semibold">Resolved Scope</h3><p className="mt-1 text-[11px] text-muted-foreground">Enabled configuration intersected with provider season availability.</p></div>{loading ? <span className="text-[11px] text-muted-foreground">Resolving…</span> : <StatusBadge status={ready ? 'READY' : 'BLOCKED'} dense />}</div>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <CompactMetric label="Enabled countries" value={numberValue(scope?.enabled_country_count)} />
                <CompactMetric label="Enabled leagues" value={numberValue(scope?.enabled_league_count)} />
                <CompactMetric label="Available leagues" value={numberValue(scope?.available_league_count)} />
                <CompactMetric label="Season" value={displaySeason(selectedSeason)} />
              </div>
            </section>

            <section className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2"><Database className="h-4 w-4" /><h3 className="text-xs font-semibold">Dataset Plan</h3><span className="ml-auto text-[11px] text-muted-foreground">{processable.length} processable · {blocked.length} unavailable</span></div>
              <div className="mt-3"><DatasetPlanTable datasets={datasetPlan} compact /></div>
            </section>

            <section className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2"><Database className="h-4 w-4" /><h3 className="text-xs font-semibold">Daily Budget</h3></div>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <CompactMetric label="Daily budget" value={numberValue(quota.daily_budget)} />
                <CompactMetric label="Quota used" value={numberValue(quota.quota_used)} />
                <CompactMetric label="Backfill remaining" value={numberValue(quota.backfill_budget)} />
                <CompactMetric label="Campaign requests" value={numberValue(scope?.campaign.requests_used)} />
              </div>
            </section>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <div className="text-[11px] text-muted-foreground"><span className="font-semibold text-foreground">Flow:</span> Prepare Jobs → Create Campaign. Create is disabled until the season has an available league scope.</div>
          <div className="flex gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={onCreate} disabled={busy || loading || !ready}>{stage === 'preparing' ? 'Preparing Jobs…' : stage === 'creating' ? 'Creating Campaign…' : 'Prepare & Create Campaign'}</Button></div>
        </div>
      </div>
    </div>
  )
}

function StepCard({ index, title, state, active }: { index: string; title: string; state: string; active: boolean }) {
  return <div className={`rounded-lg border px-4 py-3 ${active ? 'border-foreground/30 bg-muted/30' : 'border-border bg-background/60'}`}><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold">{index}</span><div><div className="text-xs font-semibold">{title}</div><div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{state}</div></div></div></div>
}

function DatasetPlanTable({ datasets, compact = false }: { datasets: HistoricalBootstrapDatasetPlan[]; compact?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 text-left font-semibold">Dataset</th>
              <th className="px-3 py-2.5 text-left font-semibold">Category</th>
              <th className="px-3 py-2.5 text-right font-semibold">Scope</th>
              <th className="px-3 py-2.5 text-right font-semibold">Available</th>
              <th className="px-3 py-2.5 text-center font-semibold">Required</th>
              <th className="px-3 py-2.5 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {datasets.length ? datasets.map((dataset) => {
              const state = datasetStatus(dataset)
              return (
                <tr key={dataset.dataset_key} className="border-t border-border hover:bg-muted/20">
                  <td className="px-3 py-2.5"><div className="font-medium">{dataset.label}</div>{!compact && <div className="mt-0.5 text-[10px] text-muted-foreground">{dataset.endpoint}</div>}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{dataset.category}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{numberValue(dataset.scope_count)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">{numberValue(dataset.available_count)}</td>
                  <td className="px-3 py-2.5 text-center">{dataset.required_for_archive ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2.5"><DatasetStatus state={state} /></td>
                </tr>
              )
            }) : (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">No dataset definitions resolved.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DatasetStatus({ state }: { state: string }) {
  if (state === 'AVAILABLE') return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Available</span>
  if (state === 'PARTIAL') return <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400"><Info className="h-3 w-3" /> Partial</span>
  return <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"><XCircle className="h-3 w-3" /> Unavailable</span>
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 truncate text-sm font-semibold">{value}</div></div>
}

function InfoMetric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className={`mt-1 truncate text-sm font-semibold ${mono ? 'font-mono text-xs' : ''}`}>{value}</div></div>
}
