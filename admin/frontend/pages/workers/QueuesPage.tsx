import { useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { HealthIndicator } from '../../components/status/HealthIndicator'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { OpenIncidentDialog } from '../../components/dialogs/OpenIncidentDialog'
import { Tabs, TabsList, TabsTrigger } from '../../lib/shadcn/tabs'
import { Button } from '../../lib/shadcn/button'
import { Input } from '../../lib/shadcn/input'
import { Label } from '../../lib/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../lib/shadcn/dropdown-menu'
import { toast } from '../../lib/shadcn/sonner'
import { useQueues, useJobs, useStoreActions } from '../../state/StoreContext'
import type { QueueStat, Job, QueueName } from '../../types/domain'
import { Clock, Repeat, RotateCw, Pause, Play, PlusCircle, MoreHorizontal, Search, AlertTriangle } from 'lucide-react'

const TABS = [
  { path: '/workers/queues', value: 'queues', label: 'Queues' },
  { path: '/workers/jobs', value: 'jobs', label: 'Jobs' },
  { path: '/workers/scheduler', value: 'scheduler', label: 'Scheduler' },
  { path: '/workers/cron', value: 'cron', label: 'Cron / Automation' },
]

const MANUAL_QUEUES: QueueName[] = ['BACKFILL_QUEUE', 'REPAIR_QUEUE', 'MODEL_TRAINING_QUEUE', 'EVALUATION_QUEUE']

export default function QueuesPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const active = TABS.find((t) => t.path === location.pathname)?.value ?? 'queues'
  const queues = useQueues()
  const jobs = useJobs()
  const actions = useStoreActions()

  const [selectedQueue, setSelectedQueue] = useState<QueueStat | null>(null)
  const [pauseTarget, setPauseTarget] = useState<QueueStat | null>(null)
  const [createJobOpen, setCreateJobOpen] = useState(false)
  const [inspectJob, setInspectJob] = useState<Job | null>(null)
  const [incidentJob, setIncidentJob] = useState<Job | null>(null)

  const liveSelectedQueue = selectedQueue ? queues.find((q) => q.name === selectedQueue.name) ?? null : null

  const queueColumns = useMemo<ColumnDef<QueueStat, any>[]>(() => [
    { accessorKey: 'label', header: 'Queue' },
    { accessorKey: 'depth', header: 'Depth' },
    { accessorKey: 'oldestJobAgeMin', header: 'Oldest job age', cell: ({ getValue }) => `${getValue<number>()} min` },
    { accessorKey: 'p95AgeMin', header: 'p95 age', cell: ({ getValue }) => `${getValue<number>()} min` },
    { accessorKey: 'throughputPerMin', header: 'Throughput', cell: ({ getValue }) => `${getValue<number>()}/min` },
    { accessorKey: 'retrying', header: 'Retrying' },
    { accessorKey: 'deadLetter', header: 'Dead-letter' },
    { accessorKey: 'workers', header: 'Workers' },
    { accessorKey: 'slaStatus', header: 'SLA', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'paused', header: 'State', cell: ({ getValue }) => <StatusBadge status={getValue<boolean>() ? 'PAUSED' : 'ENABLED'} dense /> },
  ], [])

  const jobColumns = useMemo<ColumnDef<Job, any>[]>(() => [
    { accessorKey: 'id', header: 'Job' },
    { accessorKey: 'queue', header: 'Queue' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'attempts', header: 'Attempts' },
    { accessorKey: 'priority', header: 'Priority', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'worker', header: 'Worker', cell: ({ getValue }) => getValue<string | null>() ?? '—' },
    { accessorKey: 'payloadSummary', header: 'Payload' },
    { accessorKey: 'error', header: 'Error', cell: ({ getValue }) => { const v = getValue<string | null>(); return v ? <span className="text-destructive">{v}</span> : '—' } },
    {
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => {
        const job = row.original
        const canRetry = job.status === 'FAILED' || job.status === 'DEAD_LETTER' || job.status === 'RETRYING'
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Job actions" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>{job.id}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setInspectJob(job)}>
                <Search className="h-4 w-4" /> Inspect
              </DropdownMenuItem>
              {canRetry && (
                <DropdownMenuItem onSelect={() => { actions.retryJob(job.id); toast.info('Retry issued', { description: job.id }) }}>
                  <RotateCw className="h-4 w-4" /> Retry
                </DropdownMenuItem>
              )}
              {job.status === 'DEAD_LETTER' && (
                <DropdownMenuItem onSelect={() => { actions.replayJob(job.id); toast.success('Replay lineage created', { description: job.id }) }}>
                  <Repeat className="h-4 w-4" /> Replay
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setIncidentJob(job)}>
                <AlertTriangle className="h-4 w-4" /> Open incident
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [actions])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Queues & Worker Control Center"
        description="Background processing pipelines — CONTROL, BACKFILL, FIXTURE, ODDS, ENRICHMENT, PREDICTION, REPAIR, EVALUATION, and MODEL_TRAINING queues."
        {...(active === 'jobs' ? { actions: <Button onClick={() => setCreateJobOpen(true)}><PlusCircle className="h-4 w-4" /> Create job</Button> } : {})}
      />
      <Tabs value={active} onValueChange={(v) => navigate(TABS.find((t) => t.value === v)?.path ?? '/workers/queues')}>
        <TabsList>{TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}</TabsList>
      </Tabs>

      {active === 'queues' && (
        <>
          <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
            <MetricCard label="Total depth" value={queues.reduce((s, q) => s + q.depth, 0)} />
            <MetricCard label="Retrying" value={queues.reduce((s, q) => s + q.retrying, 0)} tone="warning" />
            <MetricCard label="Dead-letter" value={queues.reduce((s, q) => s + q.deadLetter, 0)} tone="critical" />
            <MetricCard label="Workers online" value={queues.reduce((s, q) => s + q.workers, 0)} tone="success" />
          </div>
          <DataTable columns={queueColumns} data={queues} searchPlaceholder="Search queues…" onRowClick={setSelectedQueue} pageSize={10} />
        </>
      )}

      {active === 'jobs' && (
        <DataTable columns={jobColumns} data={jobs} searchPlaceholder="Search jobs…" pageSize={14} />
      )}

      {active === 'scheduler' && <SchedulerTab />}
      {active === 'cron' && <CronTab />}

      <DetailDrawer
        open={!!liveSelectedQueue}
        onOpenChange={(o) => !o && setSelectedQueue(null)}
        title={liveSelectedQueue?.label}
        description={liveSelectedQueue ? `${liveSelectedQueue.workers} workers · SLA ${liveSelectedQueue.slaStatus}` : ''}
        footer={
          liveSelectedQueue && (
            <div className="flex flex-wrap justify-end gap-density-sm">
              {liveSelectedQueue.paused ? (
                <Button variant="outline" onClick={() => { actions.resumeQueue(liveSelectedQueue.name); toast.success(`${liveSelectedQueue.label} resumed`) }}>
                  <Play className="h-4 w-4" /> Resume queue
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setPauseTarget(liveSelectedQueue)}>
                  <Pause className="h-4 w-4" /> Pause queue
                </Button>
              )}
            </div>
          )
        }
      >
        {liveSelectedQueue && (
          <div className="grid grid-cols-2 gap-density-md text-sm">
            <Fact label="Depth" value={liveSelectedQueue.depth} />
            <Fact label="Oldest job age" value={`${liveSelectedQueue.oldestJobAgeMin} min`} />
            <Fact label="p50 / p95 age" value={`${liveSelectedQueue.p50AgeMin} / ${liveSelectedQueue.p95AgeMin} min`} />
            <Fact label="Throughput" value={`${liveSelectedQueue.throughputPerMin}/min`} />
            <Fact label="Failures" value={liveSelectedQueue.failures} />
            <Fact label="Retrying" value={liveSelectedQueue.retrying} />
            <Fact label="Dead-letter" value={liveSelectedQueue.deadLetter} />
            <Fact label="Workers" value={liveSelectedQueue.workers} />
            <Fact label="SLA status" value={<StatusBadge status={liveSelectedQueue.slaStatus} />} />
            <Fact label="Recent jobs" value={`${jobs.filter((j) => j.queue === liveSelectedQueue.name).length} tracked`} />
          </div>
        )}
      </DetailDrawer>

      <DetailDrawer
        open={!!inspectJob}
        onOpenChange={(o) => !o && setInspectJob(null)}
        title={inspectJob?.id}
        description={inspectJob?.queue}
      >
        {inspectJob && (
          <div className="grid grid-cols-2 gap-density-md text-sm">
            <Fact label="Status" value={<StatusBadge status={inspectJob.status} />} />
            <Fact label="Attempts" value={inspectJob.attempts} />
            <Fact label="Priority" value={<StatusBadge status={inspectJob.priority} dense />} />
            <Fact label="Worker" value={inspectJob.worker ?? '—'} />
            <Fact label="Checkpoint" value={inspectJob.checkpoint} />
            <Fact label="Error" value={inspectJob.error ?? '—'} />
            <Fact label="First failure" value={inspectJob.firstFailure ? new Date(inspectJob.firstFailure).toLocaleString() : '—'} />
            <Fact label="Last failure" value={inspectJob.lastFailure ? new Date(inspectJob.lastFailure).toLocaleString() : '—'} />
            <div className="col-span-2"><Fact label="Payload" value={inspectJob.payloadSummary} /></div>
          </div>
        )}
      </DetailDrawer>

      <ConfirmDialog
        open={!!pauseTarget}
        onOpenChange={(o) => !o && setPauseTarget(null)}
        title={`Pause ${pauseTarget?.label} queue`}
        actionSummary="Stops new job dispatch to workers on this queue. In-flight jobs complete normally."
        scope={pauseTarget?.label ?? ''}
        consequences={['No new jobs will be dispatched until resumed.', 'Downstream dependents may see increased latency.', 'Requires manual resume — recorded in the audit log.']}
        confirmLabel="Pause queue"
        onConfirm={(reason) => {
          if (pauseTarget) actions.pauseQueue(pauseTarget.name, reason)
          toast.success(`${pauseTarget?.label} queue paused`)
        }}
      />

      {incidentJob && (
        <OpenIncidentDialog
          open={!!incidentJob}
          onOpenChange={(o) => !o && setIncidentJob(null)}
          subject={incidentJob.id}
          onCreate={(payload) => toast.success('Incident opened', { description: `${incidentJob.id}: ${payload.description}` })}
        />
      )}

      <CreateJobDialog
        open={createJobOpen}
        onOpenChange={setCreateJobOpen}
        onCreate={(queueName, input) => {
          actions.createJob(queueName, input)
          toast.success('Job created', { description: `Queued to ${queueName}` })
        }}
      />
    </div>
  )
}

function CreateJobDialog({ open, onOpenChange, onCreate }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreate: (queueName: QueueName, input: { priority: Job['priority']; payloadSummary: string; reason: string }) => void
}) {
  const [queueName, setQueueName] = useState<QueueName>(MANUAL_QUEUES[0]!)
  const [priority, setPriority] = useState<Job['priority']>('normal')
  const [payloadSummary, setPayloadSummary] = useState('')
  const [reason, setReason] = useState('')

  function reset() {
    setQueueName(MANUAL_QUEUES[0]!)
    setPriority('normal')
    setPayloadSummary('')
    setReason('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create job</DialogTitle>
          <DialogDescription>Only queues that the architecture treats as manually initiable are available here.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-density-md">
          <div className="flex flex-col gap-1.5">
            <Label>Queue</Label>
            <Select value={queueName} onValueChange={(v) => setQueueName(v as QueueName)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MANUAL_QUEUES.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as Job['priority'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(['low', 'normal', 'high'] as const).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Payload summary</Label>
            <Input value={payloadSummary} onChange={(e) => setPayloadSummary(e.target.value)} placeholder="e.g. Backfill 2022/23 La Liga enrichment" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this job needed?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={payloadSummary.trim().length < 4 || reason.trim().length < 4}
            onClick={() => { onCreate(queueName, { priority, payloadSummary, reason }); onOpenChange(false); reset() }}
          >
            Create job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SchedulerTab() {
  const scheduled = [
    { id: 'SCH-01', name: 'Daily fixture discovery sweep', cadence: 'Every day at 03:00 UTC', nextRun: 'in 6h 12m', status: 'HEALTHY' },
    { id: 'SCH-02', name: 'Odds refresh sweep (Tier 1 leagues)', cadence: 'Every 15 minutes', nextRun: 'in 4m', status: 'HEALTHY' },
    { id: 'SCH-03', name: 'Data quality scan', cadence: 'Every hour', nextRun: 'in 22m', status: 'HEALTHY' },
    { id: 'SCH-04', name: 'Archive integrity scan', cadence: 'Nightly at 01:00 UTC', nextRun: 'in 8h 40m', status: 'WARNING' },
    { id: 'SCH-05', name: 'Historical bootstrap tranche dispatch', cadence: 'Continuous, quota-gated', nextRun: 'in 2m', status: 'HEALTHY' },
  ]
  return (
    <div className="flex flex-col gap-density-sm">
      {scheduled.map((s) => (
        <div key={s.id} className="flex items-center justify-between rounded-md border border-border bg-card p-density-md shadow-retool-sm">
          <div className="flex items-center gap-density-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">{s.name}</div>
              <div className="text-xs text-muted-foreground">{s.cadence} · next run {s.nextRun}</div>
            </div>
          </div>
          <HealthIndicator status={s.status} label={s.status} size="sm" />
        </div>
      ))}
    </div>
  )
}

function CronTab() {
  const jobs = [
    { id: 'CRON-01', name: 'secret-rotation-warning-scan', cadence: '0 6 * * *', lastRun: '5h ago', status: 'HEALTHY' },
    { id: 'CRON-02', name: 'drift-metric-recompute', cadence: '*/30 * * * *', lastRun: '12m ago', status: 'HEALTHY' },
    { id: 'CRON-03', name: 'shadow-evaluation-rollup', cadence: '0 * * * *', lastRun: '48m ago', status: 'HEALTHY' },
    { id: 'CRON-04', name: 'stale-lock-recovery-sweep', cadence: '*/5 * * * *', lastRun: '1m ago', status: 'WARNING' },
  ]
  return (
    <div className="flex flex-col gap-density-sm">
      {jobs.map((j) => (
        <div key={j.id} className="flex items-center justify-between rounded-md border border-border bg-card p-density-md shadow-retool-sm">
          <div className="flex items-center gap-density-sm">
            <Repeat className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="font-mono text-sm font-medium text-foreground">{j.name}</div>
              <div className="text-xs text-muted-foreground">cron({j.cadence}) · last run {j.lastRun}</div>
            </div>
          </div>
          <HealthIndicator status={j.status} label={j.status} size="sm" />
        </div>
      ))}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium text-foreground">{value}</div>
    </div>
  )
}
