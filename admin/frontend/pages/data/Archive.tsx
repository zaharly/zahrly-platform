import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download, RefreshCw, Search, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
import { Input } from '../../lib/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import {
  fetchArchiveCampaignOptions,
  fetchArchiveLive,
  fetchHistoricalBootstrapSnapshot,
  type ArchiveCampaignCompetitionOption,
  type ArchiveCampaignCountryOption,
  type ArchiveCampaignLive,
  type ArchiveCampaignOptions,
  type ArchiveLiveSnapshot,
  type ArchiveRegisteredSeasonOption,
  type HistoricalBootstrapSnapshot,
  type HistoricalSeasonProgress,
} from '../../integrations/archiveLive'

const ALL = 'all'
const PAGE_SIZE = 10

type ArchiveRow = ArchiveCampaignLive & { country_name: string; league_name: string; season_label: string }
type SeasonCard = {
  season: number
  label: string
  totalJobs: number
  processedJobs: number
  archivedJobs: number
  activeJobs: number
  failedJobs: number
  completeness: number
  status: string
  providerLeagues: number
  archiveRecords: number
}

function seasonLabel(season?: number | null) {
  if (season == null) return '—'
  return `${season}/${String(season + 1).slice(-2)}`
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

function datasetStatus(row: HistoricalSeasonProgress) {
  if (row.backfill_failed > 0) return 'BLOCKED'
  if (row.backfill_active > 0) return 'RUNNING'
  if (row.backfill_jobs > 0 && row.backfill_succeeded >= row.backfill_jobs) return 'READY_FOR_ARCHIVE'
  if (row.backfill_jobs > 0) return 'QUEUED'
  return 'READY'
}

function cardFromHistorical(row: HistoricalSeasonProgress, providerLeagues: number, archiveRecords: number): SeasonCard {
  const totalJobs = Number(row.backfill_jobs ?? 0)
  const processedJobs = Number(row.backfill_succeeded ?? 0) + Number(row.backfill_failed ?? 0)
  const archivedJobs = Number(row.archive_succeeded ?? 0)
  const completeness = totalJobs > 0 ? Math.max(0, Math.min(100, (archivedJobs / totalJobs) * 100)) : 0
  return {
    season: row.season,
    label: seasonLabel(row.season),
    totalJobs,
    processedJobs,
    archivedJobs,
    activeJobs: Number(row.backfill_active ?? 0),
    failedJobs: Number(row.backfill_failed ?? 0),
    completeness,
    status: datasetStatus(row),
    providerLeagues,
    archiveRecords,
  }
}

export default function ArchivePage() {
  const [snapshot, setSnapshot] = useState<ArchiveLiveSnapshot | null>(null)
  const [historical, setHistorical] = useState<HistoricalBootstrapSnapshot | null>(null)
  const [options, setOptions] = useState<ArchiveCampaignOptions | null>(null)
  const [selected, setSelected] = useState<ArchiveRow | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [seasonFilter, setSeasonFilter] = useState(ALL)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [archive, bootstrap, campaignOptions] = await Promise.all([
        fetchArchiveLive(),
        fetchHistoricalBootstrapSnapshot(),
        fetchArchiveCampaignOptions(),
      ])
      setSnapshot(archive)
      setHistorical(bootstrap)
      setOptions(campaignOptions)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load live archive data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => { setPage(1) }, [query, seasonFilter])

  const countryById = useMemo(() => new Map((options?.countries ?? []).map((row: ArchiveCampaignCountryOption) => [row.id, row])), [options])
  const competitionById = useMemo(() => new Map((options?.competitions ?? []).map((row: ArchiveCampaignCompetitionOption) => [row.id, row])), [options])

  const rows = useMemo<ArchiveRow[]>(() => (snapshot?.campaigns ?? []).map((campaign) => ({
    ...campaign,
    country_name: countryById.get(campaign.country_id ?? '')?.name ?? campaign.country_id ?? '—',
    league_name: competitionById.get(campaign.competition_id ?? '')?.name ?? campaign.competition_id ?? '—',
    season_label: seasonLabel(campaign.season),
  })), [snapshot, countryById, competitionById])

  const seasons = useMemo<SeasonCard[]>(() => {
    const providerRows = options?.registered_seasons ?? []
    const bySeason = new Map<number, SeasonCard>()
    const historicalRows = historical?.seasons ?? []

    for (const item of historicalRows) {
      const capabilityCount = providerRows.filter((entry) => entry.season === item.season).length
      const archiveRecords = rows.filter((row) => row.season === item.season).length
      bySeason.set(item.season, cardFromHistorical(item, Math.max(Number(item.provider_leagues ?? 0), capabilityCount), archiveRecords))
    }

    for (const item of providerRows) {
      const capabilityCount = providerRows.filter((entry) => entry.season === item.season).length
      if (item.season == null) continue
      if (!bySeason.has(item.season)) {
        bySeason.set(item.season, {
          season: item.season,
          label: seasonLabel(item.season),
          totalJobs: 0,
          processedJobs: 0,
          archivedJobs: 0,
          activeJobs: 0,
          failedJobs: 0,
          completeness: 0,
          status: 'PENDING',
          providerLeagues: capabilityCount,
          archiveRecords: rows.filter((row) => row.season === item.season).length,
        })
      }
    }

    for (const item of snapshot?.seasons ?? []) {
      if (!bySeason.has(item.season)) {
        bySeason.set(item.season, {
          season: item.season,
          label: seasonLabel(item.season),
          totalJobs: item.campaigns,
          processedJobs: item.succeeded + item.failed,
          archivedJobs: item.succeeded,
          activeJobs: item.active,
          failedJobs: item.failed,
          completeness: Number(item.avg_completeness ?? 0),
          status: item.failed > 0 ? 'BLOCKED' : item.active > 0 ? 'RUNNING' : item.succeeded > 0 ? 'READY_FOR_ARCHIVE' : 'PENDING',
          providerLeagues: providerRows.filter((entry) => entry.season === item.season).length,
          archiveRecords: item.campaigns,
        })
      }
    }

    for (const row of rows) {
      if (!bySeason.has(row.season)) {
        bySeason.set(row.season, {
          season: row.season,
          label: row.season_label,
          totalJobs: 0,
          processedJobs: 0,
          archivedJobs: 0,
          activeJobs: 0,
          failedJobs: 0,
          completeness: 0,
          status: 'PENDING',
          providerLeagues: 0,
          archiveRecords: rows.filter((item) => item.season === row.season).length,
        })
      }
    }

    return [...bySeason.values()].sort((a, b) => b.season - a.season)
  }, [historical, options, rows, snapshot])

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (seasonFilter !== ALL && String(row.season) !== seasonFilter) return false
      if (!needle) return true
      return [row.season_label, row.country_name, row.league_name, row.dataset_type, row.provider, row.status, row.worker_status, row.manifest_id, row.object_uri, row.checksum]
        .some((value) => String(value ?? '').toLowerCase().includes(needle))
    })
  }, [rows, query, seasonFilter])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selectedSeasonRows = useMemo(() => selectedSeason == null ? [] : rows.filter((row) => row.season === selectedSeason), [rows, selectedSeason])
  const registeredForSeason = useMemo<ArchiveRegisteredSeasonOption[]>(() => selectedSeason == null ? [] : (options?.registered_seasons ?? []).filter((row) => row.season === selectedSeason), [options, selectedSeason])
  const summary = useMemo(() => ({
    total: rows.length,
    succeeded: rows.filter((row) => row.status === 'SUCCEEDED').length,
    active: rows.filter((row) => ['READY', 'QUEUED', 'RUNNING'].includes(row.status)).length,
    failed: rows.filter((row) => row.status === 'FAILED').length,
  }), [rows])

  function selectSeason(season: number) {
    setSelectedSeason(season)
    setSeasonFilter(String(season))
    setPage(1)
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-density-xl py-density-xl">
      <div className="flex flex-col gap-density-lg">
        <div className="mb-density-xl flex flex-col gap-density-sm">
          <div className="flex flex-wrap items-start justify-between gap-density-md">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Archive &amp; Retrieval</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">Historical campaign progress and archived output by season. Cards show execution progress; the table shows the actual archive records.</p>
            </div>
            <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>
          </div>
        </div>

        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}

        <div className="grid grid-cols-2 gap-density-sm sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {seasons.map((season) => (
            <button key={season.season} type="button" onClick={() => selectSeason(season.season)} className={`flex flex-col gap-2 rounded-lg border p-density-md text-left transition-colors ${selectedSeason === season.season ? 'border-foreground bg-muted/40' : 'border-border bg-card hover:bg-muted/25'}`}>
              <div className="flex items-start justify-between gap-2"><span className="text-sm font-semibold text-foreground">{season.label}</span><StatusBadge status={season.status} dense /></div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>{season.processedJobs.toLocaleString()} / {season.totalJobs.toLocaleString()} processed</span><span>{season.completeness.toFixed(1)}%</span></div>
              <ProgressBar value={season.completeness} size="sm" />
              <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground"><span>{season.archivedJobs.toLocaleString()} archived</span><span>{season.activeJobs.toLocaleString()} active</span><span>{season.failedJobs.toLocaleString()} failed</span><span>{season.providerLeagues.toLocaleString()} leagues</span></div>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-density-md">
          <div className="flex flex-wrap items-center gap-density-sm">
            <div className="relative w-full max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search archive (country, league, dataset)…" className="pl-9" /></div>
            <Select value={seasonFilter} onValueChange={setSeasonFilter}><SelectTrigger className="w-40"><SelectValue placeholder="All seasons" /></SelectTrigger><SelectContent><SelectItem value={ALL}>All seasons</SelectItem>{seasons.map((season) => <SelectItem key={season.season} value={String(season.season)}>{season.label}</SelectItem>)}</SelectContent></Select>
            <div className="ml-auto flex items-center gap-density-sm"><Button variant="outline" onClick={() => exportCsv(filteredRows)}><Download className="h-4 w-4" /> Export</Button>{(query || seasonFilter !== ALL) && <Button variant="ghost" onClick={() => { setQuery(''); setSeasonFilter(ALL); setSelectedSeason(null) }}><X className="h-4 w-4" /> Clear</Button>}</div>
          </div>

          <div className="rounded-lg border border-border bg-card shadow-retool-sm"><div className="relative w-full overflow-auto"><table className="w-full caption-bottom text-sm"><thead className="sticky top-0 z-10 bg-card [&_tr]:border-b"><tr className="border-b transition-colors"><Th>Season</Th><Th>Country</Th><Th>League</Th><Th>Dataset</Th><Th>Rows</Th><Th>Completeness</Th><Th>Status</Th><Th>Created</Th></tr></thead><tbody>
            {pagedRows.map((row) => <tr key={row.campaign_id} onClick={() => setSelected(row)} className="cursor-pointer border-b transition-colors hover:bg-muted/50"><Td>{row.season_label}</Td><Td>{row.country_name}</Td><Td>{row.league_name}</Td><Td>{row.dataset_type}</Td><Td>{Number(row.row_count ?? 0).toLocaleString()}</Td><Td><ProgressBar value={Number(row.completeness_score ?? 0) * 100} size="sm" /></Td><Td><StatusBadge status={row.status} /></Td><Td>{formatDate(row.created_at)}</Td></tr>)}
            {!pagedRows.length && <tr><td colSpan={8} className="p-density-xl text-center text-sm text-muted-foreground">No live archive records match the current filters.</td></tr>}
          </tbody></table></div></div>

          <div className="flex flex-wrap items-center justify-between text-sm text-muted-foreground"><span>{filteredRows.length} records · Page {page} of {pageCount}</span><div className="flex items-center gap-density-sm"><Button variant="outline" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}><ChevronLeft className="h-4 w-4" /> Previous</Button><Button variant="outline" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>Next <ChevronRight className="h-4 w-4" /></Button></div><span>{summary.succeeded} complete · {summary.active} active · {summary.failed} failed</span></div>
        </div>
      </div>

      <DetailDrawer open={!!selected} onOpenChange={(open) => !open && setSelected(null)} title={selected ? `${selected.season_label} · ${selected.league_name}` : ''} description={selected?.campaign_id}>{selected && <div className="flex flex-col gap-density-md text-sm"><Row label="Season" value={selected.season_label} /><Row label="Country" value={selected.country_name} /><Row label="League" value={selected.league_name} /><Row label="Dataset" value={selected.dataset_type} /><Row label="Provider" value={selected.provider} /><Row label="Campaign status" value={<StatusBadge status={selected.status} />} /><Row label="Worker status" value={<StatusBadge status={String(selected.worker_status ?? '—')} dense />} /><Row label="Scope" value={selected.scope_state} /><Row label="Completeness" value={`${(Number(selected.completeness_score ?? 0) * 100).toFixed(2)}%`} /><Row label="Rows" value={Number(selected.row_count ?? 0).toLocaleString()} /><Row label="Attempts" value={String(selected.attempts)} /><Row label="Started" value={formatDate(selected.started_at)} /><Row label="Finished" value={formatDate(selected.finished_at)} /><Row label="Created" value={formatDate(selected.created_at)} /><Row label="Updated" value={formatDate(selected.updated_at)} /></div>}</DetailDrawer>

      {selectedSeason != null && <DetailDrawer open onOpenChange={(open) => !open && setSelectedSeason(null)} title={`Season ${seasonLabel(selectedSeason)} · summary`} description="Historical execution progress and archive output"><div className="flex flex-col gap-density-lg text-sm"><section className="rounded-md border border-border p-density-md"><h3 className="mb-density-sm font-semibold">Season summary</h3><div className="grid grid-cols-2 gap-density-sm"><Fact label="Provider leagues" value={String(seasons.find((item) => item.season === selectedSeason)?.providerLeagues ?? 0)} /><Fact label="Archive records" value={String(seasons.find((item) => item.season === selectedSeason)?.archiveRecords ?? selectedSeasonRows.length)} /><Fact label="Processed" value={String(seasons.find((item) => item.season === selectedSeason)?.processedJobs ?? 0)} /><Fact label="Archived" value={String(seasons.find((item) => item.season === selectedSeason)?.archivedJobs ?? 0)} /></div><div className="mt-4"><ProgressBar value={seasons.find((item) => item.season === selectedSeason)?.completeness ?? 0} /></div></section><section className="rounded-md border border-border p-density-md"><h3 className="mb-density-sm font-semibold">Provider capabilities</h3>{registeredForSeason.length ? registeredForSeason.map((item) => <div key={`${item.provider}-${item.competition_id}-${item.endpoint}-${item.market ?? ''}`} className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0"><span>{item.provider} · {item.endpoint}{item.market ? ` · ${item.market}` : ''}</span><StatusBadge status={item.status} dense /></div>) : <span className="text-muted-foreground">No provider capability records for this season.</span>}</section></div></DetailDrawer>}
    </div>
  )
}

function Th({ children }: { children: ReactNode }) { return <th scope="col" className="h-12 px-density-lg text-left align-middle font-medium text-muted-foreground">{children}</th> }
function Td({ children }: { children: ReactNode }) { return <td className="p-density-lg align-middle">{children}</td> }
function Fact({ label, value }: { label: string; value: string }) { return <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-sm font-semibold">{value}</div></div> }
function Row({ label, value }: { label: string; value: ReactNode }) { return <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-border/60 py-2 last:border-0"><span className="text-muted-foreground">{label}</span><span className="min-w-0 break-words">{value}</span></div> }

function exportCsv(rows: ArchiveRow[]) {
  const header = ['season','country','league','dataset','rows','completeness','status','created_at']
  const body = rows.map((row) => [row.season_label,row.country_name,row.league_name,row.dataset_type,row.row_count ?? 0,Number(row.completeness_score ?? 0),row.status,row.created_at])
  const csv = [header, ...body].map((line) => line.map((value) => `"${String(value ?? '').replaceAll('"','""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'archive.csv'
  a.click()
  URL.revokeObjectURL(url)
}
