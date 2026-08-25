import { useState } from 'react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { Timeline } from '../../components/timeline/Timeline'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import { useStoreActions, useModelVersions, useActiveModel, useAuditEvents } from '../../state/StoreContext'
import { Undo2, ShieldAlert } from 'lucide-react'

export default function Rollback() {
  const modelVersions = useModelVersions()
  const activeModel = useActiveModel()
  const auditEvents = useAuditEvents()
  const actions = useStoreActions()
  const previousSafe = [...modelVersions]
    .filter((m) => m.status === 'RETIRED')
    .sort((a, b) => new Date(b.promotedAt ?? b.createdAt).getTime() - new Date(a.promotedAt ?? a.createdAt).getTime())[0]
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const rollbackAudit = auditEvents.filter((a) => a.action === 'rollback_model')

  if (!activeModel || !previousSafe) {
    return (
      <div className="flex flex-col gap-density-md">
        <PageHeader title="Rollback Center" description="No retired model is available to roll back to." />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Rollback Center"
        description="Rollback is a highly controlled administrative operation. It requires a reason, an authorized operator, and second approval for major model-family changes."
        tag={<StatusBadge status="ROLLBACK" tone="warning" />}
      />

      <div className="grid grid-cols-1 gap-density-lg lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="mb-density-sm text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current model</div>
          <div className="text-2xl font-semibold text-foreground">{activeModel.version}</div>
          <div className="text-sm text-muted-foreground">{activeModel.family} · Log Loss {activeModel.metrics.logLoss.toFixed(3)}</div>
          <StatusBadge status={activeModel.status} className="mt-density-sm" />
        </div>
        <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
          <div className="mb-density-sm text-xs font-semibold uppercase tracking-wide text-muted-foreground">Previous safe model</div>
          <div className="text-2xl font-semibold text-foreground">{previousSafe.version}</div>
          <div className="text-sm text-muted-foreground">{previousSafe.family} · Log Loss {previousSafe.metrics.logLoss.toFixed(3)}</div>
          <StatusBadge status={previousSafe.status} className="mt-density-sm" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <h2 className="mb-density-sm text-base font-semibold text-foreground">What changes vs. what stays immutable</h2>
        <div className="grid grid-cols-1 gap-density-md sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-success">Changes on rollback</div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Active production model pointer reverts to {previousSafe.version}.</li>
              <li>Prediction read-model cache is invalidated and rebuilt from the reverted model.</li>
              <li>New predictions going forward use the reverted model version.</li>
            </ul>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-destructive">Remains immutable</div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>All previously created baseline probabilities and picks.</li>
              <li>Historical evidence sequences and audit records.</li>
              <li>Archived training and evaluation datasets.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-warning/30 zc-chip-warning p-density-md flex items-start gap-density-sm text-sm">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Rolling back to a different model family requires step-up authentication and a second approver before it takes effect. This request will be recorded pending review.</span>
      </div>

      <div>
        <Button variant="destructive" onClick={() => setRollbackOpen(true)}>
          <Undo2 className="h-4 w-4" /> Initiate rollback to {previousSafe.version}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <h2 className="mb-density-md text-base font-semibold text-foreground">Rollback audit trail</h2>
        <Timeline
          items={rollbackAudit.map((a) => ({
            id: a.id,
            timestamp: a.createdAt,
            tone: 'warning' as const,
            title: `${a.actorName} (${a.role}) — ${a.action}`,
            ...(a.reason ? { description: a.reason } : {}),
            meta: `${a.entityType} ${a.entityId}${a.ticketOrIncident ? ` · ${a.ticketOrIncident}` : ''}`,
          }))}
          emptyMessage="No rollback events recorded yet."
        />
      </div>

      <ConfirmDialog
        open={rollbackOpen}
        onOpenChange={setRollbackOpen}
        title={`Rollback to ${previousSafe.version}`}
        actionSummary="Reverts the active production model pointer and invalidates the prediction read-model cache."
        scope={`${activeModel.version} → ${previousSafe.version}`}
        consequences={[
          'New predictions will be generated using the reverted model immediately after cache invalidation.',
          'All existing baselines and evidence history remain immutable and unaffected.',
          'This action requires step-up authentication and is recorded with full before/after state in the audit log.',
        ]}
        requireSecondApproval
        confirmLabel="Request rollback"
        onConfirm={(reason) => {
          actions.rollbackModel(reason)
          toast.success(`Rolled back to ${previousSafe.version}`, { description: `${activeModel.version} marked as ROLLBACK.` })
        }}
      />
    </div>
  )
}
