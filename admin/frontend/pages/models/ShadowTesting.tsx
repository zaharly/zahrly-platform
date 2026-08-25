import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { PromotionWizard } from '../../components/dialogs/PromotionWizard'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import { useShadowEvaluations, useModelVersions, useActiveModel, useStoreActions } from '../../state/StoreContext'
import type { ShadowVerdict } from '../../types/domain'
import { Eye } from 'lucide-react'

const VERDICT_TONE: Record<ShadowVerdict, 'success' | 'info' | 'critical' | 'muted'> = {
  CANDIDATE_BETTER: 'success',
  NO_MATERIAL_DIFFERENCE: 'info',
  REGRESSION: 'critical',
  NOT_ENOUGH_DATA: 'muted',
}

export default function ShadowTesting() {
  const shadowEvaluations = useShadowEvaluations()
  const modelVersions = useModelVersions()
  const activeModel = useActiveModel()
  const actions = useStoreActions()
  const [promoteEvalId, setPromoteEvalId] = useState<string | null>(null)

  const promoteEval = shadowEvaluations.find((s) => s.id === promoteEvalId) ?? null
  const promoteCandidate = promoteEval ? modelVersions.find((m) => m.id === promoteEval.candidateId) : undefined

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Shadow Testing"
        description="Candidate models run against live traffic in shadow before promotion. Promote opens a review wizard — it never changes production directly."
      />

      {shadowEvaluations.map((evalRun) => (
        <div key={evalRun.id} className="flex flex-col gap-density-md rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="flex flex-wrap items-center justify-between gap-density-sm">
            <div>
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-foreground">{evalRun.candidateVersion}</span>
                <span className="text-sm text-muted-foreground">vs incumbent {evalRun.incumbentVersion}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Day {evalRun.shadowDurationDays} · {evalRun.fixturesEvaluated.toLocaleString()} fixtures evaluated
              </div>
            </div>
            <div className="flex items-center gap-density-sm">
              <StatusBadge status={evalRun.verdict} tone={VERDICT_TONE[evalRun.verdict]} />
              <Button
                size="sm"
                disabled={evalRun.verdict === 'REGRESSION' || evalRun.verdict === 'NOT_ENOUGH_DATA'}
                onClick={() => setPromoteEvalId(evalRun.id)}
              >
                Promote for review
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-density-sm sm:grid-cols-6">
            <Metric label="Log Loss" value={evalRun.logLoss.toFixed(3)} />
            <Metric label="Brier" value={evalRun.brier.toFixed(3)} />
            <Metric label="RPS" value={evalRun.rps.toFixed(3)} />
            <Metric label="ECE" value={evalRun.ece.toFixed(3)} />
            <Metric label="CLV" value={evalRun.clv.toFixed(1)} />
            <Metric label="Abstention" value={`${evalRun.abstentionRatePct}%`} />
          </div>

          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={evalRun.timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'Shadow day', position: 'insideBottom', offset: -2, fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="candidateLogLoss" name="Candidate Log Loss" stroke="hsl(var(--model))" strokeWidth={2} />
                <Line type="monotone" dataKey="incumbentLogLoss" name="Incumbent Log Loss" stroke="hsl(var(--chart-2))" strokeWidth={2} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}

      {promoteCandidate && (
        <PromotionWizard
          open={!!promoteEvalId}
          onOpenChange={(o) => !o && setPromoteEvalId(null)}
          candidate={promoteCandidate}
          incumbent={activeModel}
          shadowEvaluation={promoteEval ?? undefined}
          onApprove={(reason) => {
            actions.approvePromotion(promoteCandidate.id, reason)
            toast.success(`${promoteCandidate.family} ${promoteCandidate.version} promoted to production`)
          }}
        />
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-density-sm text-center">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}
