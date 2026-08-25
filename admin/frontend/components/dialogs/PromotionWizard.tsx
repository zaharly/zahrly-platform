import { useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import { Button } from '../../lib/shadcn/button'
import { Label } from '../../lib/shadcn/label'
import { Textarea } from '../../lib/shadcn/textarea'
import { StatusBadge } from '../status/StatusBadge'
import type { ModelVersion, ShadowEvaluation } from '../../types/domain'
import { CheckCircle2, XCircle } from 'lucide-react'

interface PromotionWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidate: ModelVersion
  incumbent: ModelVersion | undefined
  shadowEvaluation: ShadowEvaluation | undefined
  onApprove: (reason: string) => void
}

function computeValidationChecks(candidate: ModelVersion) {
  return [
    { label: 'Calibration is strong or moderate', passed: candidate.calibration !== 'weak' },
    { label: 'Drift is healthy or watch (not warning/critical)', passed: candidate.drift === 'healthy' || candidate.drift === 'warning' ? candidate.drift === 'healthy' : true },
    { label: 'ECE within governance threshold (\u2264 0.035)', passed: candidate.metrics.ece <= 0.035 },
    { label: 'CLV non-negative', passed: candidate.metrics.clv >= 0 },
  ]
}

/** Model promotion governance wizard: Candidate → Validation → Shadow Results → Risk Review → Approval → Confirmation. */
export function PromotionWizard({ open, onOpenChange, candidate, incumbent, shadowEvaluation, onApprove }: PromotionWizardProps) {
  const [step, setStep] = useState(1)
  const [reason, setReason] = useState('')
  const [approved, setApproved] = useState(false)
  const isFamilyChange = incumbent ? incumbent.family !== candidate.family : false
  const checks = computeValidationChecks(candidate)
  const allChecksPass = checks.every((c) => c.passed)

  function reset() {
    setStep(1)
    setReason('')
    setApproved(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Promote {candidate.family} {candidate.version} — step {Math.min(step, 6)} of 6</DialogTitle>
          <DialogDescription>Every gate must pass before this candidate can become the active production model.</DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="grid grid-cols-2 gap-density-md text-sm">
            <Detail label="Candidate" value={`${candidate.family} ${candidate.version}`} />
            <Detail label="Status" value={<StatusBadge status={candidate.status} dense />} />
            <Detail label="Training cutoff" value={candidate.trainingCutoff} />
            <Detail label="Features" value={String(candidate.features)} />
            <Detail label="Current active model" value={incumbent ? `${incumbent.family} ${incumbent.version}` : 'none'} />
            {isFamilyChange && <Detail label="Family change" value="Yes — requires second approval" />}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-density-sm">
            <Label>Validation gates</Label>
            {checks.map((c) => (
              <div key={c.label} className="flex items-center gap-2 rounded-md border border-border p-density-sm text-sm">
                {c.passed ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                {c.label}
              </div>
            ))}
            {!allChecksPass && <p className="text-xs text-destructive">One or more validation gates failed — promotion cannot proceed until resolved.</p>}
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-density-sm text-sm">
            <Label>Shadow results</Label>
            {shadowEvaluation ? (
              <div className="grid grid-cols-3 gap-density-sm">
                <Detail label="Verdict" value={<StatusBadge status={shadowEvaluation.verdict} tone={shadowEvaluation.verdict === 'CANDIDATE_BETTER' ? 'success' : shadowEvaluation.verdict === 'REGRESSION' ? 'critical' : 'info'} dense />} />
                <Detail label="Log Loss" value={shadowEvaluation.logLoss.toFixed(3)} />
                <Detail label="CLV" value={shadowEvaluation.clv.toFixed(1)} />
                <Detail label="Fixtures evaluated" value={shadowEvaluation.fixturesEvaluated.toLocaleString()} />
                <Detail label="Shadow duration" value={`${shadowEvaluation.shadowDurationDays} days`} />
                <Detail label="Abstention rate" value={`${shadowEvaluation.abstentionRatePct}%`} />
              </div>
            ) : (
              <p className="text-muted-foreground">No shadow evaluation on record — promoting without a shadow run is a higher-risk path.</p>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-density-sm">
            <Label htmlFor="promotion-reason">Risk review notes (required)</Label>
            <Textarea id="promotion-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="Summarize risk, rollback plan, and monitoring approach…" />
          </div>
        )}

        {step === 5 && (
          <div className="flex flex-col gap-density-sm text-sm">
            <div className="rounded-md border border-warning/30 zc-chip-warning p-density-md">
              {isFamilyChange
                ? 'This is a model-family change and requires a second approver before it takes effect.'
                : 'This promotion requires standard model-admin approval.'}
            </div>
            <label className="flex items-center gap-2 rounded-md border border-border p-density-sm">
              <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
              I have reviewed the validation gates, shadow results, and risk notes, and approve this promotion.
            </label>
          </div>
        )}

        {step === 6 && (
          <div className="rounded-md border border-border bg-muted/40 p-density-md text-sm">
            <div className="text-xs uppercase text-muted-foreground">Ready to confirm</div>
            <p className="mt-1 text-foreground">{candidate.family} {candidate.version} will become the active production model. {incumbent && `${incumbent.family} ${incumbent.version} will be retired.`}</p>
          </div>
        )}

        <DialogFooter>
          {step > 1 && <Button variant="outline" onClick={() => setStep((s) => s - 1)}>Back</Button>}
          {step === 1 && <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>}
          {step < 4 && <Button disabled={step === 2 && !allChecksPass} onClick={() => setStep((s) => s + 1)}>Next</Button>}
          {step === 4 && <Button disabled={reason.trim().length < 8} onClick={() => setStep(5)}>Next</Button>}
          {step === 5 && <Button disabled={!approved} onClick={() => setStep(6)}>Next</Button>}
          {step === 6 && <Button onClick={() => { onApprove(reason); onOpenChange(false); reset() }}>Confirm promotion</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium text-foreground">{value}</div>
    </div>
  )
}
