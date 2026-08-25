import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, RefreshCw, Send, Pause, ListChecks, Archive } from 'lucide-react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { Button } from '../../lib/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { toast } from '../../lib/shadcn/sonner'
import {
  fetchHistoricalBootstrapSnapshot,
  startHistoricalCampaign,
  triggerProviderSeason,
  type HistoricalBootstrapSnapshot,
} from '../../integrations/archiveLive'

const START_SEASON = 2008
const END_SEASON = 2026
const candidateSeasons = Array.from({ length: END_SEASON - START_SEASON + 1 }, (_, index) => START_SEASON + index)

export default function ProviderSeasonControl() {
  const [season, setSeason] = useState('2008')
  const [snapshot, setSnapshot] = useState<HistoricalBootstrapSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [campaignStarting, setCampaignStarting] = useState(false)
  const [triggering, setTriggering] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setSnapshot(await fetchHistoricalBootstrapSnapshot())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load historical bootstrap state')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const campaign = snapshot?.campaign && 'campaign_id' in snapshot.campaign ? snapshot.campaign : null
  const selectedProgress = snapshot?.seasons.find((row) => row.season === Number(season)) ?? null
  const quota = snapshot?.quota ?? {}

  async function ensureCampaign() {
    if (campaign) return campaign
    setCampaignStarting(true)
    try {
      const created = await startHistoricalCampaign(START_SEASON, END_SEASON)
      toast.success(`Historical campaign ready: ${START_SEASON}–${END_SEASON}`)
      await load()
      return created
    } finally {
      setCampaignStarting(false)
    }
  }

  async function pullSelectedSeason() {
    const selected = Number(season)
    setTriggering(true)
    try {
      await ensureCampaign()
      await triggerProviderSeason(selected)
      toast.success(`Season ${selected} pull requested`)
      window.setTimeout(() => void load(), 1500)
      window.setTimeout(() => void load(), 5000)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to request season pull')
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="flex flex-col gap-density-xl">
      <PageHeader
        title="Historical Bootstrap"
        description="Long-running historical campaign control plane. Campaign tracking, season pull requests, quota reserve, tranche queue, blocked scopes, and archive outputs are live state from Supabase."
        tag={<StatusBadge status={loading ? 'LOADING' : campaign ? campaign.status : 'PLANNED'} />}
        actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="flex items-start gap-density-md">
          <Database className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1">
            <h2 className="text-base font-semibold">Historical campaign</h2>
            <p className="mt-1 text-sm text-muted-foreground">The historical campaign is a separate long-running operation. The current contract targets {START_SEASON}–{END_SEASON} and keeps production quota reserve separate from backfill usage.</p>
            <div className="mt-density-lg grid grid-cols-2 gap-3 md:grid-cols-4 text-sm">
              <Metric label="Campaign" value={campaign?.status ?? 'Not started'} />
              <Metric label="Range" value={campaign ? `${campaign.target_start_season}–${campaign.target_end_season}` : `${START_SEASON}–${END_SEASON}`} />
              <Metric label="Completeness" value={`${((Number(campaign?.completeness_score ?? 0)) * 100).toFixed(1)}%`} />
              <Metric label="Requests used" value={String(campaign?.requests_used ?? 0)} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => void ensureCampaign()} disabled={campaignStarting || !!campaign}>{campaignStarting ? 'Starting…' : campaign ? <><CheckCircle2 className="h-4 w-4" /> Campaign ready</> : 'Start 2008–2026 campaign'}</Button>
              {campaign && <div className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground"><Pause className="h-3.5 w-3.5" /> Pausing/reprioritizing remains an audited control action on the campaign queue.</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="flex items-start justify-between gap-density-md">
          <div>
            <h2 className="text-base font-semibold">Request season pull</h2>
            <p className="mt-1 text-sm text-muted-foreground">Select one historical season. The worker asks API-Football for the season's leagues and persists countries, competitions, processing controls, and provider capabilities. It does not treat a workflow HTTP 202/accepted response as persistence.</p>
          </div>
          <Send className="h-5 w-5" />
        </div>
        <div className="mt-density-lg grid grid-cols-1 gap-density-md md:grid-cols-[minmax(0,320px)_auto] md:items-end">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Season</label>
            <Select value={season} onValueChange={setSeason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{candidateSeasons.map((value) => <SelectItem key={value} value={String(value)}>{value}/{value + 1}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={() => void pullSelectedSeason()} disabled={triggering || campaignStarting}>
            <Send className="h-4 w-4" /> {triggering ? 'Requesting…' : `Pull ${season}`}
          </Button>
        </div>
        <div className="mt-density-lg rounded-lg border border-border/60 bg-muted/20 p-density-md text-sm">
          <div className="font-medium">Live state for {season}</div>
          {selectedProgress ? <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Provider leagues" value={`${selectedProgress.supported_leagues}/${selectedProgress.provider_leagues}`} />
            <Metric label="Backfill" value={`${selectedProgress.backfill_progress}%`} />
            <Metric label="Archive campaigns" value={`${selectedProgress.archive_succeeded}/${selectedProgress.archive_campaigns}`} />
            <Metric label="Archive completeness" value={`${(Number(selectedProgress.archive_completeness) * 100).toFixed(1)}%`} />
          </div> : <div className="mt-2 flex items-center gap-2 text-muted-foreground"><AlertTriangle className="h-4 w-4" /> No live provider capability rows yet for this season.</div>}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-density-lg lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm lg:col-span-2">
          <div className="flex items-center gap-2"><ListChecks className="h-5 w-5" /><h2 className="text-base font-semibold">Season progress</h2></div>
          <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="px-3 py-2">Season</th><th className="px-3 py-2">Provider</th><th className="px-3 py-2">Backfill</th><th className="px-3 py-2">Archive</th><th className="px-3 py-2">Completeness</th></tr></thead><tbody>{(snapshot?.seasons ?? []).map((row) => <tr key={row.season} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{row.season}/{row.season + 1}</td><td className="px-3 py-2">{row.supported_leagues}/{row.provider_leagues}</td><td className="px-3 py-2">{row.backfill_progress}% · {row.backfill_succeeded}/{row.backfill_jobs}</td><td className="px-3 py-2">{row.archive_succeeded}/{row.archive_campaigns}</td><td className="px-3 py-2"><Progress value={Number(row.archive_completeness) * 100} /></td></tr>)}{!snapshot?.seasons?.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No season progress yet.</td></tr>}</tbody></table></div>
        </div>

        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <h2 className="text-base font-semibold">Quota allocation</h2>
          <div className="mt-4 space-y-3 text-sm">
            <Metric label="Provider" value={String(quota.provider ?? '—')} />
            <Metric label="Daily budget" value={String(quota.daily_budget ?? '—')} />
            <Metric label="Used" value={String(quota.quota_used ?? '—')} />
            <Metric label="Protected production" value={String(quota.protected_production_budget ?? '—')} />
            <Metric label="Backfill budget" value={String(quota.backfill_budget ?? '—')} />
            <Metric label="Reserve policy" value={String(quota.reserve_policy_version ?? '—')} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-density-lg lg:grid-cols-2">
        <QueueCard title="Current tranche / queue" icon={<ListChecks className="h-5 w-5" />} rows={snapshot?.tranche_queue ?? []} />
        <QueueCard title="Archive output" icon={<Archive className="h-5 w-5" />} rows={snapshot?.archive_output ?? []} />
      </section>

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <h2 className="text-base font-semibold">Blocked scopes</h2>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="px-3 py-2">Scope</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Updated</th></tr></thead><tbody>{(snapshot?.blocked_scopes ?? []).map((row, i) => <tr key={String(row.scope_id ?? i)} className="border-b last:border-0"><td className="px-3 py-2">{String(row.scope_type ?? '—')}</td><td className="px-3 py-2"><StatusBadge status={String(row.state ?? '—')} dense /></td><td className="px-3 py-2 text-muted-foreground">{String(row.reason ?? '—')}</td><td className="px-3 py-2 text-muted-foreground">{row.updated_at ? new Date(String(row.updated_at)).toLocaleString() : '—'}</td></tr>)}{!snapshot?.blocked_scopes?.length && <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No blocked scopes.</td></tr>}</tbody></table></div>
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) { return <div><div className="text-xs uppercase text-muted-foreground">{label}</div><div className="mt-1 font-semibold">{value}</div></div> }
function Progress({ value }: { value: number }) { return <div className="flex min-w-28 flex-col gap-1"><span className="text-xs font-medium">{value.toFixed(1)}%</span><div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-foreground" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div></div> }
function QueueCard({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: Array<Record<string, unknown>> }) {
  return <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm"><div className="flex items-center gap-2">{icon}<h2 className="text-base font-semibold">{title}</h2></div><div className="mt-4 space-y-2">{rows.slice(0, 8).map((row, i) => <div key={String(row.job_id ?? row.manifest_id ?? i)} className="rounded-md border border-border/60 p-3 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-medium">{String(row.dataset_type ?? 'archive output')}</span><StatusBadge status={String(row.status ?? '—')} dense /></div><div className="mt-1 text-muted-foreground">Season {String(row.season ?? '—')} · Requests {String(row.requests_used ?? '—')} · {row.object_uri ? String(row.object_uri) : 'No object yet'}</div></div>)}{!rows.length && <div className="py-6 text-center text-sm text-muted-foreground">No records.</div>}</div></div>
}
