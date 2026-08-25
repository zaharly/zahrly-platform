import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { Button } from '../../lib/shadcn/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../lib/shadcn/dropdown-menu'
import { toast } from '../../lib/shadcn/sonner'
import { useLeagues, useStoreActions } from '../../state/StoreContext'
import type { League } from '../../types/domain'
import { MoreHorizontal, Gauge, PauseCircle, PlayCircle, Ban, Wrench } from 'lucide-react'

export default function Leagues() {
  const navigate = useNavigate()
  const leagues = useLeagues()
  const actions = useStoreActions()

  const columns = useMemo<ColumnDef<League, any>[]>(() => [
    { accessorKey: 'name', header: 'League' },
    { accessorKey: 'countryName', header: 'Country' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'seasonScope', header: 'Season scope', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'currentSeason', header: 'Current season' },
    { accessorKey: 'fixtureCount', header: 'Fixtures' },
    { accessorKey: 'predictionCount', header: 'Predictions' },
    { accessorKey: 'marketCoveragePct', header: 'Market coverage', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" /> },
    { accessorKey: 'oddsCoveragePct', header: 'Odds coverage', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" tone="info" /> },
    { accessorKey: 'completenessPct', header: 'Completeness', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" tone="success" /> },
    {
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => {
        const league = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="League actions" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>{league.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate(`/data/leagues/${league.id}`)}>
                <Gauge className="h-4 w-4" /> Inspect coverage
              </DropdownMenuItem>
              {league.status === 'ENABLED' ? (
                <DropdownMenuItem onSelect={() => { actions.pauseLeague(league.id, 'Quick pause from league list'); toast.success(`${league.name} paused`) }}>
                  <PauseCircle className="h-4 w-4" /> Pause
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => navigate(`/data/leagues/${league.id}`)}>
                  <PlayCircle className="h-4 w-4" /> Re-enable…
                </DropdownMenuItem>
              )}
              {league.status !== 'DISABLED' && (
                <DropdownMenuItem onSelect={() => { actions.disableLeague(league.id, 'Quick disable from league list'); toast.success(`${league.name} disabled`) }}>
                  <Ban className="h-4 w-4" /> Disable
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => navigate(`/data/leagues/${league.id}?repair=1`)}>
                <Wrench className="h-4 w-4" /> Repair missing history
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
        title="Leagues"
        description="League-level controls for fixtures, odds, enrichment, and prediction eligibility. Disabling a league blocks future processing but never discards historical data."
      />
      <DataTable columns={columns} data={leagues} searchPlaceholder="Search leagues…" onRowClick={(l) => navigate(`/data/leagues/${l.id}`)} pageSize={12} />
    </div>
  )
}
