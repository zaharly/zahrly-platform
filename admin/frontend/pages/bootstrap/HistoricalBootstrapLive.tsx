import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, Play, RefreshCw, Send } from 'lucide-react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import {
  fetchHistoricalBootstrapSnapshot,
  prepareHistoricalSeason,
  startHistoricalCampaign,
  triggerProviderSeason,
  type HistoricalBootstrapSnapshot,
  type HistoricalSeasonProgress,
} from '../../integrations/archiveLive'

const PRIMARY_SEASON = 2008
const CAMPAIGN_START = 2008
const CAMPAIGN_END = 2026

const displaySeason = (season: number) => `${season}/${season + 1}`

function dedupeSeasons(rows: HistoricalSeasonProgress[]) {
  const bySeason = new Map<number, HistoricalSeasonProgress>()
  for (const row of rows) {
    const season = Number(row.season)
    if (!Number.isInteger(season)) continue
    const previous = bySeason.get(season)
    if (!previous) {
      bySeason.set(season, { ...row, season })
      continue
    }
    bySeason.set(season, {
      ...previous,
      ...row,
      season,
      supported_leagues: Math.max(previous.supported_leagues ?? 0, row.supported_leagues ?? 0),
      provider_leagues: Math.max(previous.provider_leagues ?? 0, row.provider_leagues ?? 0),
      backfill_jobs: Math.max(previous.backfill_jobs ?? 0, row.backfill_jobs ?? 0),
      backfill_succeeded: Math.max(previous.backfill_succeeded ?? 0, row.backfill_succeeded ?? 0),
      backfill_active: Math.max(previous.backfill_active ?? 0, row.backfill_active ?? 0),
      backfill_failed: Math.max(previous.backfill_failed ?? 0, row.backfill_failed ?? 0),
      backfill_progress: Math.max(previous.backfill_progress ?? 0, row.backfill_progress ?? 0),
      archive_campaigns: Math.max(previous.archive_campaigns ?? 0, row.archive_campaigns ?? 0),
      archive_succeeded: Math.max(previous.archive_succeeded ?? 0, row.archive_succeeded ?? 0),
      archive_completeness: Math.max(previous.archive_completeness ?? 0, row.archive_completeness ?? 0),
      ready_for_archive: Boolean(previous.ready_for_archive || row.ready_for_archive),
    })
  }
  return [...bySeason.values()].sort((a, b) => a.season - b.season)
}

export default function HistoricalBootstrapLive() {
  const [snapshot, setSnapshot] = useState<HistoricalBootstrapSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [preparing, setPreparing] = useState(false)

  const seasons = useMemo(() => dedupeSeasons(snapshot?.seasons ?? []), [snapshot?.seasons])
  const primary = seasons.find((row) => row.season === PRIMARY_SEASON) ?? null
  const campaign = snapshot?.campaign && 'campaign_id' in snapshot.campaign ? snapshot.campaign : null

  async function load() {
    setLoading(true)
    try {
      setSnapshot(await fetchHistoricalBootstrapSnapshot())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load historical control plane')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function ensureCampaign() {
    if (campaign) return
    setStarting(true)
    try {
      await startHistoricalCampaign(CAMPAIGN_START, CAMPAIGN_END)
      toast.success(`Historical campaign ${CAMPAIGN_START}–${CAMPAIGN_END} is ready`)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start historical campaign')
    } finally {
      setStarting(false)
    }
  }

  async function discover2008() {
    setDiscovering(true)
    try {
      await ensureCampaign()
      await triggerProviderSeason(PRIMARY_SEASON)
      toast.success(`Season ${displaySeason(PRIMARY_SEASON)} discovery requested`)
      window.setTimeout(() => void load(), 1500)
      window.setTimeout(() => void load(), 5000)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to request season discovery')
    } finally {
      setDiscovering(false)
    }
  }

  async function prepare2008() {
    setPreparing(true)
    try {
      const result = await prepareHistoricalSeason(PRIMARY_SEASON, 100)
      toast.success(`Season ${displaySeason(PRIMARY_SEASON)} prepared`, {
        description: `${result.jobs_total} backfill job${result.jobs_total === 1 ? '' : 's'} in the canonical queue`,
      })
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to prepare historical season')
    } finally {
      setPreparing(false)
    }
  }

  return (
    <div className="flex flex-col gap-density-xl">
      <PageHeader
        title="Historical Bootstrap"
        description="Single historical control plane. Season identity is the numeric year; 2008/2009 is presentation only."
        tag={<StatusBadge status={loading ? 'LOADING' : campaign?.status ?? 'PLANNED'} />}
        actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="flex flex-col gap-density-lg lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2"><Database className="h-5 w-5" /><h2 className="text-base font-semibold">Historical campaign</h2></div>
            <p className="mt-1 text-sm text-muted-foreground">One campaign owns the historical range and is reused by every season preparation request.</p>
            <div className="mt-density-lg grid grid-cols-2 gap-density-md md:grid-cols-4">
              <Metric label="Campaign" value={campaign?.status ?? 'Not started'} />
              <Metric label="Range" value={campaign ? `${campaign.target_start_season}–${campaign.target_end_season}` : `${CAMPAIGN_START}–${CAMPAIGN_END}`} />
              <Metric label="Requests" value={String(campaign?.requests_used ?? 0)} />
              <Metric label="Completeness" value={`${(Number(campaign?.completeness_score ?? 0) * 100).toFixed(1)}%`} />
            </div>
          </div>
          <Button onClick={() => void ensureCampaign()} disabled={starting || !!campaign}>
            {campaign ? <><CheckCircle2 className="h-4 w-4" /> Campaign ready</> : <><Play className="h-4 w-4" /> Start campaign</>}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="flex items-start justify-between gap-density-md">
          <div>
            <div className="flex items-center gap-2"><h2 className="text-base font-semibold">Season {displaySeason(PRIMARY_SEASON)}</h2><StatusBadge status={primary?.gate_state ?? 'BLOCKED'} dense /></div>
            <p className="mt-1 text-sm text-muted-foreground">All 2008 operational steps are handled here. No competition, dataset, date, or schema is entered manually.</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">Canonical season key: <span className="font-mono font-semibold text-foreground">{PRIMARY_SEASON}</span></div>
        </div>

        <div className="mt-density-lg grid grid-cols-1 gap-density-md md:grid-cols-2 xl:grid-cols-4">
          <StageCard step="1" title="Campaign" value={campaign ? campaign.status : 'PLANNED'} ready={!!campaign} />
          <StageCard step="2" title="Provider discovery" value={primary ? `${primary.supported_leagues}/${primary.provider_leagues} competitions` : 'Waiting'} ready={Number(primary?.provider_leagues ?? 0) > 0} />
          <StageCard step="3" title="Backfill jobs" value={primary ? `${primary.backfill_succeeded}/${primary.backfill_jobs} succeeded` : 'Not prepared'} ready={Number(primary?.backfill_jobs ?? 0) > 0} />
          <StageCard step="4" title="Pre-archive gate" value={primary?.gate_state ?? 'BLOCKED'} ready={Boolean(primary?.ready_for_archive)} />
        </div>

        <div className="mt-density-lg flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void discover2008()} disabled={discovering || loading}>
            <Send className="h-4 w-4" /> {discovering ? 'Requesting…' : 'Discover 2008'}
          </Button>
          <Button onClick={() => void prepare2008()} disabled={preparing || discovering || Number(primary?.provider_leagues ?? 0) === 0}>
            <Database className="h-4 w-4" /> {preparing ? 'Preparing…' : 'Prepare 2008'}
          </Button>
        </div>

        {!primary && <Notice icon={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />} title="2008 is not discovered yet." text="Run provider discovery first. The database creates the canonical season state; the UI never creates a second 2008 record." />}
        {primary?.ready_for_archive && <Notice icon={<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />} title="2008 passed the pre-archive gate." text="Archive creation is now permitted by the database guard. This page never creates archive objects itself." success />}
      </section>

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="mb-density-md flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Historical seasons</h2><p className="mt-1 text-sm text-muted-foreground">One row per numeric season. Provider registrations are unique server-side and deduplicated defensively here.</p></div><div className="text-xs text-muted-foreground">{seasons.length} unique seasons</div></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="px-3 py-2">Season</th><th className="px-3 py-2">Provider</th><th className="px-3 py-2">Backfill</th><th className="px-3 py-2">Gate</th><th className="px-3 py-2">Archive</th></tr></thead>
            <tbody>
              {seasons.map((row) => <tr key={row.season} className="border-b last:border-0"><td className="px-3 py-3 font-medium">{displaySeason(row.season)}</td><td className="px-3 py-3">{row.supported_leagues}/{row.provider_leagues}</td><td className="px-3 py-3"><div className="min-w-44"><ProgressBar value={Math.max(0, Math.min(100, Number(row.backfill_progress ?? 0)))} size="sm" /></div><div className="mt-1 text-xs text-muted-foreground">{row.backfill_succeeded}/{row.backfill_jobs} succeeded · {row.backfill_active} active · {row.backfill_failed} failed</div></td><td className="px-3 py-3"><StatusBadge status={row.gate_state} dense /></td><td className="px-3 py-3">{row.archive_succeeded}/{row.archive_campaigns}</td></tr>)}
              {!seasons.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No historical seasons available yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-density-lg lg:grid-cols-2">
        <QueueCard title="Backfill queue" rows={snapshot?.tranche_queue ?? []} />
        <QueueCard title="Archive output" rows={snapshot?.archive_output ?? []} />
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) { return <div><div className="text-xs uppercase text-muted-foreground">{label}</div><div className="mt-1 font-semibold">{value}</div></div> }

function StageCard({ step, title, value, ready }: { step: string; title: string; value: string; ready: boolean }) { return <div className="rounded-md border border-border/60 p-density-md"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold uppercase text-muted-foreground">Step {step}</span>{ready ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4 text-muted-foreground" />}</div><div className="mt-2 text-sm font-medium">{title}</div><div className="mt-1 text-xs text-muted-foreground">{value}</div></div> }

function Notice({ icon, title, text, success = false }: { icon: React.ReactNode; title: string; text: string; success?: boolean }) { return <div className={`mt-density-lg flex items-start gap-2 rounded-lg border p-density-md text-sm ${success ? 'border-success/40 bg-success/5' : 'border-warning/40 bg-warning/5'}`}>{icon}<div><div className="font-medium text-foreground">{title}</div><div className="mt-1 text-muted-foreground">{text}</div></div></div> }

function QueueCard({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm"><h2 className="text-base font-semibold">{title}</h2><div className="mt-4 space-y-2">{rows.slice(0, 8).map((row, i) => <div key={String(row.job_id ?? row.manifest_id ?? i)} className="rounded-md border border-border/60 p-3 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-medium">{String(row.dataset_type ?? 'record')}</span><StatusBadge status={String(row.status ?? '—')} dense /></div><div className="mt-1 text-muted-foreground">Season {String(row.season ?? '—')} · Requests {String(row.requests_used ?? '—')}</div></div>)}{!rows.length && <div className="py-6 text-center text-sm text-muted-foreground">No records.</div>}</div></section>
}
