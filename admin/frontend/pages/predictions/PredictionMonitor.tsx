import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { DataTable } from '../../components/tables/DataTable'
import { Button } from '../../lib/shadcn/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../lib/shadcn/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { toast } from '../../lib/shadcn/sonner'
import { usePredictions, useStoreActions } from '../../state/StoreContext'
import { getPredictionCoverage } from '../../utils/metrics'
import type { PredictionRecord } from '../../types/domain'
import { Activity, CheckCircle2, XCircle, Ban, Clock, MoreHorizontal, PlusCircle, ShieldAlert, Wrench, AlertTriangle } from 'lucide-react'

const ALL = '__all__'

export default function PredictionMonitor() {
  const navigate = useNavigate()
  const predictions = usePredictions()
  const actions = useStoreActions()
  const [marketFilter, setMarketFilter] = useState(ALL)
  const coverage = getPredictionCoverage()

  const stats = useMemo(() => ({
    total: predictions.length,
    pending: predictions.filter((p) => p.predictionState === 'PENDING').length,
    processing: predictions.filter((p) => p.predictionState === 'PROCESSING').length,
    completed: predictions.filter((p) => p.predictionState === 'COMPLETED').length,
    failed: predictions.filter((p) => p.predictionState === 'FAILED').length,
    abstained: predictions.filter((p) => p.predictionState === 'ABSTAINED').length,
  }), [predictions])

  const filtered = useMemo(
    () => predictions.filter((p) => marketFilter === ALL || p.marketState === marketFilter),
    [predictions, marketFilter]
  )

  const columns = useMemo<ColumnDef<PredictionRecord, any>[]>(() => [
    { accessorKey: 'fixtureLabel', header: 'Fixture' },
    { accessorKey: 'leagueName', header: 'League' },
    { accessorKey: 'episodeId', header: 'Episode' },
    {
      id: 'baseline', header: 'Baseline pick / prob.',
      accessorFn: (p) => p.baselineProbability,
      cell: ({ row }) => <span>{row.original.baselinePick} · {row.original.baselineProbability}%</span>,
    },
    {
      id: 'current', header: 'Current prob.',
      accessorFn: (p) => p.currentProbability,
      cell: ({ row }) => (
        <span className={row.original.change > 0 ? 'text-success' : row.original.change < 0 ? 'text-destructive' : ''}>
          {row.original.currentProbability}% ({row.original.change >= 0 ? '+' : ''}{row.original.change})
        </span>
      ),
    },
    { accessorKey: 'modelVersion', header: 'Model' },
    { accessorKey: 'evidenceCount', header: 'Evidence' },
    { accessorKey: 'dataQuality', header: 'Data quality', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'marketState', header: 'Market status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'consistency', header: 'Consistency', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'recommendationState', header: 'Recommendation', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    {
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => {
        const p = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Prediction actions" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>{p.fixtureLabel}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate(`/predictions/${p.id}?action=evidence`)}>
                <PlusCircle className="h-4 w-4" /> Add evidence
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { actions.revalidatePrediction(p.fixtureId); toast.info('Revalidation queued', { description: p.fixtureLabel }) }}>
                <ShieldAlert className="h-4 w-4" /> Revalidate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(`/predictions/${p.id}?action=repair`)}>
                <Wrench className="h-4 w-4" /> Repair prediction
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(`/predictions/${p.id}?action=incident`)}>
                <AlertTriangle className="h-4 w-4" /> Open data incident
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [actions, navigate])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Prediction Monitor"
        description="Baseline is the first immutable pick + probability. Current is the latest evidence-adjusted probability. Admins can never edit a prediction directly — only append evidence or trigger controlled replay."
      />

      <div className="grid grid-cols-2 gap-density-md md:grid-cols-4 xl:grid-cols-7">
        <MetricCard label="Total processed" value={stats.total} icon={Activity} />
        <MetricCard label="Pending" value={stats.pending} icon={Clock} tone="warning" />
        <MetricCard label="Processing" value={stats.processing} icon={Activity} tone="info" />
        <MetricCard label="Completed" value={stats.completed} icon={CheckCircle2} tone="success" />
        <MetricCard label="Failed" value={stats.failed} icon={XCircle} tone="critical" />
        <MetricCard label="Abstained" value={stats.abstained} icon={Ban} tone="critical" />
        <MetricCard label="Baseline coverage" value={`${coverage.pct}%`} tone={coverage.pct >= 95 ? 'success' : 'warning'} />
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="Search predictions…"
        onRowClick={(p) => navigate(`/predictions/${p.id}`)}
        pageSize={14}
        toolbarExtra={
          <Select value={marketFilter} onValueChange={setMarketFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Market status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All market statuses</SelectItem>
              {['PRODUCTION_ENABLED', 'EXPERIMENTAL', 'ABSTAIN', 'PREDICTED_ONLY', 'RECOMMENDABLE'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />
    </div>
  )
}
