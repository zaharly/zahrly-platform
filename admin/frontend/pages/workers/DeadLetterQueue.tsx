import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { OpenIncidentDialog } from '../../components/dialogs/OpenIncidentDialog'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import { useDeadLetterJobs, useStoreActions } from '../../state/StoreContext'
import type { Job } from '../../types/domain'
import { Inbox, RotateCw, ShieldOff, AlertTriangle } from 'lucide-react'

export default function DeadLetterQueue() {
  const deadLetterJobs = useDeadLetterJobs()
  const actions = useStoreActions()
  const [selected, setSelected] = useState<Job | null>(null)
  const [replayTarget, setReplayTarget] = useState<Job | null>(null)
  const [incidentTarget, setIncidentTarget] = useState<Job | null>(null)

  const columns = useMemo<ColumnDef<Job, any>[]>(() => [
    { accessorKey: 'id', header: 'Job' },
    { accessorKey: 'queue', header: 'Queue' },
    { accessorKey: 'attempts', header: 'Attempts' },
    { accessorKey: 'firstFailure', header: 'First failure', cell: ({ getValue }) => { const v = getValue<string | null>(); return v ? new Date(v).toLocaleString() : '—' } },
    { accessorKey: 'lastFailure', header: 'Last failure', cell: ({ getValue }) => { const v = getValue<string | null>(); return v ? new Date(v).toLocaleString() : '—' } },
    { accessorKey: 'error', header: 'Error', cell: ({ getValue }) => <span className="text-destructive">{getValue<string>()}</span> },
    { accessorKey: 'worker', header: 'Worker', cell: ({ getValue }) => getValue<string | null>() ?? '—' },
    { accessorKey: 'payloadSummary', header: 'Payload' },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Dead Letter Queue"
        description="1) Inspect the failure category. 2) Classify as transient, data, provider, or code. 3) Retry only if retryable. 4) Manual replay creates a new retry lineage — it never rewrites historical job state. 5) Close the incident only after downstream consistency checks pass."
      />

      <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
        <MetricCard label="Dead-lettered jobs" value={deadLetterJobs.length} icon={Inbox} tone={deadLetterJobs.length > 0 ? 'critical' : 'success'} />
        <MetricCard label="Queues affected" value={new Set(deadLetterJobs.map((j) => j.queue)).size} />
        <MetricCard label="Avg attempts before DLQ" value={Math.round(deadLetterJobs.reduce((s, j) => s + j.attempts, 0) / Math.max(deadLetterJobs.length, 1))} />
        <MetricCard label="Oldest failure" value={deadLetterJobs.length > 0 ? new Date(Math.min(...deadLetterJobs.map((j) => new Date(j.firstFailure ?? Date.now()).getTime()))).toLocaleDateString() : '—'} />
      </div>

      <DataTable columns={columns} data={deadLetterJobs} searchPlaceholder="Search dead-letter jobs…" onRowClick={setSelected} pageSize={12} emptyMessage="No jobs in the dead-letter queue." />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected?.id}
        description={selected ? `${selected.queue} · ${selected.attempts} attempts` : ''}
        footer={
          selected && (
            <div className="flex flex-wrap justify-end gap-density-sm">
              <Button variant="outline" onClick={() => setIncidentTarget(selected)}>
                <AlertTriangle className="h-4 w-4" /> Open incident
              </Button>
              <Button variant="outline" onClick={() => { actions.retryJob(selected.id); toast.info('Retry issued', { description: selected.id }) }}>
                <ShieldOff className="h-4 w-4" /> Retry
              </Button>
              <Button onClick={() => setReplayTarget(selected)}>
                <RotateCw className="h-4 w-4" /> Replay
              </Button>
            </div>
          )
        }
      >
        {selected && (
          <div className="flex flex-col gap-density-md text-sm">
            <StatusBadge status={selected.status} />
            <Fact label="Payload" value={selected.payloadSummary} />
            <Fact label="Error" value={selected.error ?? '—'} />
            <Fact label="Checkpoint" value={selected.checkpoint} />
            <Fact label="Worker" value={selected.worker ?? '—'} />
            <Fact label="First failure" value={selected.firstFailure ? new Date(selected.firstFailure).toLocaleString() : '—'} />
            <Fact label="Last failure" value={selected.lastFailure ? new Date(selected.lastFailure).toLocaleString() : '—'} />
            <Fact label="Expected effect of replay" value="Creates a new retry lineage in the same queue; this record stays as historical evidence." />
          </div>
        )}
      </DetailDrawer>

      <ConfirmDialog
        open={!!replayTarget}
        onOpenChange={(o) => !o && setReplayTarget(null)}
        title={`Replay ${replayTarget?.id}`}
        actionSummary="Creates a new retry lineage for this job. Historical job state is never rewritten."
        scope={`${replayTarget?.queue} · ${replayTarget?.payloadSummary}`}
        consequences={[
          'A new job attempt is created; the original dead-letter record is preserved for audit.',
          'Downstream consistency checks must pass before any related incident can be closed.',
          'Repeated replay of a non-retryable failure class will dead-letter again.',
        ]}
        confirmLabel="Replay job"
        onConfirm={() => {
          if (replayTarget) actions.replayJob(replayTarget.id)
          toast.success('Replay job created', { description: 'New retry lineage added to the queue.' })
        }}
      />

      {incidentTarget && (
        <OpenIncidentDialog
          open={!!incidentTarget}
          onOpenChange={(o) => !o && setIncidentTarget(null)}
          subject={incidentTarget.id}
          onCreate={(payload) => toast.success('Incident opened', { description: `${incidentTarget.id}: ${payload.description}` })}
        />
      )}
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
