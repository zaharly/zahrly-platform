import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { HealthIndicator } from '../../components/status/HealthIndicator'
import { Timeline } from '../../components/timeline/Timeline'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { Button } from '../../lib/shadcn/button'
import { Input } from '../../lib/shadcn/input'
import { Label } from '../../lib/shadcn/label'
import { Textarea } from '../../lib/shadcn/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import { toast } from '../../lib/shadcn/sonner'
import { useFixtureById, usePredictionForFixture, useEvidenceForFixture, useStoreActions } from '../../state/StoreContext'
import { fixtureLabel } from '../../mock/data/fixtures'
import { SIMULATION_RUNS } from '../../mock/data/simulations'
import { MARKETS } from '../../mock/data/markets'
import { OpenIncidentDialog } from '../../components/dialogs/OpenIncidentDialog'
import { Lock, ArrowRight, ShieldAlert, Wrench, Search, Ban, Pencil } from 'lucide-react'

const REPAIR_REASONS = [
  'Provider correction', 'Missing information', 'Identity issue', 'Incorrect provider mapping',
  'Invalid evidence', 'Consistency failure', 'Simulation failure', 'Read-model mismatch',
]
const MATCH_STATUSES = ['SCHEDULED', 'POSTPONED', 'CANCELLED', 'COMPLETED'] as const

export default function FixtureDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const fixture = useFixtureById(id)
  const prediction = usePredictionForFixture(id)
  const evidence = useEvidenceForFixture(id)
  const actions = useStoreActions()

  const [dialog, setDialog] = useState<'exclude' | 'repair' | null>(null)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [incidentOpen, setIncidentOpen] = useState(false)

  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'correction') setCorrectionOpen(true)
    if (action === 'repair') setDialog('repair')
    if (action === 'incident') setIncidentOpen(true)
    if (action) {
      const next = new URLSearchParams(searchParams)
      next.delete('action')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!fixture) {
    return (
      <div className="flex flex-col gap-density-md">
        <PageHeader title="Fixture not found" />
        <Button variant="outline" onClick={() => navigate('/data/fixtures')}>Back to fixtures</Button>
      </div>
    )
  }

  const simulation = SIMULATION_RUNS.find((s) => s.fixtureLabel === fixtureLabel(fixture))
  const marketSample = MARKETS.slice(0, 8)

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title={fixtureLabel(fixture)}
        breadcrumbs={[{ label: 'Fixtures', path: '/data/fixtures' }, { label: fixtureLabel(fixture) }]}
        description={`${fixture.leagueName} · ${fixture.countryName} · Episode ${fixture.episodeId} · Kickoff ${new Date(fixture.kickoff).toLocaleString()}`}
        tag={<StatusBadge status={fixture.predictionState} />}
        actions={
          <>
            <Button variant="outline" onClick={() => toast.info('Inspecting source observations', { description: 'This is a UI-only preview action.' })}>
              <Search className="h-4 w-4" /> Inspect sources
            </Button>
            <Button variant="outline" onClick={() => setCorrectionOpen(true)}>
              <Pencil className="h-4 w-4" /> Manual correction
            </Button>
            <Button variant="outline" onClick={() => { actions.revalidateFixture(fixture.id); toast.info('Revalidation queued', { description: fixtureLabel(fixture) }) }}>
              <ShieldAlert className="h-4 w-4" /> Revalidate
            </Button>
            <Button variant="outline" onClick={() => setDialog('repair')}>
              <Wrench className="h-4 w-4" /> Create repair job
            </Button>
            <Button variant="outline" onClick={() => setIncidentOpen(true)}>
              <ShieldAlert className="h-4 w-4" /> Open data incident
            </Button>
            <Button variant="destructive" onClick={() => setDialog('exclude')}>
              <Ban className="h-4 w-4" /> Exclude fixture
            </Button>
          </>
        }
      />

      {fixture.lastCorrectedAt && (
        <div className="rounded-lg border border-border zc-chip-info p-density-md text-sm">
          Manually corrected {new Date(fixture.lastCorrectedAt).toLocaleString()}. {fixture.venue && <>Venue: {fixture.venue}. </>}{fixture.round && <>Round: {fixture.round}. </>}{fixture.matchStatus && <>Status: {fixture.matchStatus}.</>}
        </div>
      )}

      {/* Baseline vs current */}
      <div className="grid grid-cols-1 gap-density-lg lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="mb-density-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Baseline — immutable</span>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-3xl font-semibold text-foreground">{fixture.baselineProbability}%</div>
              <div className="text-sm text-muted-foreground">{fixture.baselinePick}</div>
            </div>
            <StatusBadge status="LOCKED" tone="neutral" />
          </div>
          <div className="mt-density-sm text-xs text-muted-foreground">
            Model {fixture.modelVersion} · created at first evidence event · never edited or deleted by an admin.
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="mb-density-sm flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current — live assessment</span>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-3xl font-semibold text-foreground">{fixture.currentProbability}%</div>
              <div className="text-sm text-muted-foreground">{evidence.length} evidence update{evidence.length === 1 ? '' : 's'} applied</div>
            </div>
            <StatusBadge status={prediction?.consistency ?? 'PASS'} />
          </div>
          <div className="mt-density-sm text-xs text-muted-foreground">
            Change vs baseline: {fixture.currentProbability - fixture.baselineProbability >= 0 ? '+' : ''}{fixture.currentProbability - fixture.baselineProbability} pts
          </div>
        </div>
      </div>

      {/* Data & readiness */}
      <div className="grid grid-cols-1 gap-density-md sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="mb-1 text-xs uppercase text-muted-foreground">Data readiness</div>
          <ProgressBar value={fixture.dataReadinessPct} />
        </div>
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="mb-1 text-xs uppercase text-muted-foreground">Odds readiness</div>
          <ProgressBar value={fixture.oddsReadinessPct} tone="info" />
        </div>
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="mb-1 text-xs uppercase text-muted-foreground">Provider status</div>
          <HealthIndicator status={fixture.providerStatus} label={fixture.providerStatus} />
        </div>
      </div>

      {/* Market matrix */}
      <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <h2 className="mb-density-sm text-base font-semibold text-foreground">Market matrix (sample)</h2>
        <div className="grid grid-cols-2 gap-density-sm sm:grid-cols-4">
          {marketSample.map((m) => (
            <div key={m.id} className="flex flex-col gap-1 rounded-md border border-border p-density-sm">
              <span className="text-xs font-medium text-foreground">{m.name}</span>
              <StatusBadge status={m.status} dense />
            </div>
          ))}
        </div>
      </div>

      {/* Simulation + Price/Value */}
      <div className="grid grid-cols-1 gap-density-lg lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <h2 className="mb-density-sm text-base font-semibold text-foreground">Simulation</h2>
          {simulation ? (
            <div className="flex flex-col gap-1.5 text-sm">
              <Row label="Mode" value={simulation.mode} />
              <Row label="Samples" value={`${simulation.samplesUsed.toLocaleString()} / ${simulation.samplesCap.toLocaleString()}`} />
              <Row label="95% half-width" value={`±${simulation.halfWidth}`} />
              <Row label="Outcome" value={<StatusBadge status={simulation.outcome} dense />} />
              <Row label="Top recommendation stability" value={simulation.topRecommendationStable ? 'Stable across checkpoints' : 'Unstable — monitor'} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No simulation run recorded for this fixture yet.</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <h2 className="mb-density-sm text-base font-semibold text-foreground">Price / Value</h2>
          {prediction?.bestPrice ? (
            <div className="flex flex-col gap-1.5 text-sm">
              <Row label="Best price" value={prediction.bestPrice.toFixed(2)} />
              <Row label="Price age" value={`${prediction.priceAgeMin} min`} />
              <Row label="Recommendation state" value={<StatusBadge status={prediction.recommendationState} dense />} />
              <Row label="Consistency" value={<StatusBadge status={prediction.consistency} dense />} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Odds/value data unavailable — market is abstaining for this fixture.</p>
          )}
        </div>
      </div>

      {/* Evidence timeline */}
      <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="mb-density-md flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Evidence timeline (append-only episode history)</h2>
          {prediction && (
            <Link to={`/predictions/${prediction.id}`} className="text-sm font-medium text-foreground hover:underline">Open prediction operations</Link>
          )}
        </div>
        <Timeline
          items={evidence.map((e) => ({
            id: e.id,
            timestamp: e.timestamp,
            tone: e.confidenceImpact === 'high' ? 'warning' : e.confidenceImpact === 'medium' ? 'info' : 'neutral',
            title: e.label,
            description: `${e.source} · ${e.previousProbability}% → ${e.newProbability}% (${e.delta >= 0 ? '+' : ''}${e.delta})`,
            meta: `Model ${e.modelVersion} · ${e.snapshotHash}`,
          }))}
        />
      </div>

      <div className="text-sm text-muted-foreground">
        Full change history for this fixture is recorded in the <Link to="/security/audit" className="font-medium text-foreground hover:underline">Audit Log</Link>.
      </div>

      <ConfirmDialog
        open={dialog === 'exclude'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Exclude fixture"
        actionSummary="Marks this fixture as excluded from active production processing (terminal, non-settleable episode)."
        scope={fixtureLabel(fixture)}
        consequences={['Fixture is removed from prediction and recommendation surfaces.', 'Existing baseline and evidence history remain in the archive.', 'This action is recorded in the audit log with your reason.']}
        confirmLabel="Exclude fixture"
        onConfirm={() => toast.success('Fixture excluded', { description: 'This is a UI-only preview action — no database transaction occurred.' })}
      />

      <CreateRepairJobDialog
        open={dialog === 'repair'}
        onOpenChange={(o) => !o && setDialog(null)}
        fixtureLabel={fixtureLabel(fixture)}
        onCreate={(reason, description) => {
          actions.createRepairJobForFixture(fixture.id, reason, description)
          toast.success('Repair job created', { description: 'Added to REPAIR_QUEUE.' })
        }}
      />

      <OpenIncidentDialog
        open={incidentOpen}
        onOpenChange={setIncidentOpen}
        subject={fixtureLabel(fixture)}
        onCreate={(payload) => {
          actions.openDataIncidentForFixture(fixture.id, { ...payload, category: 'Data' })
          toast.success('Data incident opened', { description: fixtureLabel(fixture) })
        }}
      />

      <ManualCorrectionDrawer
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        fixture={fixture}
        onApply={(changes, reason) => {
          actions.applyFixtureCorrection(fixture.id, changes, reason)
          toast.success('Correction applied', { description: fixtureLabel(fixture) })
        }}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

function CreateRepairJobDialog({ open, onOpenChange, fixtureLabel: label, onCreate }: {
  open: boolean; onOpenChange: (o: boolean) => void; fixtureLabel: string; onCreate: (reason: string, description: string) => void
}) {
  const [reason, setReason] = useState(REPAIR_REASONS[0]!)
  const [description, setDescription] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create repair job</DialogTitle>
          <DialogDescription>Queues a REPAIR_QUEUE job for {label}. Historical baseline values are never modified.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-density-md">
          <div className="flex flex-col gap-1.5">
            <Label>Repair reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{REPAIR_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs to be corrected and why…" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={description.trim().length < 4}
            onClick={() => { onCreate(reason, `${reason}: ${description}`); onOpenChange(false); setDescription('') }}
          >
            Create repair job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ManualCorrectionDrawer({ open, onOpenChange, fixture, onApply }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  fixture: NonNullable<ReturnType<typeof useFixtureById>>
  onApply: (changes: { kickoff?: string; venue?: string; homeTeam?: string; awayTeam?: string; round?: string; matchStatus?: typeof MATCH_STATUSES[number] }, reason: string) => void
}) {
  const [kickoff, setKickoff] = useState(fixture.kickoff.slice(0, 16))
  const [venue, setVenue] = useState(fixture.venue ?? '')
  const [homeTeam, setHomeTeam] = useState(fixture.homeTeam)
  const [awayTeam, setAwayTeam] = useState(fixture.awayTeam)
  const [round, setRound] = useState(fixture.round ?? '')
  const [matchStatus, setMatchStatus] = useState<typeof MATCH_STATUSES[number]>(fixture.matchStatus ?? 'SCHEDULED')
  const [reason, setReason] = useState('')
  const [previewShown, setPreviewShown] = useState(false)

  const impact = useMemo(() => {
    const effects: string[] = []
    const kickoffChanged = new Date(kickoff).toISOString().slice(0, 16) !== fixture.kickoff.slice(0, 16)
    const teamsChanged = homeTeam !== fixture.homeTeam || awayTeam !== fixture.awayTeam
    const statusChanged = matchStatus !== (fixture.matchStatus ?? 'SCHEDULED')
    if (kickoffChanged) effects.push('Episode change likely — kickoff shift may require a new episode under the material-change rule.')
    if (statusChanged && (matchStatus === 'POSTPONED' || matchStatus === 'CANCELLED')) effects.push('Episode change required — previous baseline remains immutable, a terminal or new episode will be created.')
    if (kickoffChanged || statusChanged) effects.push('Prediction impact — current probability may be recomputed after this correction.')
    if (statusChanged && matchStatus === 'POSTPONED') effects.push('Replay required — downstream evidence and odds jobs will need to re-run.')
    if (venue !== (fixture.venue ?? '') || teamsChanged) effects.push('Provider incident recommended — mapping mismatch should be reconciled with the source provider.')
    if (effects.length === 0) effects.push('No material downstream impact detected for the fields changed.')
    return effects
  }, [kickoff, venue, homeTeam, awayTeam, matchStatus, fixture])

  function reset() {
    setPreviewShown(false)
    setReason('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Manual correction — {fixture.homeTeam} vs {fixture.awayTeam}</DialogTitle>
          <DialogDescription>Only operationally valid fixture fields can be corrected. This does not edit any prediction or probability.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-density-md">
          <div className="flex flex-col gap-1.5">
            <Label>Kickoff</Label>
            <Input type="datetime-local" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Venue</Label>
            <Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Stadium name" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Home team / provider mapping</Label>
            <Input value={homeTeam} onChange={(e) => setHomeTeam(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Away team / provider mapping</Label>
            <Input value={awayTeam} onChange={(e) => setAwayTeam(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Round</Label>
            <Input value={round} onChange={(e) => setRound(e.target.value)} placeholder="e.g. Matchday 12" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Fixture status</Label>
            <Select value={matchStatus} onValueChange={(v) => setMatchStatus(v as typeof matchStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MATCH_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {previewShown && (
          <div className="rounded-md border border-warning/30 zc-chip-warning p-density-md text-sm">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide">Impact preview</div>
            <ul className="list-disc space-y-1 pl-5">
              {impact.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <div className="mt-density-sm flex flex-col gap-1.5">
              <Label htmlFor="correction-reason">Reason (required)</Label>
              <Textarea id="correction-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why is this correction necessary?" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!previewShown ? (
            <Button variant="secondary" onClick={() => setPreviewShown(true)}>Preview</Button>
          ) : (
            <Button
              disabled={reason.trim().length < 4}
              onClick={() => {
                onApply({ kickoff: new Date(kickoff).toISOString(), venue, homeTeam, awayTeam, round, matchStatus }, reason)
                onOpenChange(false)
                reset()
              }}
            >
              Apply correction
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
