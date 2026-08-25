import { useMemo, useState } from 'react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { PolicyBadge } from '../../components/status/PolicyBadge'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { Button } from '../../lib/shadcn/button'
import { Input } from '../../lib/shadcn/input'
import { Label } from '../../lib/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import { toast } from '../../lib/shadcn/sonner'
import { useBootstrapCampaign, useBootstrapSeasons, useTrancheQueue, useStoreActions } from '../../state/StoreContext'
import type { ColumnDef } from '@tanstack/react-table'
import type { BootstrapSeason, TrancheQueueItem } from '../../types/domain'
import { Pause, Play, ArrowUpDown, RotateCw, FileSearch, PlusCircle } from 'lucide-react'

const seasonColumns: ColumnDef<BootstrapSeason, any>[] = [
  { accessorKey: 'season', header: 'Season' },
  { accessorKey: 'competitions', header: 'Competitions' },
  { accessorKey: 'fixtures', header: 'Fixtures', cell: ({ getValue }) => (getValue<number>()).toLocaleString() },
  {
    accessorKey: 'coreCompletenessPct', header: 'Core completeness',
    cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" tone={getValue<number>() >= 95 ? 'success' : getValue<number>() >= 50 ? 'warning' : 'critical'} />,
  },
  {
    accessorKey: 'enrichmentCompletenessPct', header: 'Enrichment completeness',
    cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" tone={getValue<number>() >= 95 ? 'success' : getValue<number>() >= 50 ? 'warning' : 'critical'} />,
  },
  {
    accessorKey: 'specializedCompletenessPct', header: 'Specialized completeness',
    cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" tone={getValue<number>() >= 95 ? 'success' : getValue<number>() >= 50 ? 'warning' : 'critical'} />,
  },
  { accessorKey: 'requestsUsed', header: 'Requests', cell: ({ getValue }) => (getValue<number>()).toLocaleString() },
  { accessorKey: 'archiveStatus', header: 'Archive status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
  { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
]

export default function HistoricalBootstrap() {
  const campaign = useBootstrapCampaign()
  const seasons = useBootstrapSeasons()
  const tranches = useTrancheQueue()
  const actions = useStoreActions()
  const [pauseOpen, setPauseOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [manifestTarget, setManifestTarget] = useState<TrancheQueueItem | null>(null)

  const trancheColumns = useMemo<ColumnDef<TrancheQueueItem, any>[]>(() => [
    { accessorKey: 'country', header: 'Country' },
    { accessorKey: 'league', header: 'League' },
    { accessorKey: 'season', header: 'Season' },
    { accessorKey: 'datasetType', header: 'Dataset type' },
    { accessorKey: 'priority', header: 'Priority', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'progressPct', header: 'Progress', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" /> },
    { accessorKey: 'requestsUsed', header: 'Requests used', cell: ({ getValue }) => (getValue<number>()).toLocaleString() },
    { accessorKey: 'lastWatermark', header: 'Last watermark' },
    {
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => {
        const tranche = row.original
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setManifestTarget(tranche)}>
              <FileSearch className="h-3.5 w-3.5" /> Inspect
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { actions.retryTrancheScope(tranche.id); toast.info('Tranche scope retried') }}>
              <RotateCw className="h-3.5 w-3.5" /> Retry
            </Button>
            {tranche.priority !== 'high' && (
              <Button variant="outline" size="sm" onClick={() => { actions.reprioritizeTranche(tranche.id, 'Manual reprioritization from tranche queue'); toast.success('Moved to high priority') }}>
                <ArrowUpDown className="h-3.5 w-3.5" /> Reprioritize
              </Button>
            )}
          </div>
        )
      },
    },
  ], [actions])

  return (
    <div className="flex flex-col gap-density-xl">
      <PageHeader
        title="Historical Bootstrap"
        description="2020–2026 multi-month acquisition campaign — a separate operating path from 7-Day Rolling Production. It yields to production and never reprocesses the rolling horizon."
        tag={<StatusBadge status={campaign.status} />}
        actions={
          <>
            {campaign.status === 'PAUSED' ? (
              <Button variant="outline" onClick={() => { actions.resumeCampaign(); toast.success('Campaign resumed') }}>
                <Play className="h-4 w-4" /> Resume campaign
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setPauseOpen(true)}>
                <Pause className="h-4 w-4" /> Pause campaign
              </Button>
            )}
            <Button onClick={() => setCreateOpen(true)}>
              <PlusCircle className="h-4 w-4" /> Create backfill tranche
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-density-md lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="text-xs font-medium uppercase text-muted-foreground">Overall completeness</div>
          <div className="mt-1 text-2xl font-semibold">{campaign.overallCompletenessPct}%</div>
          <ProgressBar value={campaign.overallCompletenessPct} showValue={false} className="mt-2" />
        </div>
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="text-xs font-medium uppercase text-muted-foreground">Seasons / Leagues</div>
          <div className="mt-1 text-2xl font-semibold">{campaign.seasonsCompleted}/{campaign.seasonsTotal}</div>
          <div className="text-sm text-muted-foreground">{campaign.leaguesCompleted}/{campaign.leaguesTotal} leagues complete</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="text-xs font-medium uppercase text-muted-foreground">Requests consumed</div>
          <div className="mt-1 text-2xl font-semibold">{campaign.requestsConsumed.toLocaleString()}</div>
          <div className="text-sm text-muted-foreground">of {campaign.requestsBudget.toLocaleString()} budget</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="text-xs font-medium uppercase text-muted-foreground">Elapsed / expected completion</div>
          <div className="mt-1 text-2xl font-semibold">{campaign.elapsedDays}d</div>
          <div className="text-sm text-muted-foreground">min {campaign.minDurationDays}d · est. {campaign.expectedCompletion}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="mb-density-md flex flex-wrap items-center justify-between gap-density-sm">
          <div>
            <h2 className="text-base font-semibold text-foreground">Quota Allocation Policy</h2>
            <p className="text-sm text-muted-foreground">Configurable reserve — historical processing yields to production and repair.</p>
          </div>
          <PolicyBadge version="quota-policy-v4" description="Rolling reserve 30% · Repair reserve 10% · Backfill budget 60%" />
        </div>
        <div className="grid grid-cols-3 gap-density-md">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Production reserve</span>
            <ProgressBar value={campaign.reserve.production} tone="success" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Repair reserve</span>
            <ProgressBar value={campaign.reserve.repair} tone="warning" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Backfill available</span>
            <ProgressBar value={campaign.reserve.backfill} tone="info" />
          </div>
        </div>
        <div className="mt-density-md grid grid-cols-1 gap-density-sm text-sm text-muted-foreground sm:grid-cols-2">
          <div><span className="font-medium text-foreground">Current tranche:</span> {campaign.currentTranche}</div>
          <div><span className="font-medium text-foreground">Next tranche:</span> {campaign.nextTranche}</div>
        </div>
      </div>

      <div>
        <h2 className="mb-density-md text-base font-semibold text-foreground">Season Progress</h2>
        <DataTable columns={seasonColumns} data={seasons} searchPlaceholder="Search seasons…" pageSize={10} />
      </div>

      <div>
        <h2 className="mb-density-md text-base font-semibold text-foreground">Historical Tranche Queue</h2>
        <DataTable columns={trancheColumns} data={tranches} searchPlaceholder="Search tranches…" pageSize={10} />
      </div>

      <DetailDrawer
        open={!!manifestTarget}
        onOpenChange={(o) => !o && setManifestTarget(null)}
        title={manifestTarget ? `${manifestTarget.league} — ${manifestTarget.season}` : ''}
        description={manifestTarget?.datasetType}
      >
        {manifestTarget && (
          <div className="flex flex-col gap-density-md text-sm">
            <div><span className="text-xs uppercase text-muted-foreground">Country: </span>{manifestTarget.country}</div>
            <div><span className="text-xs uppercase text-muted-foreground">Progress: </span>{manifestTarget.progressPct}%</div>
            <div><span className="text-xs uppercase text-muted-foreground">Requests used: </span>{manifestTarget.requestsUsed.toLocaleString()}</div>
            <div><span className="text-xs uppercase text-muted-foreground">Last watermark: </span>{manifestTarget.lastWatermark}</div>
            <div><span className="text-xs uppercase text-muted-foreground">Priority: </span><StatusBadge status={manifestTarget.priority} dense /></div>
          </div>
        )}
      </DetailDrawer>

      <ConfirmDialog
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        title="Pause historical bootstrap campaign"
        actionSummary="Pauses all backfill tranches. In-flight production and repair work is unaffected."
        scope="Entire Historical Bootstrap campaign (2020–2026)"
        consequences={[
          'No new BACKFILL_QUEUE jobs will be scheduled until resumed.',
          '7-Day Rolling Production continues unaffected.',
          'Quota reserved for backfill becomes available to production/repair immediately.',
        ]}
        confirmLabel="Pause campaign"
        onConfirm={(reason) => { actions.pauseCampaign(reason); toast.success('Historical bootstrap campaign paused') }}
      />

      <CreateTrancheDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(input) => { actions.createBackfillTranche(input); toast.success('Backfill tranche queued') }}
      />
    </div>
  )
}

function CreateTrancheDialog({ open, onOpenChange, onCreate }: {
  open: boolean; onOpenChange: (o: boolean) => void
  onCreate: (input: { country: string; league: string; season: string; datasetType: string; priority: TrancheQueueItem['priority'] }) => void
}) {
  const [country, setCountry] = useState('')
  const [league, setLeague] = useState('')
  const [season, setSeason] = useState('')
  const [datasetType, setDatasetType] = useState('Core fixtures')
  const [priority, setPriority] = useState<TrancheQueueItem['priority']>('normal')

  function reset() {
    setCountry(''); setLeague(''); setSeason(''); setDatasetType('Core fixtures'); setPriority('normal')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create backfill tranche</DialogTitle>
          <DialogDescription>Queues a new historical acquisition scope to the BACKFILL_QUEUE.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-density-md">
          <div className="flex flex-col gap-1.5"><Label>Country</Label><Input value={country} onChange={(e) => setCountry(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label>League</Label><Input value={league} onChange={(e) => setLeague(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label>Season</Label><Input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="e.g. 2022/23" /></div>
          <div className="flex flex-col gap-1.5">
            <Label>Dataset type</Label>
            <Select value={datasetType} onValueChange={setDatasetType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['Core fixtures', 'Enrichment bundle', 'Specialized markets', 'Odds history', 'Lineup archive'].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TrancheQueueItem['priority'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(['low', 'normal', 'high'] as const).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!country.trim() || !league.trim() || !season.trim()}
            onClick={() => { onCreate({ country, league, season, datasetType, priority }); onOpenChange(false); reset() }}
          >
            Create tranche
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
