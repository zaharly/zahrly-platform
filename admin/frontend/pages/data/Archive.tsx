import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { RefreshCw, Database, ExternalLink } from 'lucide-react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
import { fetchArchiveLive, type ArchiveCampaignLive } from '../../integrations/archiveLive'

// Live Supabase archive view; intentionally no static E2E archive fixture.
export default function ArchivePage() {
  const [campaigns, setCampaigns] = useState<ArchiveCampaignLive[]>([])
  const [selected, setSelected] = useState<ArchiveCampaignLive | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const snapshot = await fetchArchiveLive()
      setCampaigns(snapshot.campaigns)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load live archive data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const stats = useMemo(() => ({
    total: campaigns.length,
    succeeded: campaigns.filter((c) => c.status === 'SUCCEEDED').length,
    active: campaigns.filter((c) => ['READY', 'QUEUED', 'RUNNING'].includes(c.status)).length,
    failed: campaigns.filter((c) => c.status === 'FAILED').length,
  }), [campaigns])

  const columns = useMemo(() => [
    { accessorKey: 'season', header: 'Season' },
    { accessorKey: 'dataset_type', header: 'Dataset' },
    { accessorKey: 'provider', header: 'Provider' },
    { accessorKey: 'status', header: 'Campaign', cell: ({ getValue }: any) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'worker_status', header: 'Worker', cell: ({ getValue }: any) => <StatusBadge status={String(getValue<string>() ?? '—')} dense /> },
    { accessorKey: 'completeness_score', header: 'Completeness', cell: ({ getValue }: any) => <ProgressBar value={Number(getValue<number | null>() ?? 0) * 100} size="sm" /> },
    { accessorKey: 'row_count', header: 'Rows', cell: ({ getValue }: any) => Number(getValue<number | null>() ?? 0).toLocaleString() },
    { accessorKey: 'created_at', header: 'Created', cell: ({ getValue }: any) => new Date(getValue<string>()).toLocaleString() },
  ], [])

  return (
    <div className="flex flex-col gap-density-xl">
      <PageHeader
        title="Archive & Retrieval"
        description="Live archive state backed by Supabase. No mock archive fixtures are used on this page."
        tag={<StatusBadge status={loading ? 'LOADING' : error ? 'DEGRADED' : 'ACTIVE'} />}
        actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}

      <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
        <Fact label="Campaigns" value={stats.total.toLocaleString()} />
        <Fact label="Succeeded" value={stats.succeeded.toLocaleString()} />
        <Fact label="Active" value={stats.active.toLocaleString()} />
        <Fact label="Failed" value={stats.failed.toLocaleString()} />
      </div>

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="mb-density-md flex items-center gap-density-sm"><Database className="h-4 w-4" /><h2 className="text-base font-semibold">Real archive campaigns</h2></div>
        <DataTable columns={columns} data={campaigns} searchPlaceholder="Search campaigns…" onRowClick={setSelected} pageSize={12} />
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
            <Row label="Provider" value={selected.provider} />
            <Row label="Scope" value={selected.scope_state} />
            <Row label="Completeness" value={`${(Number(selected.completeness_score ?? 0) * 100).toFixed(2)}%`} />
            <Row label="Rows" value={Number(selected.row_count ?? 0).toLocaleString()} />
            <Row label="Manifest" value={<span className="font-mono text-xs break-all">{selected.manifest_id ?? '—'}</span>} />
            <Row label="Checksum" value={<span className="font-mono text-xs break-all">{selected.checksum ?? '—'}</span>} />
            <Row label="Object URI" value={<span className="font-mono text-xs break-all">{selected.object_uri ?? '—'}</span>} />
            <Row label="Queue" value={selected.queue_name ?? '—'} />
            {selected.object_uri && <a className="inline-flex items-center gap-1 text-sm font-medium hover:underline" href={selected.object_uri} target="_blank" rel="noreferrer">Open object <ExternalLink className="h-3.5 w-3.5" /></a>}
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-card p-density-md"><div className="text-xs uppercase text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex flex-col gap-1 border-b border-border/60 pb-density-sm"><span className="text-xs uppercase text-muted-foreground">{label}</span><span>{value}</span></div>
}
