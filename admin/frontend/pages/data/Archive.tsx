import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Columns3, Download, RefreshCw, Search, X } from 'lucide-react'
import { PageHeader } from '../../components/layout/PageHeader'
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

type ArchiveRow = ArchiveCampaignLive & {
  country_name: string
  league_name: string
  season_label: string
}

type SeasonCard = {
  season: number
  label: string
  campaigns: number
  succeeded: number
  active: number
  failed: number
  completeness: number
  status: string
  providerLeagues: number
}

export default function ArchivePage() {
  const [snapshot, setSnapshot] = useState<ArchiveLiveSnapshot | null>(null)
  const [historical, setHistorical] = useState<HistoricalBootstrapSnapshot | null>(null)
  const [options, setOptions] = useState<ArchiveCampaignOptions | null>(null)
  const [selected, setSelected] = useState<ArchiveRow | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [seasonFilter, setSeasonFilter] = useState(ALL)
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

  const countryById = useMemo(() => new Map((options?.countries ?? []).map((row: ArchiveCampaignCountryOption) => [row.id, row])), [options])
  const competitionById = useMemo(() => new Map((options?.competitions ?? []).map((row: ArchiveCampaignCompetitionOption) => [row.id, row])), [options])

  const rows = useMemo<ArchiveRow[]>(() => {
    const source = snapshot?.campaigns ?? []
    return source.map((campaign) => {
      const country = campaign.country_id ? countryById.get(campaign.country_id) : undefined
      const competition = campaign.competition_id ? competitionById.get(campaign.competition_id) : undefined
      return {
        ...campaign,
        country_name: country?.name ?? campaign.country_id ?? '—',
        league_name: competition?.name ?? campaign.competition_id ?? '—',
        season_label: `${campaign.season}/${String((campaign.season + 1) % 100).padStart(2, '0')}`,
      }
    })
  }, [snapshot, countryById, competitionById])

  const seasons = useMemo(() => {
    const fromHistorical = historical?.seasons ?? []
    const bySeason = new Map<number, SeasonCard>()

    fromHistorical.forEach((item: HistoricalSeasonProgress) => {
      const completeness = Number(item.archive_completeness ?? 0) * 100
      bySeason.set(item.season, {
        season: item.season,
        label: `${item.season}/${String((item.season + 1) % 100).padStart(2, '0')}`,
        campaigns: item.archive_campaigns,
        succeeded: item.archive_succeeded,
        active: Math.max(item.archive_campaigns - item.archive_succeeded, 0),
        failed: 0,
        completeness,
        status: seasonStatus(completeness, item.archive_succeeded, item.archive_campaigns),
        providerLeagues: item.provider_leagues,
      })
    })

    rows.forEach((row) => {
      const existing = bySeason.get(row.season)
      if (existing) return
      const sameSeason = rows.filter((candidate) => candidate.season === row.season)
      const succeeded = sameSeason.filter((candidate) => candidate.status === 'SUCCEEDED').length
      const active = sameSeason.filter((candidate) => ['READY', 'QUEUED', 'RUNNING'].includes(candidate.status)).length
      const failed = sameSeason.filter((candidate) => candidate.status === 'FAILED').length
      const completeness = sameSeason.length
        ? (sameSeason.reduce((sum, candidate) => sum + Number(candidate.completeness_score ?? 0), 0) / sameSeason.length) * 100
        : 0
      bySeason.set(row.season, {
        season: row.season,
        label: `${row.season}/${String((row.season + 1) % 100).padStart(2, '0')}`,
        campaigns: sameSeason.length,
        succeeded,
        active,
        failed,
        completeness,
        status: seasonStatus(completeness, succeeded, sameSeason.length),
        providerLeagues: 0,
      })
    })

    return Array.from(bySeason.values()).sort((a, b) => b.season - a.season)
  }, [historical, rows])

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (seasonFilter !== ALL && String(row.season) !== seasonFilter) return false
      if (!needle) return true
      return [
        row.season_label,
        row.country_name,
        row.league_name,
        row.dataset_type,
        row.provider,
        row.status,
        row.worker_status,
        row.manifest_id,
        row.object_uri,
        row.checksum,
      ].some((value) => String(value ?? '').toLowerCase().includes(needle))
    })
  }, [rows, query, seasonFilter])

  const detailRows = useMemo(() => {
    if (selectedSeason == null) return []
    return rows.filter((row) => row.season === selectedSeason)
  }, [rows, selectedSeason])

  const registeredForSeason = useMemo<ArchiveRegisteredSeasonOption[]>(() => {
    if (selectedSeason == null) return []
    return (options?.registered_seasons ?? []).filter((row) => row.season === selectedSeason)
  }, [options, selectedSeason])

  const archiveSummary = useMemo(() => ({
    total: rows.length,
    succeeded: rows.filter((row) => row.status === 'SUCCEEDED').length,
    active: rows.filter((row) => ['READY', 'QUEUED', 'RUNNING'].includes(row.status)).length,
    failed: rows.filter((row) => row.status === 'FAILED').length,
  }), [rows])

  return (
    <div className="mx-auto w-full max-w-[1600px] px-density-xl py-density-xl">
      <div className="flex flex-col gap-density-lg">
        <PageHeader
          title="Archive & Retrieval"
          description="Cold-storage archive state backed by Supabase. Search by country, league, season, dataset, or provider. No direct delete — repair and validation remain governed workflows."
          tag={<StatusBadge status={loading ? 'LOADING' : error ? 'DEGRADED' : 'ACTIVE'} />}
          actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
        />

        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}

        <div className="grid grid-cols-2 gap-density-sm sm:grid-cols-4 lg:grid-cols-7">
          {seasons.slice(0, 7).map((season) => (
            <button
              key={season.season}
              type="button"
              onClick={() => { setSelectedSeason(season.season); setSeasonFilter(String(season.season)) }}
              className={`flex flex-col gap-1.5 rounded-md border p-density-sm text-left transition-colors ${selectedSeason === season.season ? 'border-foreground bg-muted/40' : 'border-border hover:bg-muted/40'}`}
            >
              <span className="text-sm font-semibold text-foreground">{season.label}</span>
              <StatusBadge status={season.status} dense />
              <ProgressBar value={season.completeness} size="sm" />
              <span className="text-[11px] text-muted-foreground">{season.campaigns} archive records</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-density-md">
          <div className="flex flex-wrap items-center gap-density-sm">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search archive (country, league, dataset)…" className="pl-9" />
            </div>
            <Select value={seasonFilter} onValueChange={setSeasonFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All seasons" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All seasons</SelectItem>
                {seasons.map((season) => <SelectItem key={season.season} value={String(season.season)}>{season.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-density-sm">
              <Button variant="outline"><Columns3 className="h-4 w-4" /> Columns</Button>
              <Button variant="outline" onClick={() => exportCsv(filteredRows)}><Download className="h-4 w-4" /> Export</Button>
              {(query || seasonFilter !== ALL) && <Button variant="ghost" onClick={() => { setQuery(''); setSeasonFilter(ALL); setSelectedSeason(null) }}><X className="h-4 w-4" /> Clear</Button>}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card shadow-retool-sm">
            <div className="relative w-full overflow-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="sticky top-0 z-10 bg-card [&_tr]:border-b">
                  <tr className="border-b transition-colors hover:bg-muted/50">
                    {['Season', 'Country', 'League', 'Dataset', 'Rows', 'Completeness', 'Status', 'Created'].map((heading) => <th key={heading} scope="col" className="h-12 px-density-lg text-left align-middle font-medium text-muted-foreground">{heading}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.campaign_id} onClick={() => setSelected(row)} className="cursor-pointer border-b transition-colors hover:bg-muted/50">
                      <td className="p-density-lg align-middle">{row.season_label}</td>
                      <td className="p-density-lg align-middle">{row.country_name}</td>
                      <td className="p-density-lg align-middle">{row.league_name}</td>
                      <td className="p-density-lg align-middle">{row.dataset_type}</td>
                      <td className="p-density-lg align-middle">{Number(row.row_count ?? 0).toLocaleString()}</td>
                      <td className="p-density-lg align-middle min-w-[160px]"><ProgressBar value={Number(row.completeness_score ?? 0) * 100} size="sm" /></td>
                      <td className="p-density-lg align-middle"><StatusBadge status={row.status} /></td>
                      <td className="p-density-lg align-middle">{formatDate(row.created_at)}</td>
                    </tr>
                  ))}
                  {!filteredRows.length && <tr><td colSpan={8} className="p-density-xl text-center text-sm text-muted-foreground">No live archive records match the current filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between text-sm text-muted-foreground">
            <span>{filteredRows.length} records · {archiveSummary.total} total archive records</span>
            <span>{archiveSummary.succeeded} complete · {archiveSummary.active} active · {archiveSummary.failed} failed</span>
          </div>
        </div>
      </div>

      <DetailDrawer open={!!selected} onOpenChange={(open) => !open && setSelected(null)} title={selected ? `${selected.season_label} · ${selected.league_name}` : ''} description={selected?.campaign_id}>
        {selected && <div className="flex flex-col gap-density-md text-sm">
          <Row label="Season" value={selected.season_label} />
          <Row label="Country" value={selected.country_name} />
          <Row label="League" value={selected.league_name} />
          <Row label="Dataset" value={selected.dataset_type} />
          <Row label="Provider" value={selected.provider} />
          <Row label="Campaign status" value={<StatusBadge status={selected.status} />} />
          <Row label="Worker status" value={<StatusBadge status={String(selected.worker_status ?? '—')} dense />} />
          <Row label="Scope" value={selected.scope_state} />
          <Row label="Completeness" value={`${(Number(selected.completeness_score ?? 0) * 100).toFixed(2)}%`} />
          <Row label="Rows" value={Number(selected.row_count ?? 0).toLocaleString()} />
          <Row label="Attempts" value={String(selected.attempts)} />
          <Row label="Started" value={formatDate(selected.started_at)} />
          <Row label="Finished" value={formatDate(selected.finished_at)} />
          <Row label="Worker job" value={selected.worker_job_id ?? '—'} />
          <Row label="Queue" value={selected.queue_name ?? '—'} />
          <Row label="Manifest" value={<span className="font-mono text-xs break-all">{selected.manifest_id ?? '—'}</span>} />
          <Row label="Checksum" value={<span className="font-mono text-xs break-all">{selected.checksum ?? '—'}</span>} />
          <Row label="Object URI" value={<span className="font-mono text-xs break-all">{selected.object_uri ?? '—'}</span>} />
          <Row label="Created" value={formatDate(selected.created_at)} />
          <Row label="Updated" value={formatDate(selected.updated_at)} />
        </div>}
      </DetailDrawer>

      {selectedSeason != null && (
        <DetailDrawer open onOpenChange={(open) => !open && setSelectedSeason(null)} title={`Season ${seasonLabel(selectedSeason)} · live scope`} description="Registered provider capabilities, backfill, archive and raw retrieval scope for this season">
          <div className="flex flex-col gap-density-lg text-sm">
            <section className="rounded-md border border-border p-density-md">
              <h3 className="mb-density-sm font-semibold">Season summary</h3>
              <div className="grid grid-cols-2 gap-density-sm">
                <Fact label="Provider leagues" value={String(seasons.find((item) => item.season === selectedSeason)?.providerLeagues ?? 0)} />
                <Fact label="Archive records" value={String(detailRows.length)} />
                <Fact label="Registered capabilities" value={String(registeredForSeason.length)} />
                <Fact label="Completeness" value={`${(seasons.find((item) => item.season === selectedSeason)?.completeness ?? 0).toFixed(1)}%`} />
              </div>
            </section>
            <section className="rounded-md border border-border p-density-md">
              <h3 className="mb-density-sm font-semibold">Provider capabilities</h3>
              {registeredForSeason.length ? registeredForSeason.map((item) => (
                <div key={`${item.provider}-${item.competition_id}-${item.endpoint}`} className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0">
                  <span>{item.provider} · {item.endpoint}{item.market ? ` · ${item.market}` : ''}</span>
                  <StatusBadge status={item.status} dense />
                </div>
              )) : <span className="text-muted-foreground">No provider capability records for this season.</span>}
            </section>
          </div>
        </DetailDrawer>
      )}
    </div>
  )
}

function seasonStatus(completeness: number, succeeded: number, total: number) {
  if (total === 0 && completeness === 0) return 'PENDING'
  if (succeeded === 0 && completeness === 0) return 'BLOCKED'
  if (completeness >= 99) return 'COMPLETE'
  if (completeness >= 90) return 'PARTIAL'
  return 'REPAIR_REQUIRED'
}

function seasonLabel(season: number) {
  return `${season}/${String((season + 1) % 100).padStart(2, '0')}`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border p-density-sm"><div className="text-[11px] uppercase text-muted-foreground">{label}</div><div className="mt-1 font-semibold">{value}</div></div>
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex flex-col gap-1 border-b border-border/60 pb-density-sm"><span className="text-xs uppercase text-muted-foreground">{label}</span><span>{value}</span></div>
}

function exportCsv(rows: ArchiveRow[]) {
  const header = ['Season', 'Country', 'League', 'Dataset', 'Provider', 'Rows', 'Completeness', 'Status', 'Manifest', 'Object URI', 'Checksum']
  const body = rows.map((row) => [row.season_label, row.country_name, row.league_name, row.dataset_type, row.provider, String(row.row_count ?? 0), String(Number(row.completeness_score ?? 0) * 100), row.status, row.manifest_id ?? '', row.object_uri ?? '', row.checksum ?? ''])
  const csv = [header, ...body].map((line) => line.map(csvCell).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'zahrly-archive.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}
