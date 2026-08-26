import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, XCircle } from 'lucide-react'
import { Button } from '../../lib/shadcn/button'
import { StatusBadge } from '../../components/status/StatusBadge'
import { toast } from '../../lib/shadcn/sonner'
import { fetchHistoricalBootstrapScope } from '../../integrations/historicalBootstrapScope'
import { fetchHistoricalCampaignPlan, prepareHistoricalSeason, startHistoricalCampaign, type HistoricalBootstrapScope, type HistoricalCampaignPlan } from '../../integrations/archiveLive'

type CreateStage = 'review' | 'preparing' | 'creating'

const MIN_SEASON = 2008
const MAX_SEASON = 2026
const seasonOptions = Array.from({ length: MAX_SEASON - MIN_SEASON + 1 }, (_, i) => MIN_SEASON + i)

function displaySeason(season: number) { return `${season}/${season + 1}` }
function numberValue(value?: number | null) { return value == null ? '—' : value.toLocaleString() }
function localDateTimeValue(date: Date) { const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16) }
function isoFromLocal(value: string) { return new Date(value).toISOString() }
function statusOf(dataset: { execution_supported: boolean; available_count: number; scope_count: number }) { if (!dataset.execution_supported || dataset.available_count === 0) return 'UNAVAILABLE'; if (dataset.available_count < dataset.scope_count) return 'PARTIAL'; return 'AVAILABLE' }

export default function HistoricalCampaignCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (season: number) => void }) {
  const [season, setSeason] = useState(2020)
  const [plannedStart, setPlannedStart] = useState(() => localDateTimeValue(new Date(Date.now() + 15 * 60000)))
  const [targetEnd, setTargetEnd] = useState(() => localDateTimeValue(new Date(Date.now() + 3 * 86400000)))
  const [scope, setScope] = useState<HistoricalBootstrapScope | null>(null)
  const [plan, setPlan] = useState<HistoricalCampaignPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState<CreateStage>('review')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([fetchHistoricalBootstrapScope(season), fetchHistoricalCampaignPlan(season, isoFromLocal(plannedStart), isoFromLocal(targetEnd))]).then(([resolvedScope, resolvedPlan]) => {
      if (cancelled) return
      setScope(resolvedScope)
      setPlan(resolvedPlan)
    }).catch((error) => { if (!cancelled) toast.error(error instanceof Error ? error.message : 'Unable to calculate campaign plan') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [season, plannedStart, targetEnd])

  const datasets = useMemo(() => plan?.dataset_plan ?? scope?.dataset_plan ?? [], [plan, scope])
  const processable = datasets.filter((d) => statusOf(d) !== 'UNAVAILABLE')
  const blocked = datasets.filter((d) => statusOf(d) === 'UNAVAILABLE')
  const hasExisting = Boolean(plan?.existing_campaign?.campaign_id)
  const infeasible = Boolean(plan && (!plan.fits_daily_budget || !plan.fits_provider_rate_limit || plan.available_league_count === 0 || hasExisting))
  const busy = stage !== 'review'

  async function create() {
    if (!plan || infeasible) return
    setStage('preparing')
    try {
      const prepared = await prepareHistoricalSeason(season, 100, isoFromLocal(plannedStart), isoFromLocal(targetEnd))
      if (prepared.status !== 'PREPARED') throw new Error(`No executable jobs were prepared for ${displaySeason(season)}.`)
      setStage('creating')
      await startHistoricalCampaign(season, season, isoFromLocal(plannedStart), isoFromLocal(targetEnd))
      toast.success(`Campaign ${displaySeason(season)} created`, { description: `${prepared.jobs_total.toLocaleString()} jobs prepared with the selected schedule.` })
      onCreated(season)
    } catch (error) { setStage('review'); toast.error(error instanceof Error ? error.message : 'Unable to create campaign') }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-background/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
    <div className="w-full max-w-5xl rounded-xl border border-border bg-card p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-semibold">Create Campaign</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Set the start and target completion time. The forecast is calculated before preparation so you can see the required requests/day and whether the window is feasible.</p></div><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Close</Button></div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[240px,1fr]">
        <section className="rounded-lg border border-border bg-background p-4"><label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Season</label><select value={season} onChange={(e) => setSeason(Number(e.target.value))} disabled={busy} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium">{seasonOptions.map((value) => <option key={value} value={value}>{displaySeason(value)}</option>)}</select><div className="mt-4 space-y-4"><div><label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Started date</label><input type="datetime-local" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} disabled={busy} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-xs" /></div><div><label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Target end</label><input type="datetime-local" value={targetEnd} min={plannedStart} onChange={(e) => setTargetEnd(e.target.value)} disabled={busy} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-xs" /></div></div></section>
        <div className="grid gap-4">
          <section className="rounded-lg border border-border p-4"><div className="flex items-center justify-between"><div><h3 className="text-xs font-semibold">Execution forecast</h3><p className="mt-1 text-[11px] text-muted-foreground">Estimated from resolved season scope and observed request cost per dataset.</p></div>{loading ? <span className="text-[11px] text-muted-foreground">Calculating…</span> : <StatusBadge status={infeasible ? 'BLOCKED' : 'READY'} dense />}</div><div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4"><Metric label="Days" value={plan ? plan.days.toFixed(2) : '—'} /><Metric label="Estimated jobs" value={numberValue(plan?.estimated_jobs)} /><Metric label="Requests/day" value={numberValue(plan?.estimated_requests_per_day)} /><Metric label="Jobs/day" value={numberValue(plan?.estimated_jobs_per_day)} /></div><div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4"><Metric label="Total requests" value={numberValue(plan?.estimated_requests)} /><Metric label="Required req/min" value={plan ? plan.required_requests_per_minute.toFixed(3) : '—'} /><Metric label="Daily budget" value={numberValue(plan?.daily_budget)} /><Metric label="Provider max/min" value={plan ? plan.provider_rate_limit_per_minute.toFixed(1) : '—'} /></div></section>
          <section className="rounded-lg border border-border p-4"><div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Metric label="Enabled countries" value={numberValue(plan?.enabled_country_count)} /><Metric label="Enabled leagues" value={numberValue(plan?.enabled_league_count)} /><Metric label="Available leagues" value={numberValue(plan?.available_league_count)} /><Metric label="Quota now" value={numberValue(plan?.quota_available_now)} /></div>{plan && (!plan.fits_daily_budget || !plan.fits_provider_rate_limit) && <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3"><div className="flex items-center gap-2 text-xs font-semibold"><AlertTriangle className="h-4 w-4" /> Selected window is not feasible</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{!plan.fits_daily_budget ? 'Required requests/day exceed the configured daily budget. ' : ''}{!plan.fits_provider_rate_limit ? 'Required requests/minute exceed the provider rate limit.' : ''}</p></div>}{hasExisting && <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-xs"><div className="font-semibold">Active campaign already exists</div><p className="mt-1 text-[11px] text-muted-foreground">This season already has an active/planned campaign. It will not be replaced or rescheduled from this dialog.</p></div>}</section>
          <section className="rounded-lg border border-border p-4"><div className="flex items-center gap-2"><Database className="h-4 w-4" /><h3 className="text-xs font-semibold">Dataset Plan</h3><span className="ml-auto text-[11px] text-muted-foreground">{processable.length} processable · {blocked.length} unavailable</span></div><div className="mt-3 overflow-hidden rounded-md border border-border"><div className="grid grid-cols-[1.6fr,0.9fr,80px,80px,100px] border-b bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><div>Dataset</div><div>Category</div><div>Avail.</div><div>Scope</div><div>Status</div></div><div className="max-h-[300px] overflow-auto">{datasets.map((d) => { const status = statusOf(d); return <div key={d.dataset_key} className="grid grid-cols-[1.6fr,0.9fr,80px,80px,100px] items-center gap-2 border-b px-3 py-2 last:border-0 text-xs"><div className="truncate font-medium">{d.label}</div><div className="truncate text-muted-foreground">{d.category}</div><div>{numberValue(d.available_count)}</div><div>{numberValue(d.scope_count)}</div><div><span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]">{status === 'AVAILABLE' ? <CheckCircle2 className="h-3 w-3" /> : status === 'PARTIAL' ? <AlertTriangle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{status}</span></div></div>})}</div></div></section>
        </div>
      </div>
      <div className="mt-5 rounded-lg border border-border bg-muted/20 px-4 py-3"><div className="flex items-center gap-3 text-xs font-semibold"><Stage active={stage === 'preparing'} done={stage === 'creating'} label="Prepare Jobs" /><span className="text-muted-foreground">→</span><Stage active={stage === 'creating'} done={false} label="Create Campaign" /></div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-[11px] leading-5 text-muted-foreground">Prepare creates/ensures the scheduled campaign record internally, prepares the jobs, then the Create step finalizes it. Start Bootstrap remains a separate explicit execution action.</p><div className="flex gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={() => void create()} disabled={busy || loading || infeasible}>{stage === 'preparing' ? 'Preparing jobs…' : stage === 'creating' ? 'Creating campaign…' : 'Prepare & Create Campaign'}</Button></div></div></div>
    </div>
  </div>
}

function Stage({ active, done, label }: { active: boolean; done: boolean; label: string }) { return <div className={`flex items-center gap-2 ${active || done ? 'text-foreground' : 'text-muted-foreground'}`}><span className="inline-flex h-6 w-6 items-center justify-center rounded-full border text-[10px]">{done ? '✓' : active ? '…' : '•'}</span>{label}</div> }
function Metric({ label, value }: { label: string; value: string }) { return <div><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 truncate text-sm font-semibold">{value}</div></div> }
