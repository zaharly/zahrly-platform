import { useEffect, useState, type ReactNode } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { Timeline } from '../../components/timeline/Timeline'
import { AddEvidenceDialog } from '../../components/dialogs/AddEvidenceDialog'
import { OpenIncidentDialog } from '../../components/dialogs/OpenIncidentDialog'
import { ControlledReplayWizard } from '../../components/dialogs/ControlledReplayWizard'
import { RepairPredictionDrawer } from '../../components/drawers/RepairPredictionDrawer'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import {
  usePredictions, useFixtureById, useEvidenceForFixture, useProviderConflicts, useStoreActions,
} from '../../state/StoreContext'
import { MARKETS } from '../../mock/data/markets'
import { PlusCircle, ScrollText, Lock, ArrowRight, ShieldAlert, Wrench, Repeat, Ban } from 'lucide-react'

export default function PredictionDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const predictions = usePredictions()
  const prediction = predictions.find((p) => p.id === id)
  const fixture = useFixtureById(prediction?.fixtureId)
  const evidence = useEvidenceForFixture(prediction?.fixtureId)
  const conflicts = useProviderConflicts()
  const actions = useStoreActions()

  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [repairOpen, setRepairOpen] = useState(false)
  const [incidentOpen, setIncidentOpen] = useState(false)
  const [replayOpen, setReplayOpen] = useState(false)

  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'evidence') setEvidenceOpen(true)
    if (action === 'repair') setRepairOpen(true)
    if (action === 'incident') setIncidentOpen(true)
    if (action) {
      const next = new URLSearchParams(searchParams)
      next.delete('action')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!prediction || !fixture) {
    return (
      <div className="flex flex-col gap-density-md">
        <PageHeader title="Prediction not found" />
        <Button variant="outline" onClick={() => navigate('/predictions')}>Back to Prediction Monitor</Button>
      </div>
    )
  }

  const relatedConflicts = conflicts.filter((c) => c.fixtureLabel === prediction.fixtureLabel)
  const marketSample = MARKETS.filter((m) => m.family === 'RESULT' || m.family === 'GOALS').slice(0, 6)

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title={prediction.fixtureLabel}
        breadcrumbs={[{ label: 'Prediction Monitor', path: '/predictions' }, { label: prediction.fixtureLabel }]}
        description={`${prediction.leagueName} · Episode ${prediction.episodeId} · Kickoff ${new Date(prediction.kickoff).toLocaleString()}`}
        tag={<StatusBadge status={prediction.predictionState} />}
        actions={
          <>
            <Button onClick={() => setEvidenceOpen(true)}>
              <PlusCircle className="h-4 w-4" /> Add evidence
            </Button>
            <Button variant="outline" onClick={() => { actions.revalidatePrediction(fixture.id); toast.info('Revalidation queued', { description: prediction.fixtureLabel }) }}>
              <ShieldAlert className="h-4 w-4" /> Revalidate
            </Button>
            <Button variant="outline" onClick={() => setRepairOpen(true)}>
              <Wrench className="h-4 w-4" /> Repair prediction
            </Button>
            <Button variant="outline" onClick={() => setReplayOpen(true)}>
              <Repeat className="h-4 w-4" /> Controlled replay
            </Button>
            <Button variant="outline" onClick={() => setIncidentOpen(true)}>
              <Ban className="h-4 w-4" /> Open data incident
            </Button>
            <Button variant="outline" onClick={() => navigate('/security/audit')}>
              <ScrollText className="h-4 w-4" /> Audit
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-density-lg lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="mb-density-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Baseline card</span>
          </div>
          <div className="text-3xl font-semibold text-foreground">{prediction.baselineProbability}%</div>
          <div className="text-sm text-muted-foreground">{prediction.baselinePick} · Model {prediction.modelVersion}</div>
          <div className="mt-2 text-xs text-muted-foreground">Immutable — created at first baseline event, never edited.</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="mb-density-sm flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current state</span>
          </div>
          <div className="text-3xl font-semibold text-foreground">{prediction.currentProbability}%</div>
          <div className="text-sm text-muted-foreground">{prediction.evidenceCount} evidence sequence(s) · confidence tracked per event</div>
          <div className="mt-2 text-xs text-muted-foreground">Last updated {new Date(prediction.lastUpdated).toLocaleString()}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <h2 className="mb-density-sm text-base font-semibold text-foreground">Market matrix</h2>
        <div className="grid grid-cols-2 gap-density-sm sm:grid-cols-3 lg:grid-cols-6">
          {marketSample.map((m) => (
            <div key={m.id} className="flex flex-col gap-1 rounded-md border border-border p-density-sm">
              <span className="text-xs font-medium text-foreground">{m.name}</span>
              <StatusBadge status={prediction.marketState} dense />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-density-md sm:grid-cols-4">
        <FactCard label="Data quality" value={<StatusBadge status={prediction.dataQuality} dense />} />
        <FactCard label="Consistency" value={<StatusBadge status={prediction.consistency} dense />} />
        <FactCard label="Recommendation" value={<StatusBadge status={prediction.recommendationState} dense />} />
        <FactCard label="Best price" value={prediction.bestPrice ? `${prediction.bestPrice.toFixed(2)} (${prediction.priceAgeMin}m old)` : 'Unavailable'} />
      </div>

      <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <h2 className="mb-density-md text-base font-semibold text-foreground">Evidence sequence</h2>
        <Timeline
          items={evidence.map((e) => ({
            id: e.id,
            timestamp: e.timestamp,
            tone: e.confidenceImpact === 'high' ? 'warning' : e.confidenceImpact === 'medium' ? 'info' : 'neutral',
            title: e.label,
            description: `${e.source} · ${e.previousProbability}% → ${e.newProbability}%`,
            meta: `Confidence impact: ${e.confidenceImpact} · ${e.snapshotHash}`,
          }))}
        />
      </div>

      <AddEvidenceDialog
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        fixtureLabel={prediction.fixtureLabel}
        episodeId={prediction.episodeId}
        onSubmit={(value) => {
          actions.addEvidence(fixture.id, value)
          toast.success('Evidence added', { description: 'Current probability updated — baseline remains immutable.' })
        }}
      />

      <OpenIncidentDialog
        open={incidentOpen}
        onOpenChange={setIncidentOpen}
        subject={prediction.fixtureLabel}
        onCreate={(payload) => {
          actions.openDataIncidentForFixture(fixture.id, { ...payload, category: 'Prediction' })
          toast.success('Data incident opened', { description: prediction.fixtureLabel })
        }}
      />

      <ControlledReplayWizard
        open={replayOpen}
        onOpenChange={setReplayOpen}
        subjectLabel={prediction.fixtureLabel}
        episodeId={prediction.episodeId}
        onConfirm={(reason, artifacts) => actions.controlledReplay(prediction.fixtureLabel, reason, artifacts)}
      />

      <RepairPredictionDrawer
        open={repairOpen}
        onOpenChange={setRepairOpen}
        fixture={fixture}
        prediction={prediction}
        conflicts={relatedConflicts}
        evidenceCount={evidence.length}
        onRevalidate={() => { actions.revalidatePrediction(fixture.id); toast.info('Data revalidation queued') }}
        onCreateRepairJob={(reason) => { actions.createRepairJobForFixture(fixture.id, reason, `Repair prediction: ${reason}`); toast.success('Repair job created') }}
        onControlledReplay={() => { setRepairOpen(false); setReplayOpen(true) }}
        onRequestRecompute={() => { actions.requestEvidenceRecompute(fixture.id); toast.success('Evidence recompute requested') }}
      />
    </div>
  )
}

function FactCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  )
}
