import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Timeline } from '../../components/timeline/Timeline'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { Button } from '../../lib/shadcn/button'
import { Input } from '../../lib/shadcn/input'
import { Label } from '../../lib/shadcn/label'
import { Textarea } from '../../lib/shadcn/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import { toast } from '../../lib/shadcn/sonner'
import { useIncidents, useStoreActions } from '../../state/StoreContext'
import type { Incident, IncidentSeverity, IncidentCategory } from '../../types/domain'
import { Siren, AlertTriangle, CheckCircle2, Flame, PlusCircle, UserPlus } from 'lucide-react'

const ALL = '__all__'
const SEVERITY_TONE: Record<IncidentSeverity, 'critical' | 'warning' | 'info'> = { P0: 'critical', P1: 'critical', P2: 'warning', P3: 'info' }
const CATEGORIES: IncidentCategory[] = ['Provider', 'Data', 'Prediction', 'Model', 'Queue', 'Database', 'Security', 'Compliance', 'Archive', 'Performance']

export default function IncidentCenter() {
  const incidents = useIncidents()
  const actions = useStoreActions()
  const [severityFilter, setSeverityFilter] = useState(ALL)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [resolveOpen, setResolveOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const selected = incidents.find((i) => i.id === selectedId) ?? null

  const open = incidents.filter((i) => i.status !== 'RESOLVED' && i.status !== 'CLOSED')
  const p0 = incidents.filter((i) => i.severity === 'P0' && i.status !== 'RESOLVED' && i.status !== 'CLOSED').length

  const filtered = useMemo(
    () => incidents.filter((i) => severityFilter === ALL || i.severity === severityFilter),
    [incidents, severityFilter]
  )

  const columns = useMemo<ColumnDef<Incident, any>[]>(() => [
    { accessorKey: 'id', header: 'ID' },
    { accessorKey: 'severity', header: 'Severity', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} tone={SEVERITY_TONE[getValue<IncidentSeverity>()]} /> },
    { accessorKey: 'category', header: 'Category' },
    { accessorKey: 'title', header: 'Title' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'owner', header: 'Owner' },
    { accessorKey: 'updatedAt', header: 'Updated', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString() },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Incident Center"
        description="Open, assign, escalate, acknowledge, and resolve incidents across providers, data, predictions, models, queues, database, security, compliance, archive, and performance."
        actions={<Button onClick={() => setCreateOpen(true)}><PlusCircle className="h-4 w-4" /> Create incident</Button>}
      />

      <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
        <MetricCard label="Open incidents" value={open.length} icon={Siren} tone={open.length > 0 ? 'warning' : 'success'} />
        <MetricCard label="P0 critical" value={p0} icon={Flame} tone={p0 > 0 ? 'critical' : 'success'} />
        <MetricCard label="Resolved" value={incidents.filter((i) => i.status === 'RESOLVED').length} icon={CheckCircle2} tone="success" />
        <MetricCard label="Total tracked" value={incidents.length} icon={AlertTriangle} />
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="Search incidents…"
        onRowClick={(i) => setSelectedId(i.id)}
        pageSize={14}
        toolbarExtra={
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All severities</SelectItem>
              {['P0', 'P1', 'P2', 'P3'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelectedId(null)}
        title={selected?.title}
        description={selected ? `${selected.id} · ${selected.category} · Owner ${selected.owner}` : ''}
        footer={
          selected && (
            <div className="flex flex-wrap justify-end gap-density-sm">
              {selected.status !== 'RESOLVED' && selected.status !== 'CLOSED' && (
                <>
                  <Button variant="outline" onClick={() => setAssignOpen(true)}>
                    <UserPlus className="h-4 w-4" /> Assign
                  </Button>
                  <Button variant="outline" onClick={() => { actions.escalateIncident(selected.id); toast.info('Incident escalated') }}>Escalate</Button>
                  <Button variant="outline" onClick={() => { actions.acknowledgeIncident(selected.id); toast.info('Incident acknowledged') }}>Acknowledge</Button>
                  <Button onClick={() => setResolveOpen(true)}>Resolve</Button>
                </>
              )}
              {selected.status === 'RESOLVED' && (
                <Button variant="outline" onClick={() => { actions.closeIncident(selected.id); toast.success('Incident closed') }}>Close</Button>
              )}
            </div>
          )
        }
      >
        {selected && (
          <div className="flex flex-col gap-density-lg">
            <div className="flex items-center gap-density-sm">
              <StatusBadge status={selected.severity} tone={SEVERITY_TONE[selected.severity]} />
              <StatusBadge status={selected.status} />
            </div>
            <div>
              <div className="mb-1 text-xs uppercase text-muted-foreground">Impact</div>
              <p className="text-sm text-foreground">{selected.impact}</p>
            </div>
            <div>
              <div className="mb-1 text-xs uppercase text-muted-foreground">Affected entities</div>
              <div className="flex flex-wrap gap-1.5">
                {selected.affectedEntities.map((e) => <span key={e} className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">{e}</span>)}
              </div>
            </div>
            <div>
              <div className="mb-density-sm text-xs uppercase text-muted-foreground">Timeline</div>
              <Timeline items={selected.timeline.map((t, i) => ({ id: `${selected.id}-${i}`, timestamp: t.ts, title: t.note }))} />
            </div>
            {selected.resolution && (
              <div className="rounded-md border border-success/30 zc-chip-success p-density-md text-sm">
                <span className="font-medium">Resolution: </span>{selected.resolution}
              </div>
            )}
          </div>
        )}
      </DetailDrawer>

      {selected && (
        <ConfirmDialog
          open={resolveOpen}
          onOpenChange={setResolveOpen}
          title={`Resolve ${selected.id}`}
          actionSummary="Marks this incident resolved after downstream verification checks have passed."
          scope={selected.title}
          consequences={['Incident status becomes RESOLVED and is removed from active alerting.', 'A resolution note is required for the audit trail.', 'Can be reopened if the underlying issue recurs.']}
          confirmLabel="Resolve incident"
          destructive={false}
          onConfirm={(reason) => { actions.resolveIncident(selected.id, reason); toast.success('Incident resolved') }}
        />
      )}

      <AssignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        onAssign={(owner) => { if (selected) actions.assignIncident(selected.id, owner); toast.success('Incident assigned') }}
      />

      <CreateIncidentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(input) => { actions.createIncident(input); toast.success('Incident created') }}
      />
    </div>
  )
}

function AssignDialog({ open, onOpenChange, onAssign }: { open: boolean; onOpenChange: (o: boolean) => void; onAssign: (owner: string) => void }) {
  const [owner, setOwner] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Assign incident</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-1.5"><Label>Owner</Label><Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Operator name" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!owner.trim()} onClick={() => { onAssign(owner); onOpenChange(false); setOwner('') }}>Assign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateIncidentDialog({ open, onOpenChange, onCreate }: {
  open: boolean; onOpenChange: (o: boolean) => void
  onCreate: (input: { type: string; severity: IncidentSeverity; category: IncidentCategory; scope: string; description: string; materialToPrediction: boolean; reason: string }) => void
}) {
  const [type, setType] = useState('Manual report')
  const [severity, setSeverity] = useState<IncidentSeverity>('P2')
  const [category, setCategory] = useState<IncidentCategory>('Data')
  const [scope, setScope] = useState('')
  const [description, setDescription] = useState('')

  function reset() {
    setType('Manual report'); setSeverity('P2'); setCategory('Data'); setScope(''); setDescription('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create incident</DialogTitle>
          <DialogDescription>Opens a new tracked incident with a status and timeline.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-density-md">
          <div className="flex flex-col gap-1.5"><Label>Type</Label><Input value={type} onChange={(e) => setType(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5">
            <Label>Severity</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as IncidentSeverity)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(['P0', 'P1', 'P2', 'P3'] as const).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as IncidentCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5"><Label>Scope (fixture / league / provider)</Label><Input value={scope} onChange={(e) => setScope(e.target.value)} /></div>
          <div className="col-span-2 flex flex-col gap-1.5"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!scope.trim() || description.trim().length < 4}
            onClick={() => {
              onCreate({ type, severity, category, scope, description, materialToPrediction: category === 'Prediction' || category === 'Model', reason: `${type}: ${description}` })
              onOpenChange(false)
              reset()
            }}
          >
            Create incident
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
