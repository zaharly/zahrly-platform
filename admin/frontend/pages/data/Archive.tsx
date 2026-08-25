import { useMemo, useState, type ReactNode } from 'react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { ARCHIVE_RECORDS, ARCHIVE_SEASON_SUMMARY } from '../../mock/data/archive'
import type { ArchiveSeasonRecord } from '../../types/domain'
import { VERIFIED_ARCHIVE_CAMPAIGN } from '../../integrations/archiveVerified'
import { CheckCircle2, Database, ExternalLink } from 'lucide-react'

const ALL = '__all__'

export default function ArchivePage() {
  const [seasonFilter, setSeasonFilter] = useState(ALL)
  const [selected, setSelected] = useState<ArchiveSeasonRecord | null>(null)

  const filtered = useMemo(
    () => ARCHIVE_RECORDS.filter((r) => seasonFilter === ALL || r.season === seasonFilter),
    [seasonFilter]
  )

  const verification = VERIFIED_ARCHIVE_CAMPAIGN

  const columns = useMemo(() => [
    { accessorKey: 'season', header: 'Season' },
    { accessorKey: 'country', header: 'Country' },
    { accessorKey: 'league', header: 'League' },
    { accessorKey: 'dataset', header: 'Dataset' },
    { accessorKey: 'rowCount', header: 'Rows', cell: ({ getValue }: any) => getValue<number>().toLocaleString() },
    { accessorKey: 'completenessPct', header: 'Completeness', cell: ({ getValue }: any) => <ProgressBar value={getValue<number>()} size="sm" /> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }: any) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'createdAt', header: 'Created', cell: ({ getValue }: any) => new Date(getValue<string>()).toLocaleDateString() },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Archive & Retrieval"
        description="Historical archive control and verification. The controls below reflect the archive worker contract; no UI action creates an unsupported job."
      />

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="mb-density-md flex flex-wrap items-start justify-between gap-density-md">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">Verified backend archive</h2>
              <StatusBadge status="SUCCEEDED" dense />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Last verified run of the real archive worker and S3 object.</p>
          </div>
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Verified {new Date(verification.verifiedAt).toLocaleString()}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
          <Fact label="Campaign" value={verification.campaignId} mono />
          <Fact label="Season" value={String(verification.season)} />
          <Fact label="Dataset" value={verification.datasetType} />
          <Fact label="Worker job" value={verification.workerJobId} mono />
          <Fact label="Manifest" value={verification.manifestId} mono />
          <Fact label="Rows" value={verification.rowCount.toLocaleString()} />
          <Fact label="Completeness" value={`${(verification.completenessScore * 100).toFixed(0)}%`} />
          <Fact label="Attempts" value={String(verification.attempts)} />
        </div>

        <div className="mt-density-md grid gap-density-md md:grid-cols-2">
          <div className="rounded-md border border-border p-density-md">
            <div className="mb-1 text-xs uppercase text-muted-foreground">S3 object</div>
            <div className="break-all font-mono text-xs text-foreground">{verification.objectUri}</div>
          </div>
          <div className="rounded-md border border-border p-density-md">
            <div className="mb-1 text-xs uppercase text-muted-foreground">SHA-256 checksum</div>
            <div className="break-all font-mono text-xs text-foreground">{verification.checksum}</div>
          </div>
        </div>

        <div className="mt-density-md flex flex-wrap items-center gap-density-sm">
          <a
            href={verification.objectUri}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Object URI
          </a>
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5" /> Queue: {verification.queueName} · Worker: {verification.workerStatus}
          </span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-density-sm sm:grid-cols-4 lg:grid-cols-7">
        {ARCHIVE_SEASON_SUMMARY.map((s) => (
          <button
            key={s.season}
            onClick={() => setSeasonFilter(s.season === seasonFilter ? ALL : s.season)}
            className={`flex flex-col gap-1.5 rounded-md border p-density-sm text-left transition-colors ${seasonFilter === s.season ? 'border-foreground/40 bg-muted' : 'border-border hover:bg-muted/40'}`}
          >
            <span className="text-sm font-semibold text-foreground">{s.season}</span>
            <StatusBadge status={s.status} dense />
            <ProgressBar value={s.completenessPct} size="sm" showValue={false} />
            <span className="text-[11px] text-muted-foreground">{s.recordCount} manifests</span>
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="Search archive (country, league, dataset)…"
        onRowClick={setSelected}
        pageSize={10}
        toolbarExtra={
          <Select value={seasonFilter} onValueChange={setSeasonFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Season" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All seasons</SelectItem>
              {ARCHIVE_SEASON_SUMMARY.map((s) => <SelectItem key={s.season} value={s.season}>{s.season}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected ? `${selected.league} — ${selected.season}` : ''}
        description={selected?.dataset}
      >
        {selected && (
          <div className="flex flex-col gap-density-md text-sm">
            <Row label="Manifest ID" value={selected.manifestId} />
            <Row label="Checksum" value={<span className="font-mono text-xs">{selected.checksum}</span>} />
            <Row label="Row count" value={selected.rowCount.toLocaleString()} />
            <Row label="Object URI" value={<span className="break-all font-mono text-xs">{selected.objectUri}</span>} />
            <Row label="Completeness" value={<ProgressBar value={selected.completenessPct} size="sm" />} />
            <Row label="Status" value={<StatusBadge status={selected.status} />} />
            <Row label="Created" value={new Date(selected.createdAt).toLocaleString()} />
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-sm text-foreground ${mono ? 'break-all font-mono text-xs' : 'font-medium'}`}>{value}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/60 pb-density-sm">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}
