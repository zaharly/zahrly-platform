import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CalendarClock } from 'lucide-react'
import { Button } from '../../lib/shadcn/button'
import { StatusBadge } from '../../components/status/StatusBadge'
import { toast } from '../../lib/shadcn/sonner'
import {
  fetchHistoricalCampaignScheduleCheck,
  updateHistoricalCampaignSchedule,
  type HistoricalCampaignLive,
  type HistoricalCampaignScheduleCheck,
} from '../../integrations/archiveLive'

function localDateTimeValue(value: string) {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function isoFromLocal(value: string) {
  return new Date(value).toISOString()
}

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

function metric(value?: number | null, decimals = 0) {
  if (value == null) return '—'
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: decimals })
}

export default function HistoricalCampaignEditDialog({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: HistoricalCampaignLive
  onClose: () => void
  onSaved: (campaign: HistoricalCampaignLive) => void
}) {
  const [targetEnd, setTargetEnd] = useState(() => localDateTimeValue(campaign.minimum_target_end_at))
  const [check, setCheck] = useState<HistoricalCampaignScheduleCheck | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const targetIso = isoFromLocal(targetEnd)
    setLoading(true)
    fetchHistoricalCampaignScheduleCheck(campaign.campaign_id, targetIso)
      .then((result) => {
        if (!cancelled) setCheck(result)
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'Unable to validate target end')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [campaign.campaign_id, targetEnd])

  const unchanged = useMemo(
    () => new Date(targetEnd).getTime() === new Date(campaign.minimum_target_end_at).getTime(),
    [campaign.minimum_target_end_at, targetEnd],
  )
  const infeasible = Boolean(check && !check.feasible)

  async function save() {
    if (!check?.feasible || unchanged) return
    setSaving(true)
    try {
      const result = await updateHistoricalCampaignSchedule(campaign.campaign_id, isoFromLocal(targetEnd))
      toast.success('Campaign schedule updated', {
        description: `Target end moved to ${fmtDate(result.campaign.minimum_target_end_at)}. Queue cadence will recalculate automatically.`,
      })
      onSaved(result.campaign)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update campaign schedule')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-background/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Edit Campaign</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Change the target completion time. The schedule is checked against the remaining jobs, observed request cost, daily quota and provider rate limits before saving.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Close</Button>
        </div>

        <div className="mt-5 grid gap-4">
          <section className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-xs font-semibold"><CalendarClock className="h-4 w-4" /> Campaign schedule</div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Started date</label>
                <div className="mt-2 rounded-md border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">{fmtDate(campaign.planned_start_at)}</div>
                <p className="mt-1 text-[10px] text-muted-foreground">Started date is locked once the campaign is running.</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Target end</label>
                <input type="datetime-local" value={targetEnd} min={new Date().toISOString().slice(0, 16)} onChange={(e) => setTargetEnd(e.target.value)} disabled={saving} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-xs" />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold">Feasibility</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">The target end controls the required processing cadence; the limits below are hard safety ceilings.</p>
              </div>
              {loading ? <span className="text-[11px] text-muted-foreground">Checking…</span> : <StatusBadge status={infeasible ? 'BLOCKED' : 'READY'} dense />}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Remaining jobs" value={metric(check?.remaining_jobs)} />
              <Metric label="Estimated requests" value={metric(check?.estimated_requests)} />
              <Metric label="Days available" value={metric(check?.available_days, 2)} />
              <Metric label="Requests / day" value={metric(check?.required_requests_per_day, 1)} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Requests / min" value={metric(check?.required_requests_per_minute, 3)} />
              <Metric label="Safety cap / min" value={metric(check?.safety_rate_limit_per_minute)} />
              <Metric label="Provider max / min" value={check?.provider_rate_limit_per_minute ? metric(check.provider_rate_limit_per_minute) : 'Dynamic'} />
              <Metric label="Backfill budget" value={metric(check?.backfill_budget)} />
            </div>

            {check && infeasible && (
              <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-destructive"><AlertTriangle className="h-4 w-4" /> Target end is too early</div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  The remaining workload would require more throughput than the current API-Sports plan safely allows. The earliest feasible target is <strong>{fmtDate(check.minimum_target_end_at)}</strong>.
                </p>
              </div>
            )}

            {check && !infeasible && !unchanged && (
              <div className="mt-4 rounded-md border border-emerald-300/40 bg-emerald-500/5 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold"><CheckCircle2 className="h-4 w-4" /> Schedule is feasible</div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">The queue will recalculate its cadence from the new target end without bypassing the 200 requests/min safety cap or daily quota limits.</p>
              </div>
            )}
          </section>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <div className="text-[11px] text-muted-foreground">Current target: <span className="font-medium text-foreground">{fmtDate(campaign.minimum_target_end_at)}</span></div>
          <div className="flex gap-2"><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving || loading || !check?.feasible || unchanged}>{saving ? 'Saving…' : 'Save schedule'}</Button></div>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 truncate text-sm font-semibold">{value}</div></div>
}
