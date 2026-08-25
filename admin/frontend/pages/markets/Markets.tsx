import { useMemo, useState, type ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { Tabs, TabsList, TabsTrigger } from '../../lib/shadcn/tabs'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import { useMarkets, useStoreActions } from '../../state/StoreContext'
import { computeProductionGates } from '../../state/actions/marketActions'
import type { Market } from '../../types/domain'
import { Ban, ShieldAlert, Eye, RefreshCcw, FlaskConical, CheckCircle2, XCircle } from 'lucide-react'

const FAMILIES = ['ALL', 'RESULT', 'GOALS', 'CORNERS', 'CARDS', 'PLAYER_PROPS', 'COMBINATIONS'] as const

type PendingAction = 'disable' | 'experimental' | 'abstain' | 'approve' | null

export default function Markets() {
  const markets = useMarkets()
  const marketActions = useStoreActions()
  const [family, setFamily] = useState<(typeof FAMILIES)[number]>('ALL')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const selected = markets.find((m) => m.id === selectedId) ?? null

  const filtered = family === 'ALL' ? markets : markets.filter((m) => m.family === family)

  const columns = useMemo<ColumnDef<Market, any>[]>(() => [
    { accessorKey: 'name', header: 'Market' },
    { accessorKey: 'family', header: 'Family' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'predictionCoveragePct', header: 'Prediction coverage', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" /> },
    { accessorKey: 'calibrationEce', header: 'Calibration (ECE)', cell: ({ getValue }) => getValue<number>().toFixed(3) },
    { accessorKey: 'oosQuality', header: 'OOS quality', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} tone={getValue<string>() === 'strong' ? 'success' : getValue<string>() === 'moderate' ? 'warning' : 'critical'} dense /> },
    { accessorKey: 'providerCoveragePct', header: 'Provider coverage', cell: ({ getValue }) => <ProgressBar value={getValue<number>()} size="sm" tone="info" /> },
    { accessorKey: 'lastRevalidation', header: 'Last revalidation', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleDateString() },
  ], [])

  const gates = selected ? computeProductionGates(selected) : []

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Market Registry"
        description="Markets are never enabled merely because provider data exists. Production requires data gates, semantic verification, consistency tests, and model evidence."
        actions={<Link to="/predictions/consistency" className="text-sm font-medium text-foreground hover:underline">View Consistency Center</Link>}
      />

      <Tabs value={family} onValueChange={(v) => setFamily(v as typeof family)}>
        <TabsList>
          {FAMILIES.map((f) => <TabsTrigger key={f} value={f}>{f === 'ALL' ? 'All families' : f.replace('_', ' ')}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <DataTable columns={columns} data={filtered} searchPlaceholder="Search markets…" onRowClick={(m) => setSelectedId(m.id)} pageSize={12} />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelectedId(null)}
        title={selected?.name}
        description={selected ? `${selected.family} · ${selected.settlementSemantics}` : ''}
        footer={
          selected && (
            <div className="flex flex-wrap justify-end gap-density-sm">
              <Button variant="outline" onClick={() => { marketActions.reviewMarket(selected.id); toast.info('Market marked reviewed') }}>
                <Eye className="h-4 w-4" /> Review
              </Button>
              <Button variant="outline" onClick={() => { marketActions.revalidateSemantics(selected.id); toast.success('Semantics revalidated') }}>
                <RefreshCcw className="h-4 w-4" /> Revalidate semantics
              </Button>
              {selected.status !== 'EXPERIMENTAL' && (
                <Button variant="outline" onClick={() => setPendingAction('experimental')}>
                  <FlaskConical className="h-4 w-4" /> Move to experimental
                </Button>
              )}
              {selected.status !== 'ABSTAIN' && (
                <Button variant="outline" onClick={() => setPendingAction('disable')}>
                  <Ban className="h-4 w-4" /> Disable (fail-closed)
                </Button>
              )}
              {selected.status !== 'PRODUCTION_ENABLED' && (
                <Button onClick={() => setPendingAction('approve')}>
                  <CheckCircle2 className="h-4 w-4" /> Approve production
                </Button>
              )}
            </div>
          )
        }
      >
        {selected && (
          <div className="flex flex-col gap-density-md text-sm">
            <div className="flex items-center gap-density-sm">
              <StatusBadge status={selected.status} />
              <StatusBadge status={selected.oosQuality} tone={selected.oosQuality === 'strong' ? 'success' : selected.oosQuality === 'moderate' ? 'warning' : 'critical'} dense />
            </div>
            <Fact label="Prediction coverage" value={<ProgressBar value={selected.predictionCoveragePct} size="sm" />} />
            <Fact label="Provider coverage" value={<ProgressBar value={selected.providerCoveragePct} size="sm" tone="info" />} />
            <Fact label="Calibration (ECE)" value={selected.calibrationEce.toFixed(3)} />
            <Fact label="Sample size" value={selected.sampleSize.toLocaleString()} />
            <Fact label="Dependency eligible" value={selected.dependencyEligible ? 'Yes — usable in combination markets' : 'No'} />
            <Fact label="Settlement semantics" value={selected.settlementSemantics} />
            <Fact label="Last validation / revalidation" value={`${new Date(selected.lastValidation).toLocaleDateString()} / ${new Date(selected.lastRevalidation).toLocaleDateString()}`} />

            <div>
              <div className="mb-density-sm text-xs uppercase text-muted-foreground">Production approval gates</div>
              <ul className="flex flex-col gap-1.5">
                {gates.map((g) => (
                  <li key={g.label} className="flex items-center gap-2 rounded-md border border-border p-density-sm text-xs">
                    {g.passed ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                    {g.label}
                  </li>
                ))}
              </ul>
            </div>

            {selected.status === 'EXPERIMENTAL' && (
              <div className="flex items-center gap-2 rounded-md border border-warning/30 zc-chip-warning p-density-sm text-xs">
                <ShieldAlert className="h-3.5 w-3.5" /> Experimental — has not cleared all production gates yet.
              </div>
            )}
          </div>
        )}
      </DetailDrawer>

      {selected && (
        <ConfirmDialog
          open={pendingAction === 'disable'}
          onOpenChange={(o) => !o && setPendingAction(null)}
          title={`Disable ${selected.name}`}
          actionSummary="Immediately fail-closes this market to ABSTAIN across all fixtures."
          scope={selected.name}
          consequences={[
            'Market is removed from the recommendation surface immediately.',
            'Existing settled history is not affected.',
            'Requires an audit reason and is recorded in the immutable audit log.',
          ]}
          confirmLabel="Disable market"
          onConfirm={(reason) => { marketActions.moveToAbstain(selected.id, reason); toast.success(`${selected.name} disabled`) }}
        />
      )}
      {selected && (
        <ConfirmDialog
          open={pendingAction === 'experimental'}
          onOpenChange={(o) => !o && setPendingAction(null)}
          title={`Move ${selected.name} to experimental`}
          actionSummary="Downgrades this market to experimental — still visible to admins, hidden from production recommendations."
          scope={selected.name}
          consequences={['Market no longer appears as production-enabled.', 'Can be re-approved for production once gates pass again.']}
          confirmLabel="Move to experimental"
          destructive={false}
          onConfirm={(reason) => { marketActions.moveToExperimental(selected.id, reason); toast.success(`${selected.name} moved to experimental`) }}
        />
      )}
      {selected && (
        <ConfirmDialog
          open={pendingAction === 'approve'}
          onOpenChange={(o) => !o && setPendingAction(null)}
          title={`Approve ${selected.name} for production`}
          actionSummary="Approval only takes effect if every governance gate passes. Failed gates cannot be bypassed."
          scope={selected.name}
          consequences={gates.map((g) => `${g.passed ? 'PASS' : 'FAIL'} — ${g.label}`)}
          confirmLabel="Approve production"
          destructive={false}
          onConfirm={(reason) => {
            const result = marketActions.approveProduction(selected, reason)
            if (result.success) {
              toast.success(`${selected.name} approved for production`)
            } else {
              toast.error('Approval blocked — one or more gates failed', { description: result.gates.filter((g) => !g.passed).map((g) => g.label).join('; ') })
            }
          }}
        />
      )}
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
