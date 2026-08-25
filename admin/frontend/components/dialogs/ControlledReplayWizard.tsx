import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import { Button } from '../../lib/shadcn/button'
import { Label } from '../../lib/shadcn/label'
import { Textarea } from '../../lib/shadcn/textarea'
import { Checkbox } from '../../lib/shadcn/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { StatusBadge } from '../status/StatusBadge'
import { useJobs } from '../../state/StoreContext'
import { CheckCircle2, Loader2 } from 'lucide-react'

const ISSUE_TYPES = ['Provider data correction', 'Missing source observation', 'Consistency failure', 'Simulation failure', 'Read-model mismatch', 'Identity/mapping issue']
const ARTIFACT_OPTIONS = ['Evidence sequence', 'Market matrix', 'Odds snapshot', 'Simulation run', 'Read model cache']

interface ControlledReplayWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subjectLabel: string
  episodeId?: string
  onConfirm: (reason: string, artifacts: string[]) => string
}

const JOB_STATUS_LABEL: Record<string, string> = {
  PENDING: 'QUEUED',
  RUNNING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
}

/** 5-step controlled replay review wizard shared across fixture/prediction repair workflows. */
export function ControlledReplayWizard({ open, onOpenChange, subjectLabel, episodeId, onConfirm }: ControlledReplayWizardProps) {
  const [step, setStep] = useState(1)
  const [issueType, setIssueType] = useState(ISSUE_TYPES[0]!)
  const [artifacts, setArtifacts] = useState<string[]>(['Evidence sequence'])
  const [reason, setReason] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const jobs = useJobs()
  const job = jobs.find((j) => j.id === jobId)

  function reset() {
    setStep(1)
    setIssueType(ISSUE_TYPES[0]!)
    setArtifacts(['Evidence sequence'])
    setReason('')
    setJobId(null)
  }

  function toggleArtifact(name: string) {
    setArtifacts((prev) => (prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name]))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Controlled replay — step {Math.min(step, 5)} of 5</DialogTitle>
          <DialogDescription>{subjectLabel}{episodeId ? ` · Episode ${episodeId}` : ''}</DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="flex flex-col gap-density-sm text-sm">
            <div className="rounded-md border border-border bg-muted/40 p-density-md">
              <div className="text-xs uppercase text-muted-foreground">Affected fixture / episode</div>
              <div className="mt-1 font-medium text-foreground">{subjectLabel}</div>
              {episodeId && <div className="text-muted-foreground">Episode {episodeId}</div>}
            </div>
            <p className="text-muted-foreground">This wizard creates a controlled replay job. It never rewrites historical job state or the immutable baseline.</p>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-1.5">
            <Label>Source or data issue</Label>
            <Select value={issueType} onValueChange={setIssueType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ISSUE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-density-sm">
            <Label>Affected artifacts</Label>
            {ARTIFACT_OPTIONS.map((name) => (
              <label key={name} className="flex items-center gap-2 rounded-md border border-border p-density-sm text-sm">
                <Checkbox checked={artifacts.includes(name)} onCheckedChange={() => toggleArtifact(name)} />
                {name}
              </label>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-density-sm text-sm">
            <div className="rounded-md border border-warning/30 zc-chip-warning p-density-md">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide">Expected impact</div>
              <ul className="list-disc space-y-1 pl-5">
                <li>Re-processes: {artifacts.length > 0 ? artifacts.join(', ') : 'no artifacts selected'}.</li>
                <li>Baseline remains immutable unless the episode lifecycle requires a new episode.</li>
                <li>Downstream consistency checks must pass before any linked incident can close.</li>
              </ul>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="replay-reason">Reason (required)</Label>
              <Textarea id="replay-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why is a controlled replay necessary?" />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="flex flex-col gap-density-md text-sm">
            <div className="rounded-md border border-border bg-muted/40 p-density-md">
              <div className="text-xs uppercase text-muted-foreground">Issue</div>
              <div className="font-medium text-foreground">{issueType}</div>
              <div className="mt-2 text-xs uppercase text-muted-foreground">Artifacts</div>
              <div className="font-medium text-foreground">{artifacts.join(', ') || 'none'}</div>
            </div>
            {!jobId ? (
              <p className="text-muted-foreground">Confirming will queue this replay to REPAIR_QUEUE with mock status progression.</p>
            ) : (
              <div className="flex items-center gap-density-sm rounded-md border border-border p-density-md">
                {job?.status === 'COMPLETED' ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <span>Job {jobId}</span>
                <StatusBadge status={JOB_STATUS_LABEL[job?.status ?? 'PENDING'] ?? 'QUEUED'} dense className="ml-auto" />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step > 1 && step < 5 && <Button variant="outline" onClick={() => setStep((s) => s - 1)}>Back</Button>}
          {step === 1 && <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>}
          {step < 4 && <Button onClick={() => setStep((s) => s + 1)}>Next</Button>}
          {step === 4 && <Button disabled={reason.trim().length < 4} onClick={() => setStep(5)}>Review</Button>}
          {step === 5 && !jobId && (
            <Button onClick={() => setJobId(onConfirm(reason, artifacts))}>Confirm replay</Button>
          )}
          {step === 5 && jobId && <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
