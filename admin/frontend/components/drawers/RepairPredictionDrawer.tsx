import { useState, type ReactNode } from 'react'
import { DetailDrawer } from '../drawers/DetailDrawer'
import { StatusBadge } from '../status/StatusBadge'
import { Button } from '../../lib/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { Label } from '../../lib/shadcn/label'
import type { Fixture, PredictionRecord, ProviderConflict } from '../../types/domain'
import { ShieldAlert, Wrench, Repeat, RefreshCw } from 'lucide-react'

const REPAIR_REASONS = [
  'Provider correction', 'Missing information', 'Identity issue', 'Incorrect provider mapping',
  'Invalid evidence', 'Consistency failure', 'Simulation failure', 'Read-model mismatch',
]

interface RepairPredictionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fixture: Fixture
  prediction: PredictionRecord | undefined
  conflicts: ProviderConflict[]
  evidenceCount: number
  onRevalidate: () => void
  onCreateRepairJob: (reason: string) => void
  onControlledReplay: () => void
  onRequestRecompute: () => void
}

/** Repair Prediction workflow: diagnostic panel plus the four governed repair actions. */
export function RepairPredictionDrawer({
  open, onOpenChange, fixture, prediction, conflicts, evidenceCount,
  onRevalidate, onCreateRepairJob, onControlledReplay, onRequestRecompute,
}: RepairPredictionDrawerProps) {
  const [reason, setReason] = useState(REPAIR_REASONS[0]!)

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Repair prediction"
      description={`${fixture.homeTeam} vs ${fixture.awayTeam} · Episode ${fixture.episodeId}`}
    >
      <div className="grid grid-cols-2 gap-density-md text-sm">
        <Fact label="Baseline" value={`${fixture.baselinePick} — ${fixture.baselineProbability}% (locked)`} />
        <Fact label="Current" value={`${fixture.currentProbability}%`} />
        <Fact label="Model version" value={fixture.modelVersion} />
        <Fact label="Policy version" value="sim-policy-v6" />
        <Fact label="Evidence sequence" value={`${evidenceCount} event(s)`} />
        <Fact label="Data quality" value={prediction ? <StatusBadge status={prediction.dataQuality} dense /> : '—'} />
      </div>

      <div>
        <div className="mb-density-sm text-xs uppercase text-muted-foreground">Source conflicts</div>
        {conflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open provider conflicts linked to this fixture.</p>
        ) : (
          <ul className="flex flex-col gap-density-sm">
            {conflicts.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-md border border-border p-density-sm text-sm">
                <span>{c.field}: {c.providerA} vs {c.providerB}</span>
                <StatusBadge status={c.state} dense />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Repair reason</Label>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{REPAIR_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-density-sm">
        <Button variant="outline" onClick={onRevalidate}>
          <ShieldAlert className="h-4 w-4" /> Revalidate data
        </Button>
        <Button variant="outline" onClick={() => onCreateRepairJob(reason)}>
          <Wrench className="h-4 w-4" /> Create repair job
        </Button>
        <Button variant="outline" onClick={onControlledReplay}>
          <Repeat className="h-4 w-4" /> Controlled replay
        </Button>
        <Button variant="outline" onClick={onRequestRecompute}>
          <RefreshCw className="h-4 w-4" /> Request evidence recompute
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">None of these actions modify the historical baseline value shown above.</p>
    </DetailDrawer>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium text-foreground">{value}</div>
    </div>
  )
}
