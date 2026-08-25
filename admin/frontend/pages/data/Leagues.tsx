import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { Button } from '../../lib/shadcn/button'
import { RefreshCw } from 'lucide-react'
import { fetchProviderCatalogLive, type LiveCompetition } from '../../integrations/providerCatalogLive'

export default function Leagues() {
  const [competitions, setCompetitions] = useState<LiveCompetition[]>([])
  const [countryMap, setCountryMap] = useState<Record<string, string>>({})
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
      setError(e instanceof Error ? e.message : 'Unable to load live leagues')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const rows = useMemo(() => competitions.map((league) => ({
    ...league,
    countryName: countryMap[league.country_id] ?? '—',
    status: 'LIVE',
    coveragePct: league.supported_seasons > 0 ? 100 : 0,
    seasonList: league.seasons.join(', '),
  })), [competitions, countryMap])

  const columns = useMemo<ColumnDef<(typeof rows)[number], any>[]>(() => [
    { accessorKey: 'name', header: 'League' },
    { accessorKey: 'countryName', header: 'Country' },
    { accessorKey: 'status', header: 'Source', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'supported_seasons', header: 'Supported seasons' },
    { accessorKey: 'seasonList', header: 'Seasons' },
    { accessorKey: 'coveragePct', header: 'Provider coverage', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" /> },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Leagues"
        description="Live competitions persisted from the provider registry. Season availability is reported from real API-Football registrations; no mock league catalogue is used."
        actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}
      <DataTable columns={columns} data={rows} searchPlaceholder="Search leagues…" pageSize={15} />
    </div>
  )
}
