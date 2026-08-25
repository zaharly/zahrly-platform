import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
import { ProgressBar } from '../../components/status/ProgressBar'
import { RefreshCw } from 'lucide-react'
import { fetchProviderCatalogLive, type LiveCountry, type LiveCompetition } from '../../integrations/providerCatalogLive'

export default function Countries() {
  const [countries, setCountries] = useState<LiveCountry[]>([])
  const [competitions, setCompetitions] = useState<LiveCompetition[]>([])
  const [selected, setSelected] = useState<LiveCountry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const live = await fetchProviderCatalogLive()
      setCountries(live.countries)
      setCompetitions(live.competitions)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load country operational state')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const rows = useMemo(() => countries.map((country) => ({
    ...country,
    archiveCoverage: country.archive_manifest_count > 0 ? 100 : 0,
  })), [countries])

  const columns = useMemo<ColumnDef<(typeof rows)[number], any>[]>(() => [
    { accessorKey: 'name', header: 'Country' },
    { accessorKey: 'code', header: 'Code' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'processing_state', header: 'Processing' },
    { accessorKey: 'league_count', header: 'Leagues' },
    { accessorKey: 'enabled_league_count', header: 'Enabled leagues' },
    { accessorKey: 'backfill_job_count', header: 'Backfill jobs' },
    { accessorKey: 'archive_manifest_count', header: 'Archive manifests' },
    { accessorKey: 'archiveCoverage', header: 'Archive signal', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" /> },
  ], [])

  const selectedCompetitions = selected ? competitions.filter((c) => c.country_id === selected.id) : []

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Countries"
        description="Canonical country operational state from Supabase. Provider, processing-control, backfill, and archive state remain visible; this page does not replace operational state with mock/provider-only status."
        actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}
      <DataTable columns={columns} data={rows} searchPlaceholder="Search countries…" onRowClick={setSelected} pageSize={15} />
      <DetailDrawer
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.name}
        description={selected ? `${selected.code} · ${selected.status}` : ''}
      >
        <div className="flex flex-col gap-density-md">
          {selected && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Status</div><StatusBadge status={selected.status} dense /></div>
              <div><div className="text-xs text-muted-foreground">Processing</div><div className="font-medium">{selected.processing_state ?? '—'}</div></div>
              <div><div className="text-xs text-muted-foreground">Processing reason</div><div className="font-medium">{selected.processing_reason ?? '—'}</div></div>
              <div><div className="text-xs text-muted-foreground">Leagues</div><div className="font-medium">{selected.league_count}</div></div>
              <div><div className="text-xs text-muted-foreground">Enabled leagues</div><div className="font-medium">{selected.enabled_league_count}</div></div>
              <div><div className="text-xs text-muted-foreground">Backfill jobs</div><div className="font-medium">{selected.backfill_job_count}</div></div>
              <div><div className="text-xs text-muted-foreground">Archive manifests</div><div className="font-medium">{selected.archive_manifest_count}</div></div>
            </div>
          )}
          <div className="text-sm text-muted-foreground">Competitions and their operational state:</div>
          {selectedCompetitions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No competitions are registered for this country.</div>
          ) : selectedCompetitions.map((competition) => (
            <div key={competition.id} className="rounded-md border border-border p-density-md">
              <div className="flex items-center justify-between gap-3"><div className="font-medium">{competition.name}</div><StatusBadge status={competition.status} dense /></div>
              <div className="mt-1 text-xs text-muted-foreground">
                {competition.registered_seasons} registered seasons · {competition.backfill_jobs.total} backfill jobs · {competition.archive.manifest_count} manifests
              </div>
              {competition.processing_state && <div className="mt-1 text-xs text-muted-foreground">Processing: {competition.processing_state}{competition.processing_reason ? ` · ${competition.processing_reason}` : ''}</div>}
            </div>
          ))}
        </div>
      </DetailDrawer>
    </div>
  )
}
