import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, HeartPulse, History, ListOrdered, Siren, Gift, BadgeDollarSign, Zap, Medal, Radar, Trophy, ArrowRight, RefreshCw } from 'lucide-react'
import { PageHeader } from '../components/layout/PageHeader'
import { MetricCard } from '../components/dashboard/MetricCard'
import { StatusBadge } from '../components/status/StatusBadge'
import { ProgressBar } from '../components/status/ProgressBar'
import { fetchHistoricalBootstrapSnapshot, type HistoricalBootstrapSnapshot, type HistoricalSeasonProgress } from '../integrations/archiveLive'
import { supabase } from '../lib/supabase'

function numberValue(value?: number | null) { return value == null ? '—' : Number(value).toLocaleString() }
function progressValue(row?: HistoricalSeasonProgress | null) { if (!row || row.backfill_jobs <= 0) return 0; return Math.max(0, Math.min(100, ((row.backfill_succeeded + row.backfill_failed) / row.backfill_jobs) * 100)) }
function seasonStatus(row: HistoricalSeasonProgress) { if (row.gate_state) return row.gate_state; if (row.backfill_failed > 0 && row.backfill_active === 0 && row.backfill_succeeded + row.backfill_failed >= row.backfill_jobs) return 'COMPLETED_WITH_FAILURES'; if (row.backfill_active > 0) return 'RUNNING'; if (row.backfill_succeeded >= row.backfill_jobs && row.backfill_jobs > 0) return 'READY'; if (row.backfill_jobs > 0) return 'QUEUED'; return 'DRAFT' }
function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) { return <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm"><div className="mb-density-md flex items-center justify-between"><h2 className="text-base font-semibold">{title}</h2>{action}</div>{children}</section> }
function CountRow({ name, count, path, status }: { name: string; count: number | string; path: string; status?: string }) { return <Link to={path} className="flex items-center justify-between rounded-md border border-border p-3 transition-colors hover:bg-muted/40"><div><div className="font-medium">{name}</div>{status && <div className="mt-1 text-xs text-muted-foreground">{status}</div>}</div><div className="flex items-center gap-2"><span className="text-lg font-semibold">{count}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /></div></Link> }

export default function Dashboard() {
  const [live, setLive] = useState<Record<string, any>>({})
  const [historical, setHistorical] = useState<HistoricalBootstrapSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    try {
      setError(null)
      const count = async (table: string, filter?: { column: string; value: string }) => { let q = supabase.from(table).select('*', { count: 'exact', head: true }); if (filter) q = q.eq(filter.column, filter.value); const { count, error } = await q; if (error) throw error; return count ?? 0 }
      const [{ count: bonuses }, { count: activeBonuses }, { count: giveaways }, { count: activeGiveaways }, { count: pickrush }, { count: openPickrush }, { count: prizePools }, { count: processingPools }, { count: bookmakers }, { count: criticalBookmakers }, { count: reports }, { count: unresolvedIncidents }, board] = await Promise.all([
        count('bonuses'), count('bonuses', { column: 'status', value: 'active' }), count('giveaways'), count('giveaways', { column: 'status', value: 'active' }), count('pickrush_contests'), count('pickrush_contests', { column: 'status', value: 'open' }), count('prize_pool_campaigns'), count('prize_pool_campaigns', { column: 'status', value: 'processing' }), count('bookmakers_radar'), count('bookmakers_radar', { column: 'risk_level', value: 'critical' }), count('bookmaker_reports', { column: 'status', value: 'submitted' }), count('bookmaker_incidents', { column: 'resolution_status', value: 'unresolved' }), supabase.rpc('get_leaderboard_count')
      ])
      setLive({ bonuses, activeBonuses, giveaways, activeGiveaways, pickrush, openPickrush, prizePools, processingPools, bookmakers, criticalBookmakers, reports, unresolvedIncidents, leaderboard: Number(board.data ?? 0) })
      setHistorical(await fetchHistoricalBootstrapSnapshot())
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load dashboard data') }
  }
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 30000); return () => window.clearInterval(t) }, [])
  const seasons = useMemo(() => { const map = new Map<number, HistoricalSeasonProgress>(); for (const s of historical?.seasons ?? []) map.set(Number(s.season), s); return [...map.values()].sort((a,b) => b.season-a.season).slice(0,7) }, [historical?.seasons])
  const campaign = historical?.campaign ?? {}
  const season = seasons[0]
  const campaignProgress = progressValue(season)
  const validationOk = Boolean(campaign.last_successful_watermark && (campaign.last_successful_watermark as Record<string, unknown>).validation_ok === true)
  return <div className="flex flex-col gap-density-xl">
    <PageHeader title="Command Center" description="Live platform health plus Rewards, Challenges and Discover control surfaces. Data below comes from Supabase, not dashboard mocks." actions={<button onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted/40"><RefreshCw className="h-4 w-4"/>Refresh</button>}/>
    <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
      <MetricCard label="Bonuses" value={live.bonuses ?? '—'} icon={BadgeDollarSign} tone={(live.activeBonuses ?? 0) > 0 ? 'success' : 'default'} sublabel={`${live.activeBonuses ?? 0} active`} onClick={() => window.location.assign('/bonuses')} />
      <MetricCard label="Giveaways" value={live.giveaways ?? '—'} icon={Gift} tone={(live.activeGiveaways ?? 0) > 0 ? 'success' : 'default'} sublabel={`${live.activeGiveaways ?? 0} active`} onClick={() => window.location.assign('/giveaways')} />
      <MetricCard label="Pick Rush" value={live.pickrush ?? '—'} icon={Zap} tone={(live.openPickrush ?? 0) > 0 ? 'success' : 'default'} sublabel={`${live.openPickrush ?? 0} open`} onClick={() => window.location.assign('/pickrush')} />
      <MetricCard label="Prize Pool" value={live.prizePools ?? '—'} icon={Medal} tone={(live.processingPools ?? 0) > 0 ? 'info' : 'default'} sublabel={`${live.processingPools ?? 0} processing`} onClick={() => window.location.assign('/prizepool')} />
      <MetricCard label="Bookmakers Radar" value={live.bookmakers ?? '—'} icon={Radar} tone={(live.criticalBookmakers ?? 0) > 0 ? 'critical' : 'success'} sublabel={`${live.criticalBookmakers ?? 0} critical risk`} onClick={() => window.location.assign('/bookmakersradar')} />
      <MetricCard label="Leaderboard" value={live.leaderboard ?? '—'} icon={Trophy} tone="model" sublabel="players in live ranking" onClick={() => window.location.assign('/leaderboards')} />
      <MetricCard label="Reports" value={live.reports ?? '—'} icon={Siren} tone={(live.reports ?? 0) > 0 ? 'warning' : 'success'} sublabel="submitted bookmaker reports" onClick={() => window.location.assign('/bookmakersradar')} />
      <MetricCard label="Open Incidents" value={live.unresolvedIncidents ?? '—'} icon={HeartPulse} tone={(live.unresolvedIncidents ?? 0) > 0 ? 'warning' : 'success'} sublabel="unresolved bookmaker incidents" onClick={() => window.location.assign('/bookmakersradar')} />
    </div>
    <div className="grid grid-cols-1 gap-density-lg xl:grid-cols-2">
      <Card title="Rewards & Promotions" action={<Link to="/bonuses" className="text-sm font-medium hover:underline">Open management</Link>}><div className="grid gap-2"><CountRow name="Bonuses" count={live.bonuses ?? '—'} status={`${live.activeBonuses ?? 0} active`} path="/bonuses"/><CountRow name="Giveaways" count={live.giveaways ?? '—'} status={`${live.activeGiveaways ?? 0} active`} path="/giveaways"/></div></Card>
      <Card title="Challenges" action={<Link to="/pickrush" className="text-sm font-medium hover:underline">Open challenges</Link>}><div className="grid gap-2"><CountRow name="Pick Rush contests" count={live.pickrush ?? '—'} status={`${live.openPickrush ?? 0} open`} path="/pickrush"/><CountRow name="Prize Pool campaigns" count={live.prizePools ?? '—'} status={`${live.processingPools ?? 0} processing`} path="/prizepool"/></div></Card>
      <Card title="Discover" action={<Link to="/bookmakersradar" className="text-sm font-medium hover:underline">Open Discover</Link>}><div className="grid gap-2"><CountRow name="Bookmakers Radar" count={live.bookmakers ?? '—'} status={`${live.criticalBookmakers ?? 0} critical risk`} path="/bookmakersradar"/><CountRow name="Leaderboards" count={live.leaderboard ?? '—'} status="live player ranking" path="/leaderboards"/></div></Card>
      <Card title="Historical Bootstrap" action={<Link to="/bootstrap" className="text-sm font-medium hover:underline">Open control center</Link>}><div className="grid gap-density-md sm:grid-cols-2"><MetricCard label="Current season" value={season ? `${season.season}/${season.season + 1}` : '—'} icon={History} tone={String(campaign.status ?? '').toUpperCase() === 'RUNNING' ? 'info' : validationOk ? 'success' : 'warning'} sublabel={`${campaignProgress.toFixed(1)}% · ${numberValue(campaign.requests_used)} requests`} /><div className="rounded-lg border border-border p-density-lg"><div className="text-xs uppercase tracking-wide text-muted-foreground">Validation</div><div className="mt-1 text-xl font-semibold">{validationOk ? 'PASSED' : 'NOT PASSED'}</div><div className="mt-3"><ProgressBar value={campaignProgress} showValue size="sm" tone={campaignProgress >= 95 ? 'success' : campaignProgress >= 50 ? 'warning' : 'critical'}/></div></div></div></Card>
    </div>
    <Card title="Production & ingestion"><div className="grid grid-cols-2 gap-density-md md:grid-cols-4"><CountRow name="Prediction Monitor" count="Open" status="prediction production" path="/predictions"/><CountRow name="Queues" count="Control" status="workers and pipelines" path="/workers/queues"/><CountRow name="Providers" count="Monitor" status="provider health and capabilities" path="/providers"/><CountRow name="Incidents" count="Review" status="operational incident center" path="/incidents"/></div></Card>
    {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
  </div>
}
