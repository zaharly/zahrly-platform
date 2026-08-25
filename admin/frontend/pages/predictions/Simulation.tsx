import { useMemo, useState, type ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { Button } from '../../lib/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { Label } from '../../lib/shadcn/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import { toast } from '../../lib/shadcn/sonner'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useSimulationRuns, useFixtures, useStoreActions } from '../../state/StoreContext'
import { fixtureLabel } from '../../mock/data/fixtures'
import type { SimulationRun, SimulationMode, SimulationRunStatus } from '../../types/domain'
import { Dices, Cpu, Clock, RotateCw, GitCompareArrows, PlusCircle } from 'lucide-react'

const MODES: SimulationMode[] = ['Routine', 'Material', 'Final Lock', 'Research']
const RUN_STATUS_TONE: Record<SimulationRunStatus, 'info' | 'warning' | 'success'> = { queued: 'warning', running: 'info', done: 'success' }

export default function Simulation() {
  const simulationRuns = useSimulationRuns()
  const fixtures = useFixtures()
  const actions = useStoreActions()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const selected = simulationRuns.find((s) => s.id === selectedId) ?? null
  const compareTarget = simulationRuns.find((s) => s.id === compareId) ?? null

  const doneRuns = simulationRuns.filter((s) => s.runStatus === 'done')
  const convergedPct = doneRuns.length > 0 ? Math.round((doneRuns.filter((s) => s.outcome === 'converged').length / doneRuns.length) * 100) : 0
  const avgRuntimeP95 = Math.round(simulationRuns.reduce((sum, s) => sum + s.runtimeP95, 0) / simulationRuns.length)
  const avgMemory = Math.round(simulationRuns.reduce((sum, s) => sum + s.memoryMb, 0) / simulationRuns.length)

  const columns = useMemo<ColumnDef<SimulationRun, any>[]>(() => [
    { accessorKey: 'fixtureLabel', header: 'Fixture' },
    { accessorKey: 'mode', header: 'Mode', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} tone="info" dense /> },
    { accessorKey: 'runStatus', header: 'Run status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} tone={RUN_STATUS_TONE[getValue<SimulationRunStatus>()]} dense /> },
    { accessorKey: 'samplesUsed', header: 'Samples used / cap', cell: ({ row }) => `${row.original.samplesUsed.toLocaleString()} / ${row.original.samplesCap.toLocaleString()}` },
    { accessorKey: 'halfWidth', header: '95% half-width', cell: ({ getValue }) => `±${getValue<number>()}` },
    { accessorKey: 'runtimeP95', header: 'Runtime p95', cell: ({ getValue }) => `${getValue<number>()} ms` },
    { accessorKey: 'outcome', header: 'Outcome', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Simulation Monitor"
        description="Monte Carlo simulation runs as a background batch workload — not a synchronous API call. Tracks convergence, precision, and runtime pressure per fixture."
        actions={<Button onClick={() => setCreateOpen(true)}><PlusCircle className="h-4 w-4" /> Create simulation job</Button>}
      />

      <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
        <MetricCard label="Convergence rate" value={`${convergedPct}%`} icon={Dices} tone={convergedPct >= 80 ? 'success' : 'warning'} />
        <MetricCard label="Runs tracked" value={simulationRuns.length} />
        <MetricCard label="Avg p95 runtime" value={`${avgRuntimeP95} ms`} icon={Clock} />
        <MetricCard label="Avg memory (RSS)" value={`${avgMemory} MB`} icon={Cpu} />
      </div>

      <DataTable columns={columns} data={simulationRuns} searchPlaceholder="Search simulation runs…" onRowClick={(s) => setSelectedId(s.id)} pageSize={12} />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelectedId(null)}
        title={selected?.fixtureLabel}
        description={selected ? `${selected.mode} · Dependency profile ${selected.dependencyProfile}` : ''}
        footer={
          selected && (
            <div className="flex flex-wrap justify-end gap-density-sm">
              <Button variant="outline" onClick={() => setCompareId(simulationRuns.find((s) => s.id !== selected.id)?.id ?? null)}>
                <GitCompareArrows className="h-4 w-4" /> Compare
              </Button>
              <Button
                onClick={() => { actions.rerunSimulation(selected.id); toast.info('Simulation re-run queued', { description: selected.fixtureLabel }) }}
                disabled={selected.runStatus !== 'done'}
              >
                <RotateCw className="h-4 w-4" /> Re-run
              </Button>
            </div>
          )
        }
      >
        {selected && (
          <div className="flex flex-col gap-density-lg">
            <div className="grid grid-cols-2 gap-density-md">
              <Fact label="Run status" value={<StatusBadge status={selected.runStatus} tone={RUN_STATUS_TONE[selected.runStatus]} dense />} />
              <Fact label="Samples used / cap" value={`${selected.samplesUsed.toLocaleString()} / ${selected.samplesCap.toLocaleString()}`} />
              <Fact label="Standard error (SE)" value={selected.se.toFixed(3)} />
              <Fact label="95% half-width" value={`±${selected.halfWidth}`} />
              <Fact label="Outcome" value={<StatusBadge status={selected.outcome} />} />
              <Fact label="Runtime p50 / p95 / p99" value={`${selected.runtimeP50} / ${selected.runtimeP95} / ${selected.runtimeP99} ms`} />
              <Fact label="Sparse-event hits" value={selected.sparseEventHits} />
              <Fact label="Started" value={new Date(selected.startedAt).toLocaleString()} />
            </div>
            <div>
              <div className="mb-density-sm text-xs uppercase text-muted-foreground">Convergence checkpoints (5k + every 1k)</div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={selected.checkpoints}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="samples" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'half-width', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                    <Line type="monotone" dataKey="halfWidth" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>

      <Dialog open={!!compareTarget} onOpenChange={(o) => !o && setCompareId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Compare simulation runs</DialogTitle>
            <DialogDescription>{selected?.fixtureLabel} vs {compareTarget?.fixtureLabel}</DialogDescription>
          </DialogHeader>
          {selected && compareTarget && (
            <div className="grid grid-cols-2 gap-density-md text-sm">
              <CompareColumn run={selected} />
              <CompareColumn run={compareTarget} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompareId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateSimulationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        fixtureLabels={fixtures.slice(0, 30).map((f) => fixtureLabel(f))}
        onCreate={(label, mode) => { actions.createSimulationJob(label, mode); toast.success('Simulation job created', { description: `${label} · ${mode}` }) }}
      />
    </div>
  )
}

function CompareColumn({ run }: { run: SimulationRun }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border p-density-sm">
      <div className="font-medium text-foreground">{run.fixtureLabel}</div>
      <Fact label="Mode" value={run.mode} />
      <Fact label="Outcome" value={<StatusBadge status={run.outcome} dense />} />
      <Fact label="Half-width" value={`±${run.halfWidth}`} />
      <Fact label="Samples used" value={run.samplesUsed.toLocaleString()} />
      <Fact label="Runtime p95" value={`${run.runtimeP95} ms`} />
    </div>
  )
}

function CreateSimulationDialog({ open, onOpenChange, fixtureLabels, onCreate }: {
  open: boolean; onOpenChange: (o: boolean) => void; fixtureLabels: string[]
  onCreate: (fixtureLabel: string, mode: SimulationMode) => void
}) {
  const [label, setLabel] = useState(fixtureLabels[0] ?? '')
  const [mode, setMode] = useState<SimulationMode>('Routine')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create simulation job</DialogTitle>
          <DialogDescription>Queues a background Monte Carlo run — this never executes synchronously in the browser.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-density-md">
          <div className="flex flex-col gap-1.5">
            <Label>Fixture</Label>
            <Select value={label} onValueChange={setLabel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{fixtureLabels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as SimulationMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { onCreate(label, mode); onOpenChange(false) }}>Create job</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}
