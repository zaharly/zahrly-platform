import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CalendarClock, Gauge, XCircle } from 'lucide-react'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import {
  fetchHistoricalCampaignScheduleCheck,
  updateHistoricalCampaignSchedule,
  type HistoricalCampaignLive,
  type HistoricalCampaignScheduleCheck,
} from '../../integrations/archiveLive'

type SmartScheduleCheck = HistoricalCampaignScheduleCheck & {
  classification?: 'FEASIBLE' | 'TIGHT' | 'NOT_FEASIBLE'
  can_save?: boolean
  expected_finish_at?: string | null
  safe_finish_at?: string | null
  target_margin_minutes?: number | null
  remaining_requests_p50?: number | null
  remaining_requests_p90?: number | null
  capacity_requests_per_minute?: number | null
  recommended_target_end_at?: string | null
  remaining_today_capacity?: number | null
  future_daily_capacity?: number | null
  completed_request_samples?: number | null
  forecast_quality?: string | null
  blocking_reasons?: string[]
}

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
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: decimals })
}

function margin(value?: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  return `${n >= 0 ? '+' : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} min`
}

function classificationOf(check: SmartScheduleCheck | null) {
  if (!check) return 'NOT_FEASIBLE' as const
  if (check.classification) return check.classification
  return check.feasible ? 'FEASIBLE' as const : 'NOT_FEASIBLE' as const
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
  const [check, setCheck] = useState<SmartScheduleCheck | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    let targetIso = ''
    try {
      targetIso = isoFromLocal(targetEnd)
    } catch {
      if (!cancelled) {
        setCheck(null)
        setLoading(false)
      }
      return () => { cancelled = true }
    }
    setLoading(true)
    fetchHistoricalCampaignScheduleCheck(campaign.campaign_id, targetIso)
      .then((result) => {
        if (!cancelled) setCheck(result as SmartScheduleCheck)
      })
      .catch((error) => {
        if (!cancelled) {
          setCheck(null)
          toast.error(error instanceof Error ? error.message : 'Unable to validate target end')
        }
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
  const classification = classificationOf(check)
  const canSave = Boolean(check && (check.can_save ?? check.feasible) && classification !== 'NOT_FEASIBLE') && !unchanged

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      const result = await updateHistoricalCampaignSchedule(campaign.campaign_id, isoFromLocal(targetEnd))
      toast.success('Campaign schedule updated', {
        description: `Target end moved to ${fmtDate(result.campaign.minimum_target_end_at)}. Processing cadence will recalculate automatically.`,
      })
      onSaved(result.campaign)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update campaign schedule')
    } finally {
      setSaving(false)
    }
  }

  const statusTitle = classification === 'FEASIBLE' ? 'Target is feasible' : classification === 'TIGHT' ? 'Target is feasible, but tight' : 'Target is not feasible'
  const StatusIcon = classification === 'FEASIBLE' ? CheckCircle2 : classification === 'TIGHT' ? AlertTriangle : XCircle

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-background/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl rounded-xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Edit Campaign</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Target End is the execution deadline. Changing it changes the required processing cadence. The forecast checks the remaining workload against the current provider rate, backfill quota, production reserve and observed request cost before saving.</p>
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
                <p className="mt-1 text-[10px] text-muted-foreground">Started date is locked after execution starts.</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Target end</label>
                <input type="datetime-local" value={targetEnd} min={localDateTimeValue(new Date())} onChange={(e) => setTargetEnd(e.target.value)} disabled={saving} className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-xs" />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold">Execution forecast</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">Feasibility is recalculated on every Target End change. There is no fixed 60-day blocking rule here; the actual capacity determines whether the deadline can be met.</p>
              </div>
              {loading ? <span className="text-[11px] text-muted-foreground">Calculating…</span> : (
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold">
                  <StatusIcon className="h-3.5 w-3.5" /> {classification.replace('_', ' ')}
                </span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Remaining jobs" value={metric(check?.remaining_jobs)} />
              <Metric label="Remaining requests P50" value={metric(check?.remaining_requests_p50)} />
              <Metric label="Remaining requests P90" value={metric(check?.remaining_requests_p90)} />
              <Metric label="Available time" value={metric(check?.available_days, 2) + (check ? ' d' : '')} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Required req / min" value={metric(check?.required_requests_per_minute, 3)} />
              <Metric label="Safe capacity / min" value={metric(check?.capacity_requests_per_minute, 3)} />
              <Metric label="Backfill budget now" value={metric(check?.backfill_budget)} />
              <Metric label="Target margin" value={margin(check?.target_margin_minutes)} />
            </div>

            <div className="mt-4 grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-3">
              <Metric label="Expected finish (P50)" value={fmtDate(check?.expected_finish_at)} />
              <Metric label="Safe finish (P90)" value={fmtDate(check?.safe_finish_at)} />
              <Metric label="Recommended target" value={fmtDate(check?.recommended_target_end_at)} />
            </div>

            {check && check.blocking_reasons && check.blocking_reasons.length > 0 && (
              <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-destructive"><AlertTriangle className="h-4 w-4" /> Why this target is blocked</div>
                <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                  {check.blocking_reasons.map((reason) => <div key={reason}>• {reason}</div>)}
                </div>
                {check.recommended_target_end_at && <p className="mt-2 text-[11px] leading-5 text-muted-foreground">Recommended deadline: <strong>{fmtDate(check.recommended_target_end_at)}</strong></p>}
              </div>
            )}

            {check && classification !== 'NOT_FEASIBLE' && (
              <div className="mt-4 rounded-md border border-border bg-background p-3">
                <div className="flex items-center gap-2 text-xs font-semibold"><Gauge className="h-4 w-4" /> Cadence impact</div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  This deadline requires about <strong>{metric(check.required_requests_per_minute, 3)} requests/min</strong> against a current safe capacity of <strong>{metric(check.capacity_requests_per_minute, 3)} requests/min</strong>. The worker will not exceed provider or production-reserve limits.
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <div className="text-[11px] text-muted-foreground">Current target: <span className="font-medium text-foreground">{fmtDate(campaign.minimum_target_end_at)}</span></div>
          <div className="flex gap-2"><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving || loading || !canSave}>{saving ? 'Saving…' : 'Save target end'}</Button></div>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 truncate text-sm font-semibold">{value}</div></div>
}
