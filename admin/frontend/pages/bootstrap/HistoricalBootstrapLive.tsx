import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
import type { ColumnDef } from '@tanstack/react-table'
import { RefreshCw, ExternalLink, Database } from 'lucide-react'
import { fetchArchiveLive, type ArchiveCampaignLive, type ArchiveSeasonLive } from '../../integrations/archiveLive'

const seasonColumns: ColumnDef<ArchiveSeasonLive, any>[] = [
  { accessorKey: 'season', header: 'Season' },
  { accessorKey: 'campaigns', header: 'Campaigns' },
  { accessorKey: 'succeeded', header: 'Succeeded' },
  { accessorKey: 'active', header: 'Active' },
  { accessorKey: 'failed', header: 'Failed' },
  { accessorKey: 'avg_completeness', header: 'Avg completeness', cell: ({ getValue }) => <ProgressBar value={Number(getValue())} size="sm" /> },
]

const campaignColumns: ColumnDef<ArchiveCampaignLive, any>[] = [
  { accessorKey: 'season', header: 'Season' },
  { accessorKey: 'dataset_type', header: 'Dataset' },
  { accessorKey: 'provider', header: 'Provider' },
  { accessorKey: 'scope_state', header: 'Scope' },
  { accessorKey: 'status', header: 'Campaign', cell: ({ getValue }) => <StatusBadge status={String(getValue())} /> },
  { accessorKey: 'worker_status', header: 'Worker', cell: ({ getValue }) => <StatusBadge status={String(getValue() ?? '—')} dense /> },
  { accessorKey: 'completeness_score', header: 'Completeness', cell: ({ getValue }) => <ProgressBar value={Number(getValue() ?? 0) * 100} size="sm" /> },
  { accessorKey: 'row_count', header: 'Rows', cell: ({ getValue }) => Number(getValue() ?? 0).toLocaleString() },
  { accessorKey: 'manifest_id', header: 'Manifest' },
]

export default function HistoricalBootstrapLive() {
  const [data, setData] = useState<{ campaigns: ArchiveCampaignLive[]; seasons: ArchiveSeasonLive[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ArchiveCampaignLive | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchArchiveLive())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load live archive data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const stats = useMemo(() => {
    const campaigns = data?.campaigns ?? []
    const total = campaigns.length
    const succeeded = campaigns.filter((c) => c.status === 'SUCCEEDED').length
    const active = campaigns.filter((c) => ['READY', 'QUEUED', 'RUNNING'].includes(c.status)).length
    const avg = campaigns.length ? campaigns.reduce((sum, c) => sum + Number(c.completeness_score ?? 0), 0) / campaigns.length : 0
    return { total, succeeded, active, avg }
  }, [data])

  return (
    <div className="flex flex-col gap-density-xl">
      <PageHeader
        title="Historical Bootstrap"
        description="Live archive operating path backed by internal.archive_campaigns, internal.worker_jobs, and internal.archive_catalog. Historical data is displayed from Supabase, not mock fixtures."
        tag={<StatusBadge status={loading ? 'LOADING' : error ? 'DEGRADED' : 'ACTIVE'} />}
        actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}

      <div className="grid grid-cols-2 gap-density-md lg:grid-cols-4">
        <Stat label="Archive campaigns" value={stats.total.toLocaleString()} />
        <Stat label="Succeeded" value={stats.succeeded.toLocaleString()} />
        <Stat label="Active" value={stats.active.toLocaleString()} />
        <Stat label="Avg completeness" value={`${(stats.avg * 100).toFixed(1)}%`} />
      </div>

      <section>
        <div className="mb-density-md flex items-center gap-density-sm"><Database className="h-4 w-4" /><h2 className="text-base font-semibold">Real season state</h2></div>
        <DataTable columns={seasonColumns} data={data?.seasons ?? []} searchPlaceholder="Search seasons…" pageSize={12} />
      </section>

      <section>
        <h2 className="mb-density-md text-base font-semibold">Real archive campaigns</h2>
        <DataTable columns={campaignColumns} data={data?.campaigns ?? []} searchPlaceholder="Search campaigns…" pageSize={12} onRowClick={setSelected} />
      </section>

      <DetailDrawer
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected ? `Season ${selected.season} · ${selected.dataset_type}` : ''}
        description={selected?.campaign_id}
      >
        {selected && (
          <div className="flex flex-col gap-density-md text-sm">
            <Row label="Campaign status" value={<StatusBadge status={selected.status} />} />
            <Row label="Worker status" value={<StatusBadge status={String(selected.worker_status ?? '—')} />} />
            <Row label="Scope" value={selected.scope_state} />
            <Row label="Provider" value={selected.provider} />
            <Row label="Completeness" value={`${(Number(selected.completeness_score ?? 0) * 100).toFixed(2)}%`} />
            <Row label="Rows" value={Number(selected.row_count ?? 0).toLocaleString()} />
            <Row label="Manifest" value={<span className="font-mono text-xs break-all">{selected.manifest_id ?? '—'}</span>} />
            <Row label="Object URI" value={<span className="font-mono text-xs break-all">{selected.object_uri ?? '—'}</span>} />
            <Row label="Checksum" value={<span className="font-mono text-xs break-all">{selected.checksum ?? '—'}</span>} />
            <Row label="Queue" value={selected.queue_name ?? '—'} />
            <Row label="Attempts" value={String(selected.worker_attempts ?? selected.attempts ?? 0)} />
            <Row label="Created" value={new Date(selected.created_at).toLocaleString()} />
            {selected.object_uri && <a className="inline-flex items-center gap-1 text-sm font-medium hover:underline" href={selected.object_uri} target="_blank" rel="noreferrer">Open object <ExternalLink className="h-3.5 w-3.5" /></a>}
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm"><div className="text-xs font-medium uppercase text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex flex-col gap-1 border-b border-border/60 pb-density-sm"><span className="text-xs uppercase text-muted-foreground">{label}</span><span>{value}</span></div>
}
