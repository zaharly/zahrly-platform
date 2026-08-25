import { useMemo, useState, type ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { HealthIndicator } from '../../components/status/HealthIndicator'
import { Button } from '../../lib/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../lib/shadcn/dropdown-menu'
import { toast } from '../../lib/shadcn/sonner'
import { useFixtures, useLeagues, useStoreActions } from '../../state/StoreContext'
import { fixtureLabel as fixtureLabelOf } from '../../mock/data/fixtures'
import type { Fixture } from '../../types/domain'
import { ArrowRight, MoreHorizontal, ShieldAlert, Wrench, AlertTriangle, ListTree, Pencil } from 'lucide-react'

const ALL = '__all__'

export default function Fixtures() {
  const navigate = useNavigate()
  const fixtures = useFixtures()
  const leagues = useLeagues()
  const actions = useStoreActions()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [leagueFilter, setLeagueFilter] = useState(ALL)
  const [stateFilter, setStateFilter] = useState(ALL)
  const selected = fixtures.find((f) => f.id === selectedId) ?? null

  const filtered = useMemo(() => fixtures.filter((f) =>
    (leagueFilter === ALL || f.leagueId === leagueFilter) &&
    (stateFilter === ALL || f.predictionState === stateFilter)
  ), [fixtures, leagueFilter, stateFilter])

  const columns = useMemo<ColumnDef<Fixture, any>[]>(() => [
    { accessorKey: 'kickoff', header: 'Kickoff', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) },
    { accessorKey: 'leagueName', header: 'League' },
    {
      id: 'match', header: 'Fixture',
      accessorFn: (f) => fixtureLabelOf(f),
      cell: ({ row }) => <span className="font-medium text-foreground">{fixtureLabelOf(row.original)}</span>,
    },
    { accessorKey: 'predictionState', header: 'Prediction', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'marketState', header: 'Market state', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'dataReadinessPct', header: 'Data readiness', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" showValue={false} /> },
    { accessorKey: 'oddsReadinessPct', header: 'Odds readiness', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" showValue={false} tone="info" /> },
    { accessorKey: 'providerStatus', header: 'Provider', cell: ({ getValue }) => <HealthIndicator status={getValue<string>()} size="sm" label="" /> },
    { accessorKey: 'baselineStatus', header: 'Baseline', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'currentProbability', header: 'Current prob.', cell: ({ getValue }) => `${getValue<number>()}%` },
    {
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => {
        const f = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Fixture actions" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>{fixtureLabelOf(f)}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate(`/data/fixtures/${f.id}`)}>
                <ListTree className="h-4 w-4" /> Inspect episode
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(`/data/fixtures/${f.id}?action=correction`)}>
                <Pencil className="h-4 w-4" /> Manual correction
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { actions.revalidateFixture(f.id); toast.info('Revalidation queued', { description: fixtureLabelOf(f) }) }}>
                <ShieldAlert className="h-4 w-4" /> Revalidate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(`/data/fixtures/${f.id}?action=repair`)}>
                <Wrench className="h-4 w-4" /> Create repair job
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(`/data/fixtures/${f.id}?action=incident`)}>
                <AlertTriangle className="h-4 w-4" /> Open data incident
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [actions, navigate])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Fixtures"
        description="Cross-league fixture operations — data readiness, provider status, baseline lock state, and prediction lifecycle."
      />

      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="Search fixtures…"
        onRowClick={(f) => setSelectedId(f.id)}
        pageSize={12}
        toolbarExtra={
          <>
            <Select value={leagueFilter} onValueChange={setLeagueFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="League" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All leagues</SelectItem>
                {leagues.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Prediction state" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All prediction states</SelectItem>
                {['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'ABSTAINED'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        }
      />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelectedId(null)}
        title={selected ? fixtureLabelOf(selected) : ''}
        description={selected ? `${selected.leagueName} · ${new Date(selected.kickoff).toLocaleString()}` : ''}
        footer={
          selected && (
            <Button className="w-full" onClick={() => navigate(`/data/fixtures/${selected.id}`)}>
              Open full fixture detail <ArrowRight className="h-4 w-4" />
            </Button>
          )
        }
      >
        {selected && (
          <div className="flex flex-col gap-density-lg">
            <div className="grid grid-cols-2 gap-density-md">
              <FixtureFact label="Prediction state"><StatusBadge status={selected.predictionState} /></FixtureFact>
              <FixtureFact label="Market state"><StatusBadge status={selected.marketState} /></FixtureFact>
              <FixtureFact label="Baseline"><StatusBadge status={selected.baselineStatus} /></FixtureFact>
              <FixtureFact label="Provider status"><HealthIndicator status={selected.providerStatus} label={selected.providerStatus} /></FixtureFact>
            </div>
            <div>
              <div className="mb-1 text-xs uppercase text-muted-foreground">Baseline vs current probability</div>
              <div className="flex items-center gap-density-md">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Baseline (locked)</span>
                  <span className="text-xl font-semibold">{selected.baselineProbability}%</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Current</span>
                  <span className="text-xl font-semibold">{selected.currentProbability}%</span>
                </div>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">Pick: {selected.baselinePick} · Model {selected.modelVersion}</div>
            </div>
            <div className="grid grid-cols-2 gap-density-md">
              <div>
                <div className="mb-1 text-xs uppercase text-muted-foreground">Data readiness</div>
                <ProgressBar value={selected.dataReadinessPct} />
              </div>
              <div>
                <div className="mb-1 text-xs uppercase text-muted-foreground">Odds readiness</div>
                <ProgressBar value={selected.oddsReadinessPct} tone="info" />
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}

function FixtureFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}
