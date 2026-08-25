import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
import { RefreshCw, Power, PowerOff } from 'lucide-react'
import { toast } from '../../lib/shadcn/sonner'
import { fetchProviderCatalogLive, setDataControl, type LiveCompetition } from '../../integrations/providerCatalogLive'

function isEnabled(league: LiveCompetition) {
  return league.processing_state === 'ENABLED'
}

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
      setSelected((current) => current ? live.competitions.find((c) => c.id === current.id) ?? null : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load leagues')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function toggleLeague(league: LiveCompetition) {
    const next = isEnabled(league) ? 'DISABLED' : 'ENABLED'
    try {
      await setDataControl('competition', league.id, next)
      toast.success(`${league.name}: ${next === 'ENABLED' ? 'enabled for ingestion' : 'disabled for ingestion'}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to update ingestion state')
    }
  }

  const rows = useMemo(() => competitions.map((league) => ({
    ...league,
    countryName: countryMap[league.country_id] ?? '—',
    ingestion_enabled: isEnabled(league),
  })), [competitions, countryMap])

  const columns = useMemo<ColumnDef<(typeof rows)[number], any>[]>(() => [
    { accessorKey: 'name', header: 'League' },
    { accessorKey: 'countryName', header: 'Country' },
    { accessorKey: 'status', header: 'Catalog status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'seasonCount', header: 'Provider seasons', cell: ({ row }) => row.original.registered_seasons },
    { accessorKey: 'ingestion_enabled', header: 'Ingestion', cell: ({ row }) => <StatusBadge status={row.original.ingestion_enabled ? 'ENABLED' : 'DISABLED'} dense /> },
    {
      id: 'actions', header: 'Actions', enableSorting: false,
      cell: ({ row }) => <Button variant="ghost" size="sm" title={row.original.ingestion_enabled ? 'Disable ingestion' : 'Enable ingestion'} onClick={(e) => { e.stopPropagation(); void toggleLeague(row.original) }}>{row.original.ingestion_enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}</Button>,
    },
  ], [competitions, countryMap])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader title="Leagues" description="Provider catalog leagues and the Zahrly ingestion decision. Season completeness is evaluated inside a specific historical campaign, not as a permanent league property." actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}
      <DataTable columns={columns} data={rows} searchPlaceholder="Search leagues…" onRowClick={setSelected} pageSize={15} />

      <DetailDrawer open={!!selected} onOpenChange={(open) => !open && setSelected(null)} title={selected?.name} description={selected ? `${countryMap[selected.country_id] ?? 'Unknown country'} · catalog ${selected.status}` : ''}>
        {selected && <div className="flex flex-col gap-density-lg">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Catalog status"><StatusBadge status={selected.status} /></Fact>
            <Fact label="Ingestion"><StatusBadge status={isEnabled(selected) ? 'ENABLED' : 'DISABLED'} /></Fact>
            <Fact label="Provider seasons">{selected.registered_seasons}</Fact>
            <Fact label="Backfill jobs">{selected.backfill_jobs.total}</Fact>
          </div>

          <Button onClick={() => void toggleLeague(selected)} variant={isEnabled(selected) ? 'outline' : 'default'}>{isEnabled(selected) ? <><PowerOff className="h-4 w-4" /> Disable ingestion</> : <><Power className="h-4 w-4" /> Enable ingestion</>}</Button>

          <div>
            <div className="mb-2 text-sm font-medium">Season coverage and processing history</div>
            <div className="flex flex-col gap-2">
              {selected.seasons.length === 0 ? <div className="text-sm text-muted-foreground">No season coverage is recorded for this league.</div> : selected.seasons.map((season) => {
                const completeness = Math.max(0, Math.min(100, Number(season.archive.completeness) * 100))
                return <div key={season.season} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2"><div className="font-medium">{season.season}/{season.season + 1}</div><div className="flex items-center gap-2"><StatusBadge status={season.status} dense /><StatusBadge status={season.provider_status} dense /></div></div>
                  <div className="mt-1 text-xs text-muted-foreground">Backfill {season.backfill.total} jobs · {season.backfill.progress}% · {season.backfill.requests_used ?? 0} requests</div>
                  <div className="mt-1 text-xs text-muted-foreground">Archive manifests {season.archive.manifest_count} · completeness {completeness.toFixed(1)}%</div>
                </div>
              })}
            </div>
          </div>
        </div>}
      </DetailDrawer>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><div className="mb-1 text-xs uppercase text-muted-foreground">{label}</div><div className="font-medium">{children}</div></div>
}
