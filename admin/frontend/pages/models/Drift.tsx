import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import { useStoreActions } from '../../state/StoreContext'
import { DRIFT_METRICS } from '../../mock/data/driftMetrics'
import type { DriftMetric } from '../../types/domain'
import { TrendingUp, FlaskConical, Siren } from 'lucide-react'

export default function Drift() {
  const [selected, setSelected] = useState<DriftMetric | null>(null)
  const [trainingOpen, setTrainingOpen] = useState(false)
  const actions = useStoreActions()

  const warning = DRIFT_METRICS.filter((d) => d.severity === 'WARNING' || d.severity === 'CRITICAL').length

  const columns = useMemo<ColumnDef<DriftMetric, any>[]>(() => [
    { accessorKey: 'category', header: 'Category' },
    { accessorKey: 'metric', header: 'Metric' },
    { accessorKey: 'baseline', header: 'Baseline' },
    { accessorKey: 'current', header: 'Current' },
    { accessorKey: 'threshold', header: 'Threshold' },
    { accessorKey: 'durationHours', header: 'Duration', cell: ({ getValue }) => `${getValue<number>()}h` },
    { accessorKey: 'severity', header: 'Severity', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Drift Center"
        description="Model, data, feature, provider, calibration, and market drift — tracked against rolling baselines. Drift never triggers automatic production promotion."
      />

      <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
        <MetricCard label="Metrics tracked" value={DRIFT_METRICS.length} icon={TrendingUp} />
        <MetricCard label="Warning or critical" value={warning} icon={Siren} tone={warning > 0 ? 'warning' : 'success'} />
        <MetricCard label="Normal" value={DRIFT_METRICS.filter((d) => d.severity === 'NORMAL').length} tone="success" />
        <MetricCard label="Watch" value={DRIFT_METRICS.filter((d) => d.severity === 'WATCH').length} tone="warning" />
      </div>

      <DataTable columns={columns} data={DRIFT_METRICS} searchPlaceholder="Search drift metrics…" onRowClick={setSelected} pageSize={12} />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected?.metric}
        description={selected?.category}
        footer={
          selected && (selected.severity === 'WARNING' || selected.severity === 'CRITICAL') && (
            <div className="flex flex-wrap justify-end gap-density-sm">
              <Button variant="outline" onClick={() => {
                actions.createIncident({
                  type: 'Drift threshold breach', severity: selected.severity === 'CRITICAL' ? 'P1' : 'P2',
                  category: 'Model', scope: selected.metric, description: selected.trigger, materialToPrediction: true,
                  reason: `${selected.category} drift: ${selected.metric}`,
                })
                toast.info('Incident opened for this drift metric')
              }}>
                <Siren className="h-4 w-4" /> Open incident
              </Button>
              <Button onClick={() => setTrainingOpen(true)}>
                <FlaskConical className="h-4 w-4" /> Create retraining candidate
              </Button>
            </div>
          )
        }
      >
        {selected && (
          <div className="flex flex-col gap-density-md text-sm">
            <StatusBadge status={selected.severity} />
            <div className="grid grid-cols-2 gap-density-md">
              <Fact label="Baseline" value={selected.baseline} />
              <Fact label="Current" value={selected.current} />
              <Fact label="Threshold" value={selected.threshold} />
              <Fact label="Duration" value={`${selected.durationHours}h`} />
            </div>
            <div>
              <div className="mb-1 text-xs uppercase text-muted-foreground">Trigger</div>
              <p className="text-foreground">{selected.trigger}</p>
            </div>
          </div>
        )}
      </DetailDrawer>

      <ConfirmDialog
        open={trainingOpen}
        onOpenChange={setTrainingOpen}
        title="Create retraining candidate"
        actionSummary="Enqueues a MODEL_TRAINING_QUEUE job to produce a new candidate addressing this drift signal."
        scope={selected?.metric ?? ''}
        consequences={[
          'Does not affect the active production model.',
          'New candidate will be evaluated and shadow-tested before any promotion is considered.',
          'Consumes MODEL_TRAINING_QUEUE capacity — check current queue depth first.',
        ]}
        confirmLabel="Create candidate"
        destructive={false}
        onConfirm={(reason) => {
          if (selected) actions.createJob('MODEL_TRAINING_QUEUE', { priority: 'normal', payloadSummary: `Retraining candidate — addressing ${selected.metric}`, reason })
          toast.success('Retraining candidate job queued')
        }}
      />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium text-foreground">{value}</div>
    </div>
  )
}
