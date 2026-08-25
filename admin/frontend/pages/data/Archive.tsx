import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Columns3, Download, RefreshCw, Search, X, ChevronLeft, ChevronRight } from 'lucide-react'
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
} from '../../integrations/archiveLive'

const ALL = 'all'
const PAGE_SIZE = 10

type ArchiveRow = ArchiveCampaignLive & { country_name: string; league_name: string; season_label: string }
type SeasonCard = { season: number; label: string; campaigns: number; succeeded: number; active: number; failed: number; completeness: number; status: string; providerLeagues: number; registeredCapabilities: number }

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
      const [archive, bootstrap, campaignOptions] = await Promise.all([fetchArchiveLive(), fetchHistoricalBootstrapSnapshot(), fetchArchiveCampaignOptions()])
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
    const bySeason = new Map<number, SeasonCard>()
    const providerRows = options?.registered_seasons ?? []
    const blockedText = JSON.stringify(historical?.blocked_scopes ?? []).toLowerCase()

    for (const item of historical?.seasons ?? []) {
      const completeness = Number(item.archive_completeness ?? 0) * 100
      const capabilityCount = providerRows.filter((entry) => entry.season === item.season).length
      bySeason.set(item.season, {
        season: item.season,
        label: seasonLabel(item.season),
        campaigns: item.archive_campaigns,
        succeeded: item.archive_succeeded,
        active: Math.max(item.archive_campaigns - item.archive_succeeded, 0),
        failed: 0,
        completeness,
        status: seasonStatus(item.season, completeness, item.archive_succeeded, item.archive_campaigns, blockedText),
        providerLeagues: Math.max(item.provider_leagues, capabilityCount),
        registeredCapabilities: capabilityCount,
      })
    }

    for (const item of providerRows) {
      const capabilityCount = providerRows.filter((entry) => entry.season === item.season).length
      const existing = bySeason.get(item.season)
      if (existing) {
        existing.providerLeagues = Math.max(existing.providerLeagues, capabilityCount)
        existing.registeredCapabilities = capabilityCount
      } else {
        bySeason.set(item.season, {
          season: item.season,
          label: seasonLabel(item.season),
          campaigns: 0,
          succeeded: 0,
          active: 0,
          failed: 0,
          completeness: 0,
          status: seasonStatus(item.season, 0, 0, 0, blockedText),
          providerLeagues: capabilityCount,
          registeredCapabilities: capabilityCount,
        })
      }
    }

    for (const row of rows) {
      if (!bySeason.has(row.season)) {
        bySeason.set(row.season, {
          season: row.season,
          label: row.season_label,
          campaigns: 0,
          succeeded: 0,
          active: 0,
          failed: 0,
          completeness: 0,
          status: 'PENDING',
          providerLeagues: 0,
          registeredCapabilities: 0,
        })
      }
    }

    return [...bySeason.values()].sort((a, b) => b.season - a.season)
  }, [historical, options, rows])

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
  const summary = useMemo(() => ({ total: rows.length, succeeded: rows.filter((row) => row.status === 'SUCCEEDED').length, active: rows.filter((row) => ['READY', 'QUEUED', 'RUNNING'].includes(row.status)).length, failed: rows.filter((row) => row.status === 'FAILED').length }), [rows])

  return (
    <div className="mx-auto w-full max-w-[1600px] px-density-xl py-density-xl">
      <div className="flex flex-col gap-density-lg">
        <div className="mb-density-xl flex flex-col gap-density-sm">
          <div className="flex flex-wrap items-start justify-between gap-density-md">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Archive &amp; Retrieval</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">2020–2026 cold storage. Search by country, league, season, dataset, or provider. No direct delete — repair and validation are governed workflows.</p>
            </div>
            <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>
          </div>
        </div>

        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}

        <div className="grid grid-cols-2 gap-density-sm sm:grid-cols-4 lg:grid-cols-7">
          {seasons.map((season) => (
            <button key={season.season} type="button" onClick={() => { setSelectedSeason(season.season); setSeasonFilter(String(season.season)); setPage(1) }} className={`flex flex-col gap-1.5 rounded-md border p-density-sm text-left transition-colors ${selectedSeason === season.season ? 'border-foreground bg-muted/40' : 'border-border hover:bg-muted/40'}`}>
              <span className="text-sm font-semibold text-foreground">{season.label}</span>
              <StatusBadge status={season.status} dense />
              <ProgressBar value={season.completeness} size="sm" />
              <span className="text-[11px] text-muted-foreground">{season.campaigns} manifests · {season.providerLeagues} provider leagues</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-density-md">
          <div className="flex flex-wrap items-center gap-density-sm">
            <div className="relative w-full max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search archive (country, league, dataset)…" className="pl-9" /></div>
            <Select value={seasonFilter} onValueChange={setSeasonFilter}><SelectTrigger className="w-40"><SelectValue placeholder="All seasons" /></SelectTrigger><SelectContent><SelectItem value={ALL}>All seasons</SelectItem>{seasons.map((season) => <SelectItem key={season.season} value={String(season.season)}>{season.label}</SelectItem>)}</SelectContent></Select>
            <div className="ml-auto flex items-center gap-density-sm">
              <Button variant="outline" title="Column selection is reserved for the final table-column contract"><Columns3 className="h-4 w-4" /> Columns</Button>
              <Button variant="outline" onClick={() => exportCsv(filteredRows)}><Download className="h-4 w-4" /> Export</Button>
              {(query || seasonFilter !== ALL) && <Button variant="ghost" onClick={() => { setQuery(''); setSeasonFilter(ALL); setSelectedSeason(null) }}><X className="h-4 w-4" /> Clear</Button>}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card shadow-retool-sm"><div className="relative w-full overflow-auto"><table className="w-full caption-bottom text-sm"><thead className="sticky top-0 z-10 bg-card [&_tr]:border-b"><tr className="border-b transition-colors hover:bg-muted/50">{['Season', 'Country', 'League', 'Dataset', 'Rows', 'Completeness', 'Status', 'Created'].map((heading) => <th key={heading} scope="col" className="h-12 px-density-lg text-left align-middle font-medium text-muted-foreground">{heading}</th>)}</tr></thead><tbody>
            {pagedRows.map((row) => <tr key={row.campaign_id} onClick={() => setSelected(row)} className="cursor-pointer border-b transition-colors hover:bg-muted/50"><td className="p-density-lg align-middle">{row.season_label}</td><td className="p-density-lg align-middle">{row.country_name}</td><td className="p-density-lg align-middle">{row.league_name}</td><td className="p-density-lg align-middle">{row.dataset_type}</td><td className="p-density-lg align-middle">{Number(row.row_count ?? 0).toLocaleString()}</td><td className="p-density-lg align-middle min-w-[160px]"><ProgressBar value={Number(row.completeness_score ?? 0) * 100} size="sm" /></td><td className="p-density-lg align-middle"><StatusBadge status={row.status} /></td><td className="p-density-lg align-middle">{formatDate(row.created_at)}</td></tr>)}
            {!pagedRows.length && <tr><td colSpan={8} className="p-density-xl text-center text-sm text-muted-foreground">No live archive records match the current filters.</td></tr>}
          </tbody></table></div></div>

          <div className="flex flex-wrap items-center justify-between text-sm text-muted-foreground"><span>{filteredRows.length} records · Page {page} of {pageCount}</span><div className="flex items-center gap-density-sm"><Button variant="outline" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}><ChevronLeft className="h-4 w-4" /> Previous</Button><Button variant="outline" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>Next <ChevronRight className="h-4 w-4" /></Button></div><span>{summary.succeeded} complete · {summary.active} active · {summary.failed} failed</span></div>
        </div>
      </div>

      <DetailDrawer open={!!selected} onOpenChange={(open) => !open && setSelected(null)} title={selected ? `${selected.season_label} · ${selected.league_name}` : ''} description={selected?.campaign_id}>{selected && <div className="flex flex-col gap-density-md text-sm"><Row label="Season" value={selected.season_label} /><Row label="Country" value={selected.country_name} /><Row label="League" value={selected.league_name} /><Row label="Dataset" value={selected.dataset_type} /><Row label="Provider" value={selected.provider} /><Row label="Campaign status" value={<StatusBadge status={selected.status} />} /><Row label="Worker status" value={<StatusBadge status={String(selected.worker_status ?? '—')} dense />} /><Row label="Scope" value={selected.scope_state} /><Row label="Completeness" value={`${(Number(selected.completeness_score ?? 0) * 100).toFixed(2)}%`} /><Row label="Rows" value={Number(selected.row_count ?? 0).toLocaleString()} /><Row label="Attempts" value={String(selected.attempts)} /><Row label="Started" value={formatDate(selected.started_at)} /><Row label="Finished" value={formatDate(selected.finished_at)} /><Row label="Worker job" value={selected.worker_job_id ?? '—'} /><Row label="Queue" value={selected.queue_name ?? '—'} /><Row label="Manifest" value={<span className="font-mono text-xs break-all">{selected.manifest_id ?? '—'}</span>} /><Row label="Checksum" value={<span className="font-mono text-xs break-all">{selected.checksum ?? '—'}</span>} /><Row label="Object URI" value={<span className="font-mono text-xs break-all">{selected.object_uri ?? '—'}</span>} /><Row label="Created" value={formatDate(selected.created_at)} /><Row label="Updated" value={formatDate(selected.updated_at)} /></div>}</DetailDrawer>

      {selectedSeason != null && <DetailDrawer open onOpenChange={(open) => !open && setSelectedSeason(null)} title={`Season ${seasonLabel(selectedSeason)} · live scope`} description="Registered provider capabilities, backfill and archive state for this season"><div className="flex flex-col gap-density-lg text-sm"><section className="rounded-md border border-border p-density-md"><h3 className="mb-density-sm font-semibold">Season summary</h3><div className="grid grid-cols-2 gap-density-sm"><Fact label="Provider leagues" value={String(seasons.find((item) => item.season === selectedSeason)?.providerLeagues ?? 0)} /><Fact label="Archive records" value={String(selectedSeasonRows.length)} /><Fact label="Registered capabilities" value={String(registeredForSeason.length)} /><Fact label="Completeness" value={`${(seasons.find((item) => item.season === selectedSeason)?.completeness ?? 0).toFixed(1)}%`} /></div></section><section className="rounded-md border border-border p-density-md"><h3 className="mb-density-sm font-semibold">Provider capabilities</h3>{registeredForSeason.length ? registeredForSeason.map((item) => <div key={`${item.provider}-${item.competition_id}-${item.endpoint}-${item.market ?? ''}`} className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0"><span>{item.provider} · {item.endpoint}{item.market ? ` · ${item.market}` : ''}</span><StatusBadge status={item.status} dense /></div>) : <span className="text-muted-foreground">No provider capability records for this season.</span>}</section><section className="rounded-md border border-border p-density-md"><h3 className="mb-density-sm font-semibold">Archive records</h3>{selectedSeasonRows.length ? selectedSeasonRows.map((row) => <button key={row.campaign_id} type="button" onClick={() => setSelected(row)} className="block w-full border-b border-border/60 py-2 text-left last:border-0 hover:bg-muted/40"><div className="font-medium">{row.league_name} · {row.dataset_type}</div><div className="text-xs text-muted-foreground">{row.country_name} · {row.provider} · {(Number(row.completeness_score ?? 0) * 100).toFixed(1)}% · {row.status}</div></button>) : <span className="text-muted-foreground">No archive artifact has been created for this season yet.</span>}</section></div></DetailDrawer>}
    </div>
  )
}

function seasonLabel(season: number) { return `${season}/${String((season + 1) % 100).padStart(2, '0')}` }
function seasonStatus(season: number, completeness: number, succeeded: number, campaigns: number, blockedText: string) { if (blockedText.includes(String(season))) return 'BLOCKED'; if (campaigns > 0 && succeeded === campaigns && completeness >= 99) return 'COMPLETE'; if (campaigns > 0 && completeness > 0) return 'PARTIAL'; return 'PENDING' }
function formatDate(value: string | null | undefined) { return value ? new Date(value).toLocaleDateString() : '—' }
function exportCsv(rows: ArchiveRow[]) { const header = ['Season', 'Country', 'League', 'Dataset', 'Provider', 'Rows', 'Completeness', 'Status', 'Object URI', 'Checksum']; const body = rows.map((row) => [row.season_label, row.country_name, row.league_name, row.dataset_type, row.provider, row.row_count ?? 0, `${(Number(row.completeness_score ?? 0) * 100).toFixed(2)}%`, row.status, row.object_uri ?? '', row.checksum ?? '']); const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`; const csv = [header, ...body].map((line) => line.map(escape).join(',')).join('\n'); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'zahrly-archive.csv'; anchor.click(); URL.revokeObjectURL(url) }
function Fact({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-border bg-card p-density-md"><div className="text-xs uppercase text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div> }
function Row({ label, value }: { label: string; value: ReactNode }) { return <div className="flex flex-col gap-1 border-b border-border/60 pb-density-sm"><span className="text-xs uppercase text-muted-foreground">{label}</span><span>{value}</span></div> }
