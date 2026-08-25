import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
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
      setError(e instanceof Error ? e.message : 'Unable to load live countries')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const rows = useMemo(() => countries.map((country) => {
    const countryCompetitions = competitions.filter((c) => c.country_id === country.id)
    return {
      ...country,
      leagueCount: countryCompetitions.length,
      supportedSeasonCount: countryCompetitions.reduce((sum, c) => sum + c.supported_seasons, 0),
      status: 'LIVE',
    }
  }), [countries, competitions])

  const columns = useMemo<ColumnDef<(typeof rows)[number], any>[]>(() => [
    { accessorKey: 'name', header: 'Country' },
    { accessorKey: 'code', header: 'Code' },
    { accessorKey: 'status', header: 'Source', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'leagueCount', header: 'Leagues' },
    { accessorKey: 'supportedSeasonCount', header: 'Registered seasons' },
  ], [])

  const selectedCompetitions = selected ? competitions.filter((c) => c.country_id === selected.id) : []

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Countries"
        description="Live country catalogue derived from the provider-backed database. Countries appear here when the provider registry has persisted them; no mock seed data is used."
        actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}
      <DataTable columns={columns} data={rows} searchPlaceholder="Search countries…" onRowClick={setSelected} pageSize={15} />
      <DetailDrawer
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.name}
        description={selected ? `${selected.code} · live provider catalogue` : ''}
      >
        <div className="flex flex-col gap-density-md">
          <div className="text-sm text-muted-foreground">Competitions persisted for this country:</div>
          {selectedCompetitions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No provider-backed competitions registered yet.</div>
          ) : selectedCompetitions.map((competition) => (
            <div key={competition.id} className="rounded-md border border-border p-density-md">
              <div className="font-medium">{competition.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{competition.supported_seasons} supported season registrations</div>
              {competition.seasons.length > 0 && <div className="mt-2 font-mono text-xs">{competition.seasons.join(', ')}</div>}
            </div>
          ))}
        </div>
      </DetailDrawer>
    </div>
  )
}
