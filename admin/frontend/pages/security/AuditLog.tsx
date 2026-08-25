import { useMemo, useState, type ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { useAuditEvents } from '../../state/StoreContext'
import type { AuditEvent } from '../../types/domain'
import { Lock } from 'lucide-react'

export default function AuditLog() {
  const auditEvents = useAuditEvents()
  const [selected, setSelected] = useState<AuditEvent | null>(null)

  const columns = useMemo<ColumnDef<AuditEvent, any>[]>(() => [
    { accessorKey: 'createdAt', header: 'Time', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString() },
    { accessorKey: 'actorName', header: 'Actor' },
    { accessorKey: 'role', header: 'Role', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} tone="model" dense /> },
    { accessorKey: 'action', header: 'Action' },
    { accessorKey: 'entityType', header: 'Entity type' },
    { accessorKey: 'entityId', header: 'Entity ID' },
    { accessorKey: 'ticketOrIncident', header: 'Reference', cell: ({ getValue }) => getValue<string | null>() ?? '—' },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Audit Log"
        description="Immutable administrative trace. Every sensitive action — model promotion, rollback, league disable, provider quarantine, market status change, policy change, manual replay — is recorded here and can never be edited."
        tag={<span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" /> Read-only</span>}
      />
      <DataTable columns={columns} data={auditEvents} searchPlaceholder="Search audit log…" onRowClick={setSelected} pageSize={16} />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected?.action}
        description={selected ? `${selected.entityType} · ${selected.entityId}` : ''}
      >
        {selected && (
          <div className="flex flex-col gap-density-md text-sm">
            <Fact label="Actor" value={`${selected.actorName} (${selected.role})`} />
            <Fact label="Timestamp" value={new Date(selected.createdAt).toLocaleString()} />
            <Fact label="Reason" value={selected.reason ?? '—'} />
            <Fact label="Ticket / incident" value={selected.ticketOrIncident ?? '—'} />
            {selected.beforeHash && <Fact label="Before hash" value={<span className="font-mono text-xs">{selected.beforeHash}</span>} />}
            {selected.afterHash && <Fact label="After hash" value={<span className="font-mono text-xs">{selected.afterHash}</span>} />}
          </div>
        )}
      </DetailDrawer>
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
