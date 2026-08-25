import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
import { RefreshCw, Power, PowerOff } from 'lucide-react'
import { toast } from '../../lib/shadcn/sonner'
import { fetchProviderCatalogLive, setDataControl, type LiveCountry, type LiveCompetition } from '../../integrations/providerCatalogLive'

function isEnabled(country: LiveCountry) {
  return country.processing_state === 'ENABLED'
}

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
      setSelected((current) => current ? live.countries.find((c) => c.id === current.id) ?? null : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load countries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function toggleCountry(country: LiveCountry) {
    const next = isEnabled(country) ? 'DISABLED' : 'ENABLED'
    try {
      await setDataControl('country', country.id, next)
      const fresh = await fetchProviderCatalogLive()
      const updated = fresh.countries.find((c) => c.id === country.id)
      if (!updated || (updated.processing_state === 'ENABLED') !== (next === 'ENABLED')) throw new Error('Country ingestion state was not persisted.')
      setCountries(fresh.countries)
      setCompetitions(fresh.competitions)
      setSelected((current) => current ? fresh.countries.find((c) => c.id === current.id) ?? null : null)
      toast.success(`${country.name}: ${next === 'ENABLED' ? 'enabled for ingestion' : 'disabled for ingestion'}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to update ingestion state')
    }
  }

  const rows = useMemo(() => countries.map((country) => ({ ...country, ingestion_enabled: isEnabled(country) })), [countries])

  const columns = useMemo<ColumnDef<(typeof rows)[number], any>[]>(() => [
    { accessorKey: 'name', header: 'Country' },
    { accessorKey: 'code', header: 'Code' },
    { accessorKey: 'status', header: 'Catalog status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'league_count', header: 'Leagues' },
    { accessorKey: 'enabled_league_count', header: 'Enabled leagues' },
    { id: 'ingestion', header: 'Ingestion', cell: ({ row }) => <StatusBadge status={row.original.ingestion_enabled ? 'ENABLED' : 'DISABLED'} dense /> },
    { id: 'actions', header: 'Actions', enableSorting: false, cell: ({ row }) => <Button variant="ghost" size="sm" title={row.original.ingestion_enabled ? 'Disable ingestion' : 'Enable ingestion'} onClick={(e) => { e.stopPropagation(); void toggleCountry(row.original) }}>{row.original.ingestion_enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}</Button> },
  ], [countries])

  const selectedCompetitions = selected ? competitions.filter((c) => c.country_id === selected.id) : []

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader title="Countries" description="Provider catalog countries and the Zahrly ingestion decision. Catalog status is informational; the toggle controls whether this country can enter future season campaigns." actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}
      <DataTable columns={columns} data={rows} searchPlaceholder="Search countries…" onRowClick={setSelected} pageSize={15} />

      <DetailDrawer open={!!selected} onOpenChange={(open) => !open && setSelected(null)} title={selected?.name} description={selected ? `${selected.code} · catalog ${selected.status}` : ''}>
        {selected && <div className="flex flex-col gap-density-lg">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Catalog status"><StatusBadge status={selected.status} /></Fact>
            <Fact label="Ingestion"><StatusBadge status={isEnabled(selected) ? 'ENABLED' : 'DISABLED'} /></Fact>
            <Fact label="Leagues">{selected.league_count}</Fact>
            <Fact label="Enabled leagues">{selected.enabled_league_count}</Fact>
            <Fact label="Backfill jobs">{selected.backfill_job_count}</Fact>
            <Fact label="Archive manifests">{selected.archive_manifest_count}</Fact>
          </div>
          <Button onClick={() => void toggleCountry(selected)} variant={isEnabled(selected) ? 'outline' : 'default'}>{isEnabled(selected) ? <><PowerOff className="h-4 w-4" /> Disable ingestion</> : <><Power className="h-4 w-4" /> Enable ingestion</>}</Button>
          <div>
            <div className="mb-2 text-sm font-medium">Leagues in this country</div>
            <div className="flex flex-col gap-2">
              {selectedCompetitions.length === 0 ? <div className="text-sm text-muted-foreground">No catalog leagues are linked to this country.</div> : selectedCompetitions.map((competition) => (
                <div key={competition.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-3"><div className="font-medium">{competition.name}</div><StatusBadge status={competition.processing_state === 'ENABLED' ? 'ENABLED' : 'DISABLED'} dense /></div>
                  <div className="mt-1 text-xs text-muted-foreground">Catalog: {competition.status} · {competition.registered_seasons} provider seasons · {competition.backfill_jobs.total} backfill jobs</div>
                </div>
              ))}
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
