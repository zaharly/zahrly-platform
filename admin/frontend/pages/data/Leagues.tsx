import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
import { RefreshCw } from 'lucide-react'
import { fetchProviderCatalogLive, type LiveCompetition } from '../../integrations/providerCatalogLive'

export default function Leagues() {
  const [competitions, setCompetitions] = useState<LiveCompetition[]>([])
  const [countryMap, setCountryMap] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<LiveCompetition | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const live = await fetchProviderCatalogLive()
      setCompetitions(live.competitions)
      setCountryMap(Object.fromEntries(live.countries.map((c) => [c.id, `${c.name} (${c.code})`])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load league operational state')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const rows = useMemo(() => competitions.map((league) => ({
    ...league,
    countryName: countryMap[league.country_id] ?? '—',
    seasonCount: league.seasons.length,
    archiveCount: league.archive.manifest_count,
    backfillCount: league.backfill_jobs.total,
    completenessPct: Math.max(0, Math.min(100, Number(league.archive.completeness) * 100)),
  })), [competitions, countryMap])

  const columns = useMemo<ColumnDef<(typeof rows)[number], any>[]>(() => [
    { accessorKey: 'name', header: 'League' },
    { accessorKey: 'countryName', header: 'Country' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'processing_state', header: 'Processing' },
    { accessorKey: 'seasonCount', header: 'Registered seasons' },
    { accessorKey: 'backfillCount', header: 'Backfill jobs' },
    { accessorKey: 'archiveCount', header: 'Archive manifests' },
    { accessorKey: 'completenessPct', header: 'Archive completeness', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" /> },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Leagues"
        description="Canonical competition state from Supabase. Provider capabilities, season scope, processing controls, backfill, and archive state remain distinct and inspectable."
        actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}
      <DataTable columns={columns} data={rows} searchPlaceholder="Search leagues…" onRowClick={setSelected} pageSize={15} />
      <DetailDrawer
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.name}
        description={selected ? `${countryMap[selected.country_id] ?? 'Unknown country'} · ${selected.status}` : ''}
      >
        {selected && (
          <div className="flex flex-col gap-density-md">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Status</div><StatusBadge status={selected.status} dense /></div>
              <div><div className="text-xs text-muted-foreground">Processing</div><div className="font-medium">{selected.processing_state ?? '—'}</div></div>
              <div><div className="text-xs text-muted-foreground">Processing reason</div><div className="font-medium">{selected.processing_reason ?? '—'}</div></div>
              <div><div className="text-xs text-muted-foreground">Registered seasons</div><div className="font-medium">{selected.registered_seasons}</div></div>
              <div><div className="text-xs text-muted-foreground">Backfill jobs</div><div className="font-medium">{selected.backfill_jobs.total}</div></div>
              <div><div className="text-xs text-muted-foreground">Archive manifests</div><div className="font-medium">{selected.archive.manifest_count}</div></div>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">Season scope</div>
              <div className="flex flex-col gap-2">
                {selected.seasons.length === 0 ? <div className="text-sm text-muted-foreground">No provider season registration yet.</div> : selected.seasons.map((season) => (
                  <div key={season.season} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-3"><div className="font-medium">{season.season}/{season.season + 1}</div><StatusBadge status={season.status} dense /></div>
                    <div className="mt-1 text-xs text-muted-foreground">Endpoints: {season.endpoints.join(', ') || '—'}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Checked: {season.checked_at ? new Date(season.checked_at).toLocaleString() : '—'}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium">Backfill</div>
              <div className="mt-1 text-muted-foreground">Queued {selected.backfill_jobs.queued} · Running {selected.backfill_jobs.running} · Succeeded {selected.backfill_jobs.succeeded} · Failed {selected.backfill_jobs.failed}</div>
              <div className="mt-1 text-muted-foreground">Average progress {selected.backfill_jobs.progress}%</div>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}
