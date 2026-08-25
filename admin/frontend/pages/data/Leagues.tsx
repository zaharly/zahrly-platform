import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
import { RefreshCw, Pause, Play, Ban, Archive, Database, RotateCcw } from 'lucide-react'
import { toast } from '../../lib/shadcn/sonner'
import { fetchProviderCatalogLive, setDataControl, type LiveCompetition } from '../../integrations/providerCatalogLive'
import { queueBackfillSeason } from '../../integrations/archiveLive'

const ACTIONS = [
  { state: 'ENABLED' as const, label: 'Enable', icon: Play },
  { state: 'PAUSED' as const, label: 'Pause', icon: Pause },
  { state: 'DISABLED' as const, label: 'Disable', icon: Ban },
  { state: 'ARCHIVED' as const, label: 'Archive', icon: Archive },
]

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
      setError(e instanceof Error ? e.message : 'Unable to load league operational state')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function changeState(league: LiveCompetition, state: 'ENABLED' | 'PAUSED' | 'DISABLED' | 'ARCHIVED') {
    const reason = window.prompt(`Reason for ${state.toLowerCase()} ${league.name}?`, league.processing_reason ?? '')
    if (reason === null) return
    try {
      await setDataControl('competition', league.id, state, reason.trim() || undefined)
      toast.success(`${league.name}: ${state}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to update league state')
    }
  }

  async function queueSeason(league: LiveCompetition, season: number) {
    try {
      await queueBackfillSeason(league.id, season, 'evaluation_metrics')
      toast.success(`Backfill queued: ${league.name} ${season}/${season + 1}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to queue backfill')
    }
  }

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
    { accessorKey: 'status', header: 'Catalog', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'processing_state', header: 'Processing', cell: ({ getValue }) => <StatusBadge status={getValue<string>() ?? '—'} dense /> },
    { accessorKey: 'seasonCount', header: 'Provider seasons' },
    { accessorKey: 'backfillCount', header: 'Backfill jobs' },
    { accessorKey: 'archiveCount', header: 'Archive manifests' },
    { accessorKey: 'completenessPct', header: 'Archive completeness', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" /> },
    {
      id: 'actions', header: 'Control', enableSorting: false,
      cell: ({ row }) => <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>{ACTIONS.slice(0, 3).map(({ state, label, icon: Icon }) => <Button key={state} variant="ghost" size="sm" title={label} onClick={() => void changeState(row.original, state)}><Icon className="h-3.5 w-3.5" /></Button>)}</div>,
    },
  ], [competitions])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader title="Leagues" description="Canonical competitions with provider capability, ACTIVE / ARCHIVE_ONLY / BLOCKED season scope, backfill progress, archive manifests, and campaign lineage." actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}
      <DataTable columns={columns} data={rows} searchPlaceholder="Search leagues…" onRowClick={setSelected} pageSize={15} />

      <DetailDrawer open={!!selected} onOpenChange={(open) => !open && setSelected(null)} title={selected?.name} description={selected ? `${countryMap[selected.country_id] ?? 'Unknown country'} · ${selected.status}` : ''}>
        {selected && <div className="flex flex-col gap-density-lg">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Catalog"><StatusBadge status={selected.status} /></Fact>
            <Fact label="Processing"><StatusBadge status={selected.processing_state ?? 'ENABLED'} /></Fact>
            <Fact label="Reason">{selected.processing_reason ?? '—'}</Fact>
            <Fact label="Provider seasons">{selected.registered_seasons}</Fact>
            <Fact label="Backfill jobs">{selected.backfill_jobs.total}</Fact>
            <Fact label="Archive manifests">{selected.archive.manifest_count}</Fact>
            <Fact label="Archive completeness"><ProgressBar value={Number(selected.archive.completeness) * 100} /></Fact>
          </div>

          <div className="flex flex-wrap gap-2">{ACTIONS.map(({ state, label, icon: Icon }) => <Button key={state} size="sm" variant={state === selected.processing_state ? 'default' : 'outline'} onClick={() => void changeState(selected, state)}><Icon className="h-4 w-4" /> {label}</Button>)}</div>

          <div>
            <div className="mb-2 text-sm font-medium">Season scope</div>
            <div className="flex flex-col gap-2">
              {selected.seasons.length === 0 ? <div className="text-sm text-muted-foreground">No API-Football registration for this league yet.</div> : selected.seasons.map((season) => {
                const completeness = Math.max(0, Math.min(100, Number(season.archive.completeness) * 100))
                return <div key={season.season} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{season.season}/{season.season + 1}</div>
                    <div className="flex items-center gap-2"><StatusBadge status={season.status} dense /><StatusBadge status={season.provider_status} dense /></div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Endpoints: {season.endpoints.join(', ') || '—'} · Checked: {season.checked_at ? new Date(season.checked_at).toLocaleString() : '—'}</div>
                  {season.blocked_reason && <div className="mt-1 text-xs text-destructive">{season.blocked_reason}</div>}
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div><div className="text-muted-foreground">Backfill</div><div className="font-medium">{season.backfill.total} jobs · {season.backfill.progress}% · {season.backfill.requests_used ?? 0} requests</div></div>
                    <div><div className="text-muted-foreground">Archive</div><div className="font-medium">{season.archive.manifest_count} manifests · {completeness.toFixed(1)}%</div></div>
                    <div><div className="text-muted-foreground">Campaigns</div><div className="font-medium">{season.campaigns?.total ?? 0} total · {season.campaigns?.succeeded ?? 0} succeeded</div></div>
                    <div><div className="text-muted-foreground">Actions</div><div className="flex gap-2 mt-1"><Button size="sm" variant="outline" disabled={season.status !== 'ACTIVE'} onClick={() => void queueSeason(selected, season.season)}><Database className="h-3.5 w-3.5" /> Queue backfill</Button>{season.backfill.failed > 0 && <Button size="sm" variant="outline" disabled><RotateCcw className="h-3.5 w-3.5" /> Review failures</Button>}</div></div>
                  </div>
                  <div className="mt-2"><ProgressBar value={completeness} size="sm" /></div>
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
