import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { RefreshCw, Activity, ListTodo, Clock3, Workflow } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { DataTable } from '../../components/tables/DataTable'
import { StatusBadge } from '../../components/status/StatusBadge'
import { Button } from '../../lib/shadcn/button'
import { fetchWorkerControlSnapshot, type WorkerControlSnapshot, type WorkerJobLive, type WorkerQueueLive, type CronControlLive } from '../../lib/workerControlLive'

const TABS = [
  { path: '/workers/queues', label: 'Queues', icon: Activity },
  { path: '/workers/jobs', label: 'Jobs', icon: ListTodo },
  { path: '/workers/scheduler', label: 'Scheduler', icon: Clock3 },
  { path: '/workers/cron', label: 'Cron / Automation', icon: Workflow },
]

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : '—'
}

export default function WorkerControlLivePage() {
  const location = useLocation()
  const [snapshot, setSnapshot] = useState<WorkerControlSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await fetchWorkerControlSnapshot())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load live worker control data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(timer)
  }, [])

  const active = TABS.find((tab) => tab.path === location.pathname)?.path ?? '/workers/queues'

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Queues & Worker Control Center"
        description="Live operational state from the worker job store and pg_cron scheduler. No mock data is used on these four surfaces."
        tag={<StatusBadge status={loading ? 'LOADING' : error ? 'DEGRADED' : 'LIVE'} dense />}
        actions={(
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        )}
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const selected = active === tab.path
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${selected ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:bg-muted'}`}
            >
              <Icon className="h-4 w-4" /> {tab.label}
            </Link>
          )
        })}
      </div>

      {loading && !snapshot && <div className="rounded-lg border border-border bg-card p-density-lg text-sm text-muted-foreground">Loading live worker control state…</div>}
      {error && <div className="rounded-lg border border-destructive/30 bg-card p-density-lg text-sm text-destructive">Live backend read failed: {error}</div>}
      {snapshot && <LiveSurface snapshot={snapshot} active={active} />}
    </div>
  )
}

function LiveSurface({ snapshot, active }: { snapshot: WorkerControlSnapshot; active: string }) {
  const queueMetrics = useMemo(() => ({
    total: snapshot.queues.reduce((sum, q) => sum + q.total, 0),
    queued: snapshot.queues.reduce((sum, q) => sum + q.queued, 0),
    running: snapshot.queues.reduce((sum, q) => sum + q.running, 0),
    retrying: snapshot.queues.reduce((sum, q) => sum + q.retrying, 0),
    failed: snapshot.queues.reduce((sum, q) => sum + q.failed, 0),
    deadLetter: snapshot.queues.reduce((sum, q) => sum + q.dead_letter, 0),
    workers: snapshot.queues.reduce((sum, q) => sum + q.workers, 0),
  }), [snapshot.queues])

  if (active === '/workers/jobs') return <JobsSurface jobs={snapshot.jobs} capturedAt={snapshot.captured_at} />
  if (active === '/workers/scheduler') return <ScheduleSurface rows={snapshot.scheduler} title="Scheduler" capturedAt={snapshot.captured_at} />
  if (active === '/workers/cron') return <ScheduleSurface rows={snapshot.automation} title="Cron / Automation" capturedAt={snapshot.captured_at} />

  const columns = useMemo<ColumnDef<WorkerQueueLive, any>[]>(() => [
    { accessorKey: 'queue_name', header: 'Queue' },
    { accessorKey: 'total', header: 'Total' },
    { accessorKey: 'queued', header: 'Queued' },
    { accessorKey: 'running', header: 'Running' },
    { accessorKey: 'retrying', header: 'Retrying' },
    { accessorKey: 'failed', header: 'Failed' },
    { accessorKey: 'dead_letter', header: 'Dead-letter' },
    { accessorKey: 'workers', header: 'Workers' },
    { accessorKey: 'oldest_active_at', header: 'Oldest active', cell: ({ getValue }) => formatDate(getValue<string | null>()) },
    { accessorKey: 'last_finished_at', header: 'Last finished', cell: ({ getValue }) => formatDate(getValue<string | null>()) },
  ], [])

  return (
    <>
      <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
        <MetricCard label="Jobs" value={queueMetrics.total} icon={ListTodo} />
        <MetricCard label="Active / running" value={queueMetrics.queued + queueMetrics.running} icon={Activity} tone="info" />
        <MetricCard label="Retrying / failed" value={queueMetrics.retrying + queueMetrics.failed} icon={RefreshCw} tone={queueMetrics.failed > 0 ? 'warning' : 'success'} />
        <MetricCard label="Workers tracked" value={queueMetrics.workers} icon={Workflow} />
      </div>
      <DataTable columns={columns} data={snapshot.queues} searchPlaceholder="Search queues…" pageSize={12} emptyMessage="No queue records were returned by the backend." />
      <LiveFooter capturedAt={snapshot.captured_at} />
    </>
  )
}

function JobsSurface({ jobs, capturedAt }: { jobs: WorkerJobLive[]; capturedAt: string }) {
  const columns = useMemo<ColumnDef<WorkerJobLive, any>[]>(() => [
    { accessorKey: 'job_id', header: 'Job' },
    { accessorKey: 'queue_name', header: 'Queue' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'attempts', header: 'Attempts' },
    { accessorKey: 'worker_id', header: 'Worker', cell: ({ getValue }) => getValue<string | null>() ?? '—' },
    { accessorKey: 'created_at', header: 'Created', cell: ({ getValue }) => formatDate(getValue<string>()) },
    { accessorKey: 'started_at', header: 'Started', cell: ({ getValue }) => formatDate(getValue<string | null>()) },
    { accessorKey: 'finished_at', header: 'Finished', cell: ({ getValue }) => formatDate(getValue<string | null>()) },
    { accessorKey: 'next_retry_at', header: 'Next retry', cell: ({ getValue }) => formatDate(getValue<string | null>()) },
    { accessorKey: 'error_code', header: 'Error code', cell: ({ getValue }) => getValue<string | null>() ?? '—' },
  ], [])

  return (
    <>
      <MetricCard label="Jobs returned" value={jobs.length} sublabel="The backend RPC returns the latest 500 operational jobs." icon={ListTodo} />
      <DataTable columns={columns} data={jobs} searchPlaceholder="Search jobs…" pageSize={14} emptyMessage="No worker jobs were returned by the backend." />
      <LiveFooter capturedAt={capturedAt} />
    </>
  )
}

function ScheduleSurface({ rows, title, capturedAt }: { rows: CronControlLive[]; title: string; capturedAt: string }) {
  const columns = useMemo<ColumnDef<CronControlLive, any>[]>(() => [
    { accessorKey: 'job_id', header: 'Cron ID' },
    { accessorKey: 'label', header: 'Task' },
    { accessorKey: 'schedule', header: 'Schedule' },
    { accessorKey: 'active', header: 'State', cell: ({ getValue }) => <StatusBadge status={getValue<boolean>() ? 'ACTIVE' : 'DISABLED'} dense /> },
    { accessorKey: 'last_run_at', header: 'Last run', cell: ({ getValue }) => formatDate(getValue<string | null>()) },
    { accessorKey: 'last_end_at', header: 'Last end', cell: ({ getValue }) => formatDate(getValue<string | null>()) },
    { accessorKey: 'last_run_status', header: 'Last result', cell: ({ getValue }) => <StatusBadge status={getValue<string | null>() ?? 'UNKNOWN'} dense /> },
    { accessorKey: 'last_run_message', header: 'Message', cell: ({ getValue }) => getValue<string | null>() ?? '—' },
  ], [])

  return (
    <>
      <div className="grid grid-cols-2 gap-density-md md:grid-cols-3">
        <MetricCard label={`${title} definitions`} value={rows.length} icon={Clock3} />
        <MetricCard label="Active" value={rows.filter((r) => r.active).length} tone="success" />
        <MetricCard label="Last runs with status" value={rows.filter((r) => r.last_run_status).length} tone="info" />
      </div>
      <DataTable columns={columns} data={rows} searchPlaceholder={`Search ${title.toLowerCase()}…`} pageSize={12} emptyMessage={`No ${title.toLowerCase()} definitions were returned by pg_cron.`} />
      <LiveFooter capturedAt={capturedAt} />
    </>
  )
}

function LiveFooter({ capturedAt }: { capturedAt: string }) {
  return <div className="text-xs text-muted-foreground">Last backend snapshot: {formatDate(capturedAt)} · Source: protected Supabase admin RPC.</div>
}
