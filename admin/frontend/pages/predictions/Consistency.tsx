import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { DataTable } from '../../components/tables/DataTable'
import { CONSISTENCY_CHECKS } from '../../mock/data/consistency'
import type { ConsistencyCheck } from '../../types/domain'
import { CheckSquare, AlertTriangle, XCircle } from 'lucide-react'

export default function Consistency() {
  const passing = CONSISTENCY_CHECKS.filter((c) => c.state === 'PASS').length
  const warnings = CONSISTENCY_CHECKS.filter((c) => c.state === 'WARNING').length
  const failed = CONSISTENCY_CHECKS.filter((c) => c.state === 'FAILED').length

  const columns = useMemo<ColumnDef<ConsistencyCheck, any>[]>(() => [
    { accessorKey: 'category', header: 'Category' },
    { accessorKey: 'rule', header: 'Rule' },
    { accessorKey: 'market', header: 'Market' },
    { accessorKey: 'fixtureLabel', header: 'Fixture' },
    { accessorKey: 'observed', header: 'Observed' },
    { accessorKey: 'expected', header: 'Expected' },
    { accessorKey: 'state', header: 'Result', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    {
      accessorKey: 'incidentId', header: 'Incident',
      cell: ({ getValue }) => {
        const id = getValue<string | null>()
        return id ? <Link to="/incidents" className="text-sm font-medium text-foreground hover:underline">{id}</Link> : <span className="text-sm text-muted-foreground">—</span>
      },
    },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Consistency Center"
        description="Mathematical consistency checks across partitions, complements, monotonic totals, Fréchet bounds, and joint simulation results. Failures are never force-passed — they route to an incident and repair job."
      />

      <div className="grid grid-cols-3 gap-density-md">
        <MetricCard label="Passing" value={passing} icon={CheckSquare} tone="success" />
        <MetricCard label="Warnings" value={warnings} icon={AlertTriangle} tone="warning" />
        <MetricCard label="Failed" value={failed} icon={XCircle} tone="critical" />
      </div>

      <DataTable columns={columns} data={CONSISTENCY_CHECKS} searchPlaceholder="Search consistency checks…" pageSize={12} />
    </div>
  )
}
