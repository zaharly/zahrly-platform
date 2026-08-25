import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Timeline } from '../../components/timeline/Timeline'
import { useIncidents } from '../../state/StoreContext'
import type { Incident } from '../../types/domain'

export default function ProviderIncidents() {
  const incidents = useIncidents()
  const [selected, setSelected] = useState<Incident | null>(null)
  const providerIncidents = incidents.filter((i) => i.category === 'Provider')

  const columns = useMemo<ColumnDef<Incident, any>[]>(() => [
    { accessorKey: 'id', header: 'ID' },
    { accessorKey: 'severity', header: 'Severity', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} tone={getValue<string>() === 'P0' || getValue<string>() === 'P1' ? 'critical' : 'warning'} dense /> },
    { accessorKey: 'title', header: 'Title' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'owner', header: 'Owner' },
    { accessorKey: 'updatedAt', header: 'Updated', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString() },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Provider Incidents"
        description="Quota, schema, outage, and correction workflows scoped to provider incidents. See Provider Schema Changes for fingerprint-level drift detail."
      />
      <DataTable columns={columns} data={providerIncidents} searchPlaceholder="Search provider incidents…" onRowClick={setSelected} />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected?.title}
        description={selected ? `${selected.id} · ${selected.severity} · Owner ${selected.owner}` : ''}
      >
        {selected && (
          <div className="flex flex-col gap-density-lg">
            <div className="flex items-center gap-density-sm">
              <StatusBadge status={selected.status} />
              <StatusBadge status={selected.severity} tone={selected.severity === 'P0' || selected.severity === 'P1' ? 'critical' : 'warning'} />
            </div>
            <div>
              <div className="mb-1 text-xs uppercase text-muted-foreground">Impact</div>
              <p className="text-sm text-foreground">{selected.impact}</p>
            </div>
            <div>
              <div className="mb-1 text-xs uppercase text-muted-foreground">Affected entities</div>
              <div className="flex flex-wrap gap-1.5">
                {selected.affectedEntities.map((e) => (
                  <span key={e} className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">{e}</span>
                ))}
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
    </div>
  )
}
