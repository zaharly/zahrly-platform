import { useEffect, useState, type ReactNode } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { Button } from '../../lib/shadcn/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import { toast } from '../../lib/shadcn/sonner'
import { useLeagueById, useFixtures, useStoreActions } from '../../state/StoreContext'
import { Ban, PlayCircle, PauseCircle, Archive, Wrench, CheckCircle2, XCircle, Clock } from 'lucide-react'

type PendingAction = 'disable' | 'pause' | 'archive' | null

export default function LeagueDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const league = useLeagueById(id)
  const fixtures = useFixtures()
  const actions = useStoreActions()
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [reEnableOpen, setReEnableOpen] = useState(false)
  const [confirmReEnable, setConfirmReEnable] = useState(false)
  const [repairOpen, setRepairOpen] = useState(searchParams.get('repair') === '1')

  useEffect(() => {
    if (searchParams.get('repair') === '1') setRepairOpen(true)
  }, [searchParams])

  if (!league) {
    return (
      <div className="flex flex-col gap-density-md">
        <PageHeader title="League not found" />
        <Button variant="outline" onClick={() => navigate('/data/leagues')}>Back to leagues</Button>
      </div>
    )
  }

  const relatedFixtures = fixtures.filter((f) => f.leagueId === league.id).slice(0, 8)

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title={league.name}
        breadcrumbs={[{ label: 'Leagues', path: '/data/leagues' }, { label: league.name }]}
        description={league.processingPolicy}
        tag={<StatusBadge status={league.status} />}
        actions={
          <>
            <Button variant="outline" onClick={() => setRepairOpen(true)}>
              <Wrench className="h-4 w-4" /> Repair missing history
            </Button>
            {league.status !== 'ENABLED' && (
              <Button variant="outline" onClick={() => setReEnableOpen(true)}>
                <PlayCircle className="h-4 w-4" /> Re-enable league
              </Button>
            )}
            {league.status === 'ENABLED' && (
              <Button variant="outline" onClick={() => setPendingAction('pause')}>
                <PauseCircle className="h-4 w-4" /> Pause
              </Button>
            )}
            {league.status !== 'ARCHIVED' && (
              <Button variant="outline" onClick={() => setPendingAction('archive')}>
                <Archive className="h-4 w-4" /> Archive
              </Button>
            )}
            {league.status !== 'DISABLED' && (
              <Button variant="destructive" onClick={() => setPendingAction('disable')}>
                <Ban className="h-4 w-4" /> Disable
              </Button>
            )}
          </>
        }
      />

      {league.status !== 'ENABLED' && (
        <div className="rounded-lg border border-warning/30 zc-chip-warning p-density-md text-sm">
          Processing is {league.status === 'DISABLED' ? 'blocked' : league.status === 'ARCHIVED' ? 'archived' : 'paused'} for this league. Future fixtures, odds, and predictions will not be generated until it is re-enabled.
          Historical data already acquired remains fully intact in the archive.
        </div>
      )}

      <div className="grid grid-cols-2 gap-density-md lg:grid-cols-4">
        <InfoCard label="Country" value={league.countryName} />
        <InfoCard label="Current season" value={league.currentSeason} />
        <InfoCard label="Fixtures" value={league.fixtureCount.toLocaleString()} />
        <InfoCard label="Predictions" value={league.predictionCount.toLocaleString()} />
      </div>

      <div className="grid grid-cols-1 gap-density-md sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="mb-1 text-xs uppercase text-muted-foreground">Market coverage</div>
          <ProgressBar value={league.marketCoveragePct} />
        </div>
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="mb-1 text-xs uppercase text-muted-foreground">Odds coverage</div>
          <ProgressBar value={league.oddsCoveragePct} tone="info" />
        </div>
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="mb-1 text-xs uppercase text-muted-foreground">Completeness</div>
          <ProgressBar value={league.completenessPct} tone="success" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <h2 className="mb-density-sm text-base font-semibold text-foreground">Provider capabilities</h2>
        <div className="flex flex-wrap gap-density-sm">
          {league.providers.length === 0 && <span className="text-sm text-muted-foreground">No provider capability configured — plan does not include this endpoint.</span>}
          {league.providers.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-density-sm py-1.5 text-sm">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {p}
            </span>
          ))}
        </div>
        <div className="mt-density-md text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Season scope:</span> <StatusBadge status={league.seasonScope} dense className="ml-1" /> ·{' '}
          <span className="font-medium text-foreground">Historical seasons archived:</span> {league.historicalSeasons.join(', ')}
        </div>
      </div>

      <div>
        <h2 className="mb-density-sm text-base font-semibold text-foreground">Recent fixtures</h2>
        <ul className="flex flex-col gap-density-sm">
          {relatedFixtures.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-md border border-border p-density-sm">
              <Link to={`/data/fixtures/${f.id}`} className="text-sm font-medium text-foreground hover:underline">
                {f.homeTeam} vs {f.awayTeam}
              </Link>
              <div className="flex items-center gap-density-sm">
                <span className="text-xs text-muted-foreground">{new Date(f.kickoff).toLocaleString()}</span>
                <StatusBadge status={f.predictionState} dense />
              </div>
            </li>
          ))}
          {relatedFixtures.length === 0 && <li className="text-sm text-muted-foreground">No fixtures found for this league.</li>}
        </ul>
      </div>

      <ConfirmDialog
        open={pendingAction === 'disable'}
        onOpenChange={(o) => !o && setPendingAction(null)}
        title={`Disable ${league.name}`}
        actionSummary="Prevents future processing and provider requests for this league. Historical data is preserved."
        scope={league.name}
        consequences={[
          'No new fixtures, odds, enrichment, or predictions will be produced.',
          'Historical and archived data is never discarded.',
          'Re-enabling will first show an archive diff before resuming processing.',
        ]}
        confirmLabel="Disable league"
        onConfirm={(reason) => { actions.disableLeague(league.id, reason); toast.success(`${league.name} disabled`) }}
      />
      <ConfirmDialog
        open={pendingAction === 'pause'}
        onOpenChange={(o) => !o && setPendingAction(null)}
        title={`Pause ${league.name}`}
        actionSummary="Temporarily halts new acquisition while keeping quick-resume eligibility."
        scope={league.name}
        consequences={['New processing jobs are paused.', 'In-flight jobs complete normally.', 'Can be resumed without an archive diff review.']}
        confirmLabel="Pause league"
        destructive={false}
        onConfirm={(reason) => { actions.pauseLeague(league.id, reason); toast.success(`${league.name} paused`) }}
      />
      <ConfirmDialog
        open={pendingAction === 'archive'}
        onOpenChange={(o) => !o && setPendingAction(null)}
        title={`Archive ${league.name}`}
        actionSummary="Moves this league to archive-only scope. History remains searchable in the Archive Center."
        scope={league.name}
        consequences={['No new processing of any kind occurs for this league.', 'All historical data remains browsable and restorable from the Archive Center.']}
        confirmLabel="Archive league"
        destructive={false}
        onConfirm={(reason) => { actions.archiveLeague(league.id, reason); toast.success(`${league.name} archived`) }}
      />

      <Dialog open={reEnableOpen} onOpenChange={setReEnableOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Re-enable {league.name}</DialogTitle>
            <DialogDescription>
              Review the archive difference before resuming processing. Only missing or invalidated data will be queued.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-density-md sm:grid-cols-3">
            <ArchiveDiffColumn
              icon={<CheckCircle2 className="h-4 w-4 text-success" />}
              title="Already archived"
              items={[`Core fixtures — ${league.historicalSeasons[0] ?? 'n/a'} to ${league.historicalSeasons[league.historicalSeasons.length - 1] ?? 'n/a'}`, 'Results & standings history', 'H2H dataset']}
            />
            <ArchiveDiffColumn
              icon={<XCircle className="h-4 w-4 text-destructive" />}
              title="Missing / invalidated"
              items={[`Current season (${league.currentSeason}) core fixtures`, 'Enrichment bundle since pause date', 'Odds history since pause date']}
            />
            <ArchiveDiffColumn
              icon={<Clock className="h-4 w-4 zc-text-info" />}
              title="New requests to be generated"
              items={['~1,240 API-Football requests', league.providers.includes('PropLine') ? '~380 PropLine requests' : 'PropLine not supported for this league', 'Estimated completion: 6–9 hours']}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReEnableOpen(false)}>Cancel</Button>
            <Button onClick={() => { setReEnableOpen(false); setConfirmReEnable(true) }}>Continue to confirmation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmReEnable}
        onOpenChange={setConfirmReEnable}
        title={`Confirm re-enable of ${league.name}`}
        actionSummary="Queues only the missing/invalidated data shown in the archive diff, then resumes current rolling production."
        scope={league.name}
        consequences={[
          'A backfill job is queued for the missing data identified above.',
          'Rolling production resumes automatically once eligibility checks pass.',
          'No previously archived data will be re-requested or overwritten.',
        ]}
        confirmLabel="Re-enable league"
        destructive={false}
        onConfirm={(reason) => { actions.reEnableLeague(league.id, reason); toast.success(`${league.name} re-enabled`) }}
      />

      <Dialog open={repairOpen} onOpenChange={setRepairOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Repair missing history — {league.name}</DialogTitle>
            <DialogDescription>
              Queues a backfill tranche for the historical gaps detected in this league's archive coverage.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted/40 p-density-md text-sm text-muted-foreground">
            Detected gap: enrichment and specialized-market datasets below completeness threshold for {league.historicalSeasons[0] ?? 'earliest tracked season'}.
            Current completeness: {league.completenessPct}%.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepairOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                actions.createBackfillTranche({
                  country: league.countryName,
                  league: league.name,
                  season: league.historicalSeasons[0] ?? league.currentSeason,
                  datasetType: 'Repair — missing history',
                  priority: 'high',
                })
                setRepairOpen(false)
                toast.success('Backfill tranche queued', { description: `Historical repair scope created for ${league.name}.` })
                navigate(`/data/leagues/${league.id}`, { replace: true })
              }}
            >
              Queue repair tranche
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
    </div>
  )
}

function ArchiveDiffColumn({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border p-density-md">
      <div className="mb-density-sm flex items-center gap-2 text-sm font-semibold text-foreground">{icon} {title}</div>
      <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  )
}
