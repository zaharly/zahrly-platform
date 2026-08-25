import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
import { ProgressBar } from '../../components/status/ProgressBar'
import { RefreshCw, Pause, Play, Ban, Archive } from 'lucide-react'
import { toast } from '../../lib/shadcn/sonner'
import { fetchProviderCatalogLive, setDataControl, type LiveCountry, type LiveCompetition } from '../../integrations/providerCatalogLive'

const ACTIONS = [
  { state: 'ENABLED' as const, label: 'Enable', icon: Play },
  { state: 'PAUSED' as const, label: 'Pause', icon: Pause },
  { state: 'DISABLED' as const, label: 'Disable', icon: Ban },
  { state: 'ARCHIVED' as const, label: 'Archive', icon: Archive },
]

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
      setError(e instanceof Error ? e.message : 'Unable to load country operational state')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function changeState(country: LiveCountry, state: 'ENABLED' | 'PAUSED' | 'DISABLED' | 'ARCHIVED') {
    const reason = window.prompt(`Reason for ${state.toLowerCase()} ${country.name}?`, country.processing_reason ?? '')
    if (reason === null) return
    try {
      await setDataControl('country', country.id, state, reason.trim() || undefined)
      toast.success(`${country.name}: ${state}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to update country state')
    }
  }

  const rows = useMemo(() => countries.map((country) => ({ ...country })), [countries])
  const columns = useMemo<ColumnDef<(typeof rows)[number], any>[]>(() => [
    { accessorKey: 'name', header: 'Country' },
    { accessorKey: 'code', header: 'Code' },
    { accessorKey: 'status', header: 'Catalog', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'processing_state', header: 'Processing', cell: ({ getValue }) => <StatusBadge status={getValue<string>() ?? '—'} dense /> },
    { accessorKey: 'league_count', header: 'Leagues' },
    { accessorKey: 'enabled_league_count', header: 'Enabled leagues' },
    { accessorKey: 'backfill_job_count', header: 'Backfill jobs' },
    { accessorKey: 'archive_manifest_count', header: 'Archive manifests' },
    { accessorKey: 'archive_completeness', header: 'Archive completeness', cell: ({ getValue }) => <ProgressBar value={Number(getValue()) * 100} size="sm" /> },
    {
      id: 'actions', header: 'Control', enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {ACTIONS.slice(0, 3).map(({ state, label, icon: Icon }) => (
            <Button key={state} variant="ghost" size="sm" onClick={() => void changeState(row.original, state)} title={label}>
              <Icon className="h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
      ),
    },
  ], [countries])

  const selectedCompetitions = selected ? competitions.filter((c) => c.country_id === selected.id) : []

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader title="Countries" description="Canonical country control plane: processing state, leagues, historical backfill, archive completeness, and provider-backed seasons." actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}
      <DataTable columns={columns} data={rows} searchPlaceholder="Search countries…" onRowClick={setSelected} pageSize={15} />
      <DetailDrawer open={!!selected} onOpenChange={(open) => !open && setSelected(null)} title={selected?.name} description={selected ? `${selected.code} · ${selected.status} · ${selected.processing_state ?? 'ENABLED'}` : ''}>
        {selected && <div className="flex flex-col gap-density-lg">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Catalog status"><StatusBadge status={selected.status} /></Fact>
            <Fact label="Processing"><StatusBadge status={selected.processing_state ?? 'ENABLED'} /></Fact>
            <Fact label="Reason">{selected.processing_reason ?? '—'}</Fact>
            <Fact label="Leagues">{selected.league_count}</Fact>
            <Fact label="Enabled leagues">{selected.enabled_league_count}</Fact>
            <Fact label="Backfill jobs">{selected.backfill_job_count}</Fact>
            <Fact label="Archive manifests">{selected.archive_manifest_count}</Fact>
            <Fact label="Archive completeness"><ProgressBar value={Number(selected.archive_completeness) * 100} /></Fact>
          </div>

          <div className="flex flex-wrap gap-2">
            {ACTIONS.map(({ state, label, icon: Icon }) => <Button key={state} variant={state === selected.processing_state ? 'default' : 'outline'} size="sm" onClick={() => void changeState(selected, state)}><Icon className="h-4 w-4" /> {label}</Button>)}
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Leagues in this country</div>
            <div className="flex flex-col gap-2">
              {selectedCompetitions.length === 0 ? <div className="text-sm text-muted-foreground">No canonical leagues yet. Run season discovery from Historical Bootstrap.</div> : selectedCompetitions.map((competition) => (
                <div key={competition.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-3"><div className="font-medium">{competition.name}</div><StatusBadge status={competition.status} dense /></div>
                  <div className="mt-1 text-xs text-muted-foreground">Processing: {competition.processing_state ?? 'ENABLED'} · {competition.registered_seasons} provider seasons · {competition.backfill_jobs.total} backfill jobs · {competition.archive.manifest_count} manifests</div>
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
