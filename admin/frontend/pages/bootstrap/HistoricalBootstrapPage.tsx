import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown, Database, Play, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import { fetchHistoricalBootstrapSnapshot, startHistoricalCampaign, type HistoricalBootstrapSnapshot, type HistoricalSeasonProgress, type HistoricalCampaignPlan } from '../../integrations/archiveLive'
import { fetchHistoricalBootstrapScope, type HistoricalBootstrapScope, type HistoricalBootstrapDatasetPlan } from '../../integrations/historicalBootstrapScope'
import HistoricalCampaignCreateDialog from './HistoricalCampaignCreateDialog'

function displaySeason(season: number) { return `${season}/${season + 1}` }
function numberValue(value?: number | null) { return value == null ? '—' : value.toLocaleString() }
function fmtDate(value?: string) { return value ? new Date(value).toLocaleString() : '—' }
function progressValue(row?: HistoricalSeasonProgress | null) { if (!row || row.backfill_jobs <= 0) return 0; return Math.max(0, Math.min(100, ((row.backfill_succeeded + row.backfill_failed) / row.backfill_jobs) * 100)) }
function seasonStatus(row: HistoricalSeasonProgress) { if (row.gate_state) return row.gate_state; if (row.backfill_failed > 0 && row.backfill_active === 0 && row.backfill_succeeded + row.backfill_failed >= row.backfill_jobs) return 'COMPLETED_WITH_FAILURES'; if (row.backfill_active > 0) return 'RUNNING'; if (row.backfill_succeeded > 0 && row.backfill_succeeded >= row.backfill_jobs) return 'READY'; if (row.backfill_jobs > 0) return 'QUEUED'; return 'DRAFT' }
function datasetStatus(dataset: HistoricalBootstrapDatasetPlan) { if (!dataset.execution_supported || dataset.available_count === 0) return 'UNAVAILABLE'; if (dataset.available_count < dataset.scope_count) return 'PARTIAL'; return 'AVAILABLE' }
function dedupe(rows: HistoricalSeasonProgress[]) { const map = new Map<number, HistoricalSeasonProgress>(); for (const row of rows) { const season = Number(row.season); if (Number.isInteger(season)) map.set(season, { ...(map.get(season) ?? {}), ...row, season }) } return [...map.values()].sort((a, b) => b.season - a.season) }

export default function HistoricalBootstrapPage() {
  const [snapshot, setSnapshot] = useState<HistoricalBootstrapSnapshot | null>(null)
  const [detailSeason, setDetailSeason] = useState<number | null>(null)
  const [scope, setScope] = useState<HistoricalBootstrapScope | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [datasetOpen, setDatasetOpen] = useState(false)

  const seasons = useMemo(() => dedupe(snapshot?.seasons ?? []).filter((row) => row.backfill_jobs > 0 || row.archive_campaigns > 0 || row.backfill_active > 0 || row.backfill_succeeded > 0 || row.backfill_failed > 0), [snapshot?.seasons])
  const detailRow = useMemo(() => seasons.find((row) => row.season === detailSeason) ?? null, [seasons, detailSeason])

  async function loadSnapshot() { setLoading(true); try { setSnapshot(await fetchHistoricalBootstrapSnapshot()) } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to load historical campaigns') } finally { setLoading(false) } }
  async function openCampaign(season: number) { setDetailSeason(season); setDatasetOpen(false); setDetailLoading(true); try { setScope(await fetchHistoricalBootstrapScope(season)) } catch (error) { setScope(null); toast.error(error instanceof Error ? error.message : 'Unable to load campaign details') } finally { setDetailLoading(false) } }
  function closeCampaign() { setDetailSeason(null); setScope(null); setDatasetOpen(false) }
  useEffect(() => { void loadSnapshot() }, [])

  async function startBootstrap() {
    if (detailSeason == null) return
    setStarting(true)
    try { await startHistoricalCampaign(detailSeason, detailSeason); toast.success(`Historical ${displaySeason(detailSeason)} started`, { description: 'The queue will follow the campaign start/target window and provider quota limits.' }); await loadSnapshot(); await openCampaign(detailSeason) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to start historical bootstrap') }
    finally { setStarting(false) }
  }

  function created(season: number) { setCreateOpen(false); void loadSnapshot(); void openCampaign(season) }

  if (detailSeason != null) return <CampaignDetail season={detailSeason} row={detailRow} scope={scope} loading={detailLoading} starting={starting} datasetOpen={datasetOpen} onToggleDataset={() => setDatasetOpen((v) => !v)} onBack={closeCampaign} onRefresh={() => void openCampaign(detailSeason)} onStart={() => void startBootstrap()} />

  return <>
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 pb-8">
      <PageHeader title="Historical Bootstrap" description="Manage historical data campaigns and their execution." tag={<span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">{loading ? 'Loading…' : `${seasons.length} campaigns`}</span>} actions={<Button onClick={() => setCreateOpen(true)}><Database className="h-4 w-4" /> Create Campaign</Button>} />
      <section className="rounded-xl border border-border bg-card shadow-retool-sm"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-sm font-semibold">Campaigns</h2><p className="mt-1 text-xs text-muted-foreground">Only campaign-level information is shown here.</p></div><Button variant="outline" size="sm" onClick={() => void loadSnapshot()} disabled={loading}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button></div>{loading ? <div className="p-8 text-center text-sm text-muted-foreground">Loading campaigns…</div> : seasons.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">No campaigns yet.</div> : <div className="divide-y divide-border">{seasons.map((row) => <CampaignRow key={row.season} row={row} onOpen={() => void openCampaign(row.season)} />)}</div>}</section>
    </div>
    {createOpen && <HistoricalCampaignCreateDialog onClose={() => setCreateOpen(false)} onCreated={created} />}
  </>
}

function CampaignRow({ row, onOpen }: { row: HistoricalSeasonProgress; onOpen: () => void }) { const progress = progressValue(row); return <button type="button" onClick={onOpen} className="flex w-full flex-col gap-4 px-5 py-4 text-left hover:bg-muted/25 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">Run {displaySeason(row.season)}</h3><StatusBadge status={seasonStatus(row)} dense /></div><p className="mt-1 text-xs text-muted-foreground">Historical Bootstrap campaign</p></div><div className="grid grid-cols-3 gap-6 text-xs sm:grid-cols-4"><Metric label="Provider leagues" value={numberValue(row.provider_leagues)} /><Metric label="Jobs" value={numberValue(row.backfill_jobs)} /><Metric label="Archive" value={`${((row.archive_completeness ?? 0) * 100).toFixed(1)}%`} /><div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Progress</div><div className="mt-1 flex items-center gap-2"><div className="w-16"><ProgressBar value={progress} /></div><span className="text-xs font-semibold">{progress.toFixed(1)}%</span></div></div></div><span className="text-xs font-semibold text-muted-foreground">View campaign →</span></button> }

function CampaignDetail({ season, row, scope, loading, starting, datasetOpen, onToggleDataset, onBack, onRefresh, onStart }: { season: number; row: HistoricalSeasonProgress | null; scope: HistoricalBootstrapScope | null; loading: boolean; starting: boolean; datasetOpen: boolean; onToggleDataset: () => void; onBack: () => void; onRefresh: () => void; onStart: () => void }) {
  const campaign = scope?.campaign ?? {}; const datasets = scope?.dataset_plan ?? []; const progress = progressValue(row); const archive = row?.archive_completeness == null ? '—' : `${(Number(row.archive_completeness) * 100).toFixed(1)}%`; const processable = datasets.filter((d) => datasetStatus(d) !== 'UNAVAILABLE'); const blocked = datasets.filter((d) => datasetStatus(d) === 'UNAVAILABLE'); const quota = scope?.quota ?? {}
  return <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 pb-8"><div className="flex items-center justify-between"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back to Campaigns</Button><Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button></div><PageHeader title={`Run ${displaySeason(season)}`} description="Historical Bootstrap campaign" tag={<StatusBadge status={loading ? 'LOADING' : (row ? seasonStatus(row) : 'READY')} />} actions={<Button onClick={onStart} disabled={starting || loading || !scope?.available_league_count}><Play className="h-4 w-4" /> {starting ? 'Starting…' : 'Start Bootstrap'}</Button>} />
    <section className="rounded-xl border border-border bg-card p-5 shadow-retool-sm"><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Started" value={fmtDate(campaign.planned_start_at)} /><Metric label="Target end" value={fmtDate(campaign.minimum_target_end_at)} /><Metric label="Enabled countries" value={numberValue(scope?.enabled_country_count)} /><Metric label="Enabled leagues" value={numberValue(scope?.enabled_league_count)} /></div><div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Available leagues" value={numberValue(scope?.available_league_count)} /><Metric label="Jobs" value={numberValue(row?.backfill_jobs)} /><Metric label="Progress" value={`${progress.toFixed(1)}%`} /><Metric label="Archive completeness" value={archive} /></div></section>
    <section className="rounded-xl border border-border bg-card p-5 shadow-retool-sm"><h2 className="text-sm font-semibold">Quota & Budget</h2><div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4"><Metric label="Daily budget" value={numberValue(quota.daily_budget)} /><Metric label="Quota used" value={numberValue(quota.quota_used)} /><Metric label="Backfill remaining" value={numberValue(quota.backfill_budget)} /><Metric label="Campaign requests" value={numberValue(campaign.requests_used)} /></div></section>
    <section className="rounded-xl border border-border bg-card shadow-retool-sm"><div className="flex items-center justify-between px-5 py-4"><div><h2 className="text-sm font-semibold">Dataset Plan</h2><p className="mt-1 text-xs text-muted-foreground">{datasets.length} datasets · {processable.length} processable · {blocked.length} unavailable</p></div><Button variant="outline" size="sm" onClick={onToggleDataset}><ChevronDown className={`h-4 w-4 ${datasetOpen ? 'rotate-180' : ''}`} /> {datasetOpen ? 'Hide details' : 'View Dataset Plan'}</Button></div>{datasetOpen && <DatasetTable datasets={datasets} />}</section>
    <section className="rounded-xl border border-border bg-card p-5 shadow-retool-sm"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Execution</h2><p className="mt-1 text-xs text-muted-foreground">Progress is calculated from terminal jobs rather than the backend progress hint.</p></div><span className="text-sm font-semibold">{progress.toFixed(1)}%</span></div><div className="mt-4"><ProgressBar value={progress} /></div><div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5"><Metric label="Jobs" value={numberValue(row?.backfill_jobs)} /><Metric label="Succeeded" value={numberValue(row?.backfill_succeeded)} /><Metric label="Active" value={numberValue(row?.backfill_active)} /><Metric label="Failed" value={numberValue(row?.backfill_failed)} /><Metric label="Archive succeeded" value={numberValue(row?.archive_succeeded)} /></div></section>
    <section className="rounded-xl border border-border bg-card p-5 shadow-retool-sm"><div className="text-xs leading-5 text-muted-foreground">The queue respects the campaign Planned start and Target end window while continuing to honor provider rate limits and the backfill daily budget.</div></section>
  </div>
}

function DatasetTable({ datasets }: { datasets: HistoricalBootstrapDatasetPlan[] }) { return <div className="overflow-hidden rounded-md border border-border"><div className="grid grid-cols-[1.6fr,0.9fr,90px,90px,100px] border-b bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><div>Dataset</div><div>Category</div><div>Available</div><div>Scope</div><div>Status</div></div><div className="max-h-[360px] overflow-auto">{datasets.map((d) => { const state = datasetStatus(d); const Icon = state === 'AVAILABLE' ? CheckCircle2 : state === 'PARTIAL' ? AlertTriangle : XCircle; return <div key={d.dataset_key} className="grid grid-cols-[1.6fr,0.9fr,90px,90px,100px] items-center gap-2 border-b px-3 py-2 last:border-0 text-xs"><div className="truncate font-medium">{d.label}</div><div className="truncate text-muted-foreground">{d.category}</div><div>{numberValue(d.available_count)}</div><div>{numberValue(d.scope_count)}</div><div><span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"><Icon className="h-3 w-3" />{state}</span></div></div>})}</div></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 truncate text-sm font-semibold">{value}</div></div> }
