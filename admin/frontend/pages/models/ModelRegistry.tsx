import { useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { PromotionWizard } from '../../components/dialogs/PromotionWizard'
import { Tabs, TabsList, TabsTrigger } from '../../lib/shadcn/tabs'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import { useModelVersions, useActiveModel, useShadowEvaluations, useStoreActions } from '../../state/StoreContext'
import type { ModelVersion } from '../../types/domain'
import { Eye, PlayCircle, CheckCircle2, XCircle } from 'lucide-react'

const TABS = [
  { path: '/models', value: 'registry', label: 'Registry' },
  { path: '/models/active', value: 'active', label: 'Active Model' },
  { path: '/models/candidates', value: 'candidates', label: 'Candidates' },
]

export default function ModelRegistry() {
  const location = useLocation()
  const navigate = useNavigate()
  const active = TABS.find((t) => t.path === location.pathname)?.value ?? 'registry'
  const modelVersions = useModelVersions()
  const activeModel = useActiveModel()
  const shadowEvaluations = useShadowEvaluations()
  const actions = useStoreActions()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [promotionOpen, setPromotionOpen] = useState(false)
  const selected = modelVersions.find((m) => m.id === selectedId) ?? null

  const columns = useMemo<ColumnDef<ModelVersion, any>[]>(() => [
    { accessorKey: 'family', header: 'Family' },
    { accessorKey: 'version', header: 'Version' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'trainingCutoff', header: 'Training cutoff' },
    { accessorKey: 'features', header: 'Features' },
    { id: 'logLoss', header: 'Log Loss', accessorFn: (m) => m.metrics.logLoss, cell: ({ getValue }) => getValue<number>().toFixed(3) },
    { id: 'brier', header: 'Brier', accessorFn: (m) => m.metrics.brier, cell: ({ getValue }) => getValue<number>().toFixed(3) },
    { id: 'ece', header: 'ECE', accessorFn: (m) => m.metrics.ece, cell: ({ getValue }) => getValue<number>().toFixed(3) },
    { id: 'clv', header: 'CLV', accessorFn: (m) => m.metrics.clv, cell: ({ getValue }) => getValue<number>().toFixed(1) },
    { accessorKey: 'calibration', header: 'Calibration', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} tone={getValue<string>() === 'strong' ? 'success' : getValue<string>() === 'moderate' ? 'warning' : 'critical'} dense /> },
    { accessorKey: 'drift', header: 'Drift', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
  ], [])

  const dataForTab = active === 'active'
    ? modelVersions.filter((m) => m.status === 'ACTIVE')
    : active === 'candidates'
      ? modelVersions.filter((m) => m.status === 'CANDIDATE' || m.status === 'SHADOW')
      : modelVersions

  const relatedShadow = selected ? shadowEvaluations.find((s) => s.candidateId === selected.id) : undefined

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Model Registry"
        description="Model promotion is a governance action, not a direct file swap. Rollback and promotion require step-up approval — see Shadow Testing and Rollback."
      />
      <Tabs value={active} onValueChange={(v) => navigate(TABS.find((t) => t.value === v)?.path ?? '/models')}>
        <TabsList>{TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}</TabsList>
      </Tabs>

      <DataTable columns={columns} data={dataForTab} searchPlaceholder="Search models…" onRowClick={(m) => setSelectedId(m.id)} pageSize={12} />

      <DetailDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelectedId(null)}
        title={`${selected?.family} ${selected?.version}`}
        description={selected ? `Training cutoff ${selected.trainingCutoff} · ${selected.features} features` : ''}
        footer={
          selected && (
            <div className="flex flex-wrap justify-end gap-density-sm">
              <Button variant="outline" onClick={() => { actions.reviewCandidate(selected.id); toast.info('Candidate marked reviewed') }}>
                <Eye className="h-4 w-4" /> Review candidate
              </Button>
              {selected.status === 'CANDIDATE' && (
                <Button variant="outline" onClick={() => { actions.startShadow(selected.id); toast.success('Shadow evaluation started') }}>
                  <PlayCircle className="h-4 w-4" /> Start shadow
                </Button>
              )}
              {(selected.status === 'CANDIDATE' || selected.status === 'SHADOW') && (
                <>
                  <Button variant="destructive" onClick={() => setRejectOpen(true)}>
                    <XCircle className="h-4 w-4" /> Reject
                  </Button>
                  <Button onClick={() => setPromotionOpen(true)}>
                    <CheckCircle2 className="h-4 w-4" /> Approve promotion
                  </Button>
                </>
              )}
            </div>
          )
        }
      >
        {selected && (
          <div className="flex flex-col gap-density-lg text-sm">
            <div className="flex items-center gap-density-sm">
              <StatusBadge status={selected.status} />
              {selected.shadowState && <span className="text-xs text-muted-foreground">{selected.shadowState}</span>}
            </div>
            <div className="grid grid-cols-2 gap-density-md">
              <Metric label="Log Loss" value={selected.metrics.logLoss.toFixed(3)} />
              <Metric label="Brier" value={selected.metrics.brier.toFixed(3)} />
              <Metric label="RPS" value={selected.metrics.rps.toFixed(3)} />
              <Metric label="ECE" value={selected.metrics.ece.toFixed(3)} />
              <Metric label="CLV" value={selected.metrics.clv.toFixed(1)} />
              <Metric label="Calibration" value={<StatusBadge status={selected.calibration} tone={selected.calibration === 'strong' ? 'success' : selected.calibration === 'moderate' ? 'warning' : 'critical'} dense />} />
            </div>
            <div>
              <div className="mb-1 text-xs uppercase text-muted-foreground">Created / Promoted</div>
              <div>{new Date(selected.createdAt).toLocaleString()} {selected.promotedAt && `· Promoted ${new Date(selected.promotedAt).toLocaleString()}`}</div>
            </div>
          </div>
        )}
      </DetailDrawer>

      {selected && (
        <ConfirmDialog
          open={rejectOpen}
          onOpenChange={setRejectOpen}
          title={`Reject ${selected.family} ${selected.version}`}
          actionSummary="Marks this candidate as rejected. It will not be eligible for promotion."
          scope={`${selected.family} ${selected.version}`}
          consequences={['Candidate status becomes REJECTED.', 'A new training run is required to reconsider this model family/version.']}
          confirmLabel="Reject candidate"
          onConfirm={(reason) => { actions.rejectModel(selected.id, reason); toast.success('Candidate rejected') }}
        />
      )}
      {selected && (
        <PromotionWizard
          open={promotionOpen}
          onOpenChange={setPromotionOpen}
          candidate={selected}
          incumbent={activeModel}
          shadowEvaluation={relatedShadow}
          onApprove={(reason) => { actions.approvePromotion(selected.id, reason); toast.success(`${selected.family} ${selected.version} promoted to production`) }}
        />
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium text-foreground">{value}</div>
    </div>
  )
}
