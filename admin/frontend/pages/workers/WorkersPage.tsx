import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { HealthIndicator } from '../../components/status/HealthIndicator'
import { ProgressBar } from '../../components/status/ProgressBar'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { WORKERS } from '../../mock/data/workers'
import type { Worker } from '../../types/domain'
import { Cpu, Activity, AlertTriangle } from 'lucide-react'

export default function WorkersPage() {
  const [selected, setSelected] = useState<Worker | null>(null)
  const healthy = WORKERS.filter((w) => w.status === 'HEALTHY').length
  const unhealthy = WORKERS.filter((w) => w.status === 'UNHEALTHY' || w.status === 'OFFLINE').length

  const columns = useMemo<ColumnDef<Worker, any>[]>(() => [
    { accessorKey: 'id', header: 'Worker ID' },
    { accessorKey: 'class', header: 'Class' },
    { accessorKey: 'queue', header: 'Queue' },
    { accessorKey: 'host', header: 'Host' },
    { accessorKey: 'version', header: 'Version' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'cpuPct', header: 'CPU', cell: ({ getValue }) => `${getValue<number>()}%` },
    { accessorKey: 'ramPct', header: 'RAM', cell: ({ getValue }) => `${getValue<number>()}%` },
    { accessorKey: 'successRatePct', header: 'Success rate', cell: ({ getValue }) => `${getValue<number>()}%` },
    { accessorKey: 'lastHeartbeat', header: 'Last heartbeat', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleTimeString() },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader title="Workers" description="Worker fleet health across all queue classes — heartbeat, throughput, and success/error rate." />

      <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
        <MetricCard label="Total workers" value={WORKERS.length} icon={Cpu} />
        <MetricCard label="Healthy" value={healthy} icon={Activity} tone="success" />
        <MetricCard label="Unhealthy / offline" value={unhealthy} icon={AlertTriangle} tone={unhealthy > 0 ? 'critical' : 'success'} />
        <MetricCard label="Avg success rate" value={`${Math.round(WORKERS.reduce((s, w) => s + w.successRatePct, 0) / WORKERS.length)}%`} tone="info" />
      </div>

      <DataTable columns={columns} data={WORKERS} searchPlaceholder="Search workers…" onRowClick={setSelected} pageSize={14} />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected?.id}
        description={selected ? `${selected.class} · ${selected.host} · ${selected.version}` : ''}
      >
        {selected && (
          <div className="flex flex-col gap-density-lg text-sm">
            <div className="flex items-center gap-density-sm">
              <HealthIndicator status={selected.status} label={selected.status} pulse />
            </div>
            <div className="grid grid-cols-2 gap-density-md">
              <Fact label="Queue" value={selected.queue} />
              <Fact label="Current job" value={selected.currentJob ?? 'Idle'} />
              <Fact label="Jobs processed" value={selected.jobsProcessed.toLocaleString()} />
              <Fact label="Throughput" value={`${selected.throughputPerMin}/min`} />
              <Fact label="Error rate" value={`${selected.errorRatePct}%`} />
              <Fact label="p95 runtime" value={`${selected.p95RuntimeMs} ms`} />
              <Fact label="Last heartbeat" value={new Date(selected.lastHeartbeat).toLocaleString()} />
            </div>
            <div>
              <div className="mb-1 text-xs uppercase text-muted-foreground">CPU / RAM</div>
              <ProgressBar label="CPU" value={selected.cpuPct} size="sm" tone={selected.cpuPct > 85 ? 'warning' : 'default'} />
              <ProgressBar label="RAM" value={selected.ramPct} size="sm" tone={selected.ramPct > 85 ? 'warning' : 'default'} className="mt-2" />
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium text-foreground">{value}</div>
    </div>
  )
}
