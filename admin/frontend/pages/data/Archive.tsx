import { useMemo, useState, type ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { Button } from '../../lib/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { toast } from '../../lib/shadcn/sonner'
import { ARCHIVE_RECORDS, ARCHIVE_SEASON_SUMMARY } from '../../mock/data/archive'
import type { ArchiveSeasonRecord } from '../../types/domain'
import { ShieldCheck, Wrench, Database } from 'lucide-react'

const ALL = '__all__'

export default function ArchivePage() {
  const [seasonFilter, setSeasonFilter] = useState(ALL)
  const [selected, setSelected] = useState<ArchiveSeasonRecord | null>(null)
  const [repairOpen, setRepairOpen] = useState(false)

  const filtered = useMemo(
    () => ARCHIVE_RECORDS.filter((r) => seasonFilter === ALL || r.season === seasonFilter),
    [seasonFilter]
  )

  const columns = useMemo<ColumnDef<ArchiveSeasonRecord, any>[]>(() => [
    { accessorKey: 'season', header: 'Season' },
    { accessorKey: 'country', header: 'Country' },
    { accessorKey: 'league', header: 'League' },
    { accessorKey: 'dataset', header: 'Dataset' },
    { accessorKey: 'rowCount', header: 'Rows', cell: ({ getValue }) => getValue<number>().toLocaleString() },
    { accessorKey: 'completenessPct', header: 'Completeness', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" /> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'createdAt', header: 'Created', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleDateString() },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Archive & Retrieval"
        description="2020–2026 cold storage. Search by country, league, season, dataset, or provider. No direct delete — repair and validation are governed workflows."
      />

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
        footer={
          selected && (
            <div className="flex flex-wrap justify-end gap-density-sm">
              <Button variant="outline" onClick={() => toast.success('Integrity validation started', { description: 'This is a UI-only preview action.' })}>
                <ShieldCheck className="h-4 w-4" /> Validate
              </Button>
              <Button variant="outline" onClick={() => setRepairOpen(true)}>
                <Wrench className="h-4 w-4" /> Repair
              </Button>
              <Button onClick={() => toast.success('Training dataset build queued', { description: 'This is a UI-only preview action — no evaluation job was actually created.' })}>
                <Database className="h-4 w-4" /> Prepare training dataset
              </Button>
            </div>
          )
        }
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

      <ConfirmDialog
        open={repairOpen}
        onOpenChange={setRepairOpen}
        title="Repair archive manifest"
        actionSummary="Queues a repair job to re-validate and, if needed, re-acquire the affected manifest data."
        scope={selected ? `${selected.league} — ${selected.season} (${selected.dataset})` : ''}
        consequences={['Creates a new manifest lineage rather than mutating the existing one.', 'Original manifest remains available until the repair is verified.', 'Downstream training/evaluation datasets built from this manifest may need to be rebuilt.']}
        confirmLabel="Queue repair"
        onConfirm={() => toast.success('Repair job queued', { description: 'This is a UI-only preview action — no job was actually created.' })}
      />
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
