import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import { useCountries, useLeagues, useStoreActions } from '../../state/StoreContext'
import type { Country } from '../../types/domain'
import { Ban, PlayCircle, PauseCircle, Archive } from 'lucide-react'
import { Link } from 'react-router-dom'

type PendingAction = 'disable' | 'pause' | 'enable' | 'archive' | null

export default function Countries() {
  const countries = useCountries()
  const leagues = useLeagues()
  const actions = useStoreActions()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const selected = countries.find((c) => c.id === selectedId) ?? null

  const columns = useMemo<ColumnDef<Country, any>[]>(() => [
    { accessorKey: 'name', header: 'Country' },
    { accessorKey: 'code', header: 'Code' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'leagueCount', header: 'Leagues' },
    { accessorKey: 'activeFixtures', header: 'Active fixtures' },
    { accessorKey: 'historicalProgressPct', header: 'Historical progress', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" /> },
    { accessorKey: 'providerCoveragePct', header: 'Provider coverage', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" tone="info" /> },
    { accessorKey: 'lastSync', header: 'Last sync', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString() },
  ], [])

  const countryLeagues = selected ? leagues.filter((l) => l.countryId === selected.id) : []

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Countries"
        description="Country-level processing controls. Disabling a country blocks child leagues and provider acquisition without discarding historical data."
      />
      <DataTable columns={columns} data={countries} searchPlaceholder="Search countries…" onRowClick={(c) => setSelectedId(c.id)} />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelectedId(null)}
        title={selected?.name}
        description={`${selected?.code} · ${selected?.leagueCount} leagues`}
        footer={
          selected && (
            <div className="flex flex-wrap justify-end gap-density-sm">
              {selected.status !== 'ENABLED' && (
                <Button variant="outline" onClick={() => setPendingAction('enable')}>
                  <PlayCircle className="h-4 w-4" /> Re-enable
                </Button>
              )}
              {selected.status === 'ENABLED' && (
                <Button variant="outline" onClick={() => setPendingAction('pause')}>
                  <PauseCircle className="h-4 w-4" /> Pause
                </Button>
              )}
              {selected.status !== 'ARCHIVED' && (
                <Button variant="outline" onClick={() => setPendingAction('archive')}>
                  <Archive className="h-4 w-4" /> Archive
                </Button>
              )}
              {selected.status !== 'DISABLED' && (
                <Button variant="destructive" onClick={() => setPendingAction('disable')}>
                  <Ban className="h-4 w-4" /> Disable
                </Button>
              )}
            </div>
          )
        }
      >
        {selected && (
          <div className="flex flex-col gap-density-lg">
            <div className="grid grid-cols-2 gap-density-md">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Status</div>
                <StatusBadge status={selected.status} className="mt-1" />
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Active fixtures</div>
                <div className="text-sm font-medium">{selected.activeFixtures}</div>
              </div>
              <div className="col-span-2">
                <div className="mb-1 text-xs uppercase text-muted-foreground">Historical progress</div>
                <ProgressBar value={selected.historicalProgressPct} />
              </div>
              <div className="col-span-2">
                <div className="mb-1 text-xs uppercase text-muted-foreground">Provider coverage</div>
                <ProgressBar value={selected.providerCoveragePct} tone="info" />
              </div>
            </div>

            <div>
              <div className="mb-density-sm text-sm font-semibold text-foreground">Leagues in this country</div>
              <ul className="flex flex-col gap-density-sm">
                {countryLeagues.map((l) => (
                  <li key={l.id} className="flex items-center justify-between rounded-md border border-border p-density-sm">
                    <Link to="/data/leagues" className="text-sm font-medium text-foreground hover:underline">{l.name}</Link>
                    <StatusBadge status={l.status} dense />
                  </li>
                ))}
                {countryLeagues.length === 0 && <li className="text-sm text-muted-foreground">No leagues configured.</li>}
              </ul>
            </div>
          </div>
        )}
      </DetailDrawer>

      {selected && (
        <ConfirmDialog
          open={pendingAction === 'disable'}
          onOpenChange={(o) => !o && setPendingAction(null)}
          title={`Disable ${selected.name}`}
          actionSummary="Blocks future processing and provider requests for all child leagues. Historical data is preserved."
          scope={`${selected.name} and its ${selected.leagueCount} leagues`}
          consequences={[
            'No new fixtures, odds, or predictions will be produced for this country.',
            'Existing historical and archived data is never discarded.',
            'Re-enabling will first show an archive diff before resuming processing.',
          ]}
          confirmLabel="Disable country"
          onConfirm={(reason) => {
            actions.disableCountry(selected.id, reason)
            toast.success(`${selected.name} disabled`, { description: 'Child leagues remain in the archive — future processing is blocked.' })
          }}
        />
      )}
      {selected && (
        <ConfirmDialog
          open={pendingAction === 'pause'}
          onOpenChange={(o) => !o && setPendingAction(null)}
          title={`Pause ${selected.name}`}
          actionSummary="Temporarily halts new acquisition while keeping the country eligible for quick resume."
          scope={`${selected.name} and its ${selected.leagueCount} leagues`}
          consequences={['New processing jobs are paused.', 'In-flight jobs complete normally.', 'Can be resumed at any time without an archive diff review.']}
          confirmLabel="Pause country"
          destructive={false}
          onConfirm={(reason) => {
            actions.pauseCountry(selected.id, reason)
            toast.success(`${selected.name} paused`)
          }}
        />
      )}
      {selected && (
        <ConfirmDialog
          open={pendingAction === 'archive'}
          onOpenChange={(o) => !o && setPendingAction(null)}
          title={`Archive ${selected.name}`}
          actionSummary="Moves this country to archive-only scope. Historical data remains searchable in the Archive Center."
          scope={`${selected.name} and its ${selected.leagueCount} leagues`}
          consequences={['No new processing of any kind occurs for this country.', 'All historical data remains browsable and restorable from the Archive Center.']}
          confirmLabel="Archive country"
          destructive={false}
          onConfirm={(reason) => {
            actions.archiveCountry(selected.id, reason)
            toast.success(`${selected.name} archived`)
          }}
        />
      )}
      {selected && (
        <ConfirmDialog
          open={pendingAction === 'enable'}
          onOpenChange={(o) => !o && setPendingAction(null)}
          title={`Re-enable ${selected.name}`}
          actionSummary="Inspects the archive for existing data, determines what is missing, and queues only the gap before resuming rolling production."
          scope={`${selected.name} and its ${selected.leagueCount} leagues`}
          consequences={[
            'Archive difference will be computed before any new requests are queued.',
            'Only missing or invalidated historical data will be re-acquired.',
            'Current rolling production resumes once the eligibility check passes.',
          ]}
          confirmLabel="Re-enable country"
          destructive={false}
          onConfirm={(reason) => {
            actions.reEnableCountry(selected.id, reason)
            toast.success(`${selected.name} re-enabled`, { description: 'Rolling production will resume once eligibility checks pass.' })
          }}
        />
      )}
    </div>
  )
}
