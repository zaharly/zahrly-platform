import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { DATA_QUALITY_DOMAINS } from '../../mock/data/dataQuality'
import type { DataQualityDomain } from '../../types/domain'
import { Gauge, AlertTriangle } from 'lucide-react'

export default function DataQuality() {
  const belowThreshold = DATA_QUALITY_DOMAINS.filter((d) => d.coveragePct < d.threshold)
  const avgCoverage = DATA_QUALITY_DOMAINS.reduce((sum, d) => sum + d.coveragePct, 0) / DATA_QUALITY_DOMAINS.length

  const columns = useMemo<ColumnDef<DataQualityDomain, any>[]>(() => [
    { accessorKey: 'name', header: 'Dataset' },
    { accessorKey: 'league', header: 'League scope' },
    { accessorKey: 'season', header: 'Season' },
    { accessorKey: 'source', header: 'Source' },
    {
      accessorKey: 'coveragePct', header: 'Coverage vs threshold',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <ProgressBar value={row.original.coveragePct} size="sm" showValue={false} tone={row.original.coveragePct >= row.original.threshold ? 'success' : 'critical'} className="w-32" />
          <span className="text-xs text-muted-foreground">{row.original.coveragePct}% / {row.original.threshold}%</span>
        </div>
      ),
    },
    { accessorKey: 'freshnessMin', header: 'Freshness', cell: ({ getValue }) => `${getValue<number>()} min` },
    { accessorKey: 'missingnessPct', header: 'Missingness', cell: ({ getValue }) => `${getValue<number>()}%` },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Data Quality Center"
        description="Coverage, freshness, and missingness per dataset domain. Production gates require core ≥ 99%, mandatory enrichment ≥ 95%, specialized ≥ 95%."
      />

      <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
        <MetricCard label="Average coverage" value={`${avgCoverage.toFixed(1)}%`} icon={Gauge} tone={avgCoverage >= 90 ? 'success' : 'warning'} />
        <MetricCard label="Domains below threshold" value={belowThreshold.length} icon={AlertTriangle} tone={belowThreshold.length > 0 ? 'warning' : 'success'} />
        <MetricCard label="Domains tracked" value={DATA_QUALITY_DOMAINS.length} />
        <MetricCard label="Ready domains" value={DATA_QUALITY_DOMAINS.filter((d) => d.status === 'READY').length} tone="success" />
      </div>

      <DataTable columns={columns} data={DATA_QUALITY_DOMAINS} searchPlaceholder="Search datasets…" pageSize={12} />
    </div>
  )
}
