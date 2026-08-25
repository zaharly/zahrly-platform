import { useLocation, useNavigate } from 'react-router-dom'
import { useMemo, useState, type ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { PolicyBadge } from '../../components/status/PolicyBadge'
import { DataTable } from '../../components/tables/DataTable'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { Switch } from '../../lib/shadcn/switch'
import { Button } from '../../lib/shadcn/button'
import { Textarea } from '../../lib/shadcn/textarea'
import { Label } from '../../lib/shadcn/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import { Tabs, TabsList, TabsTrigger } from '../../lib/shadcn/tabs'
import { toast } from '../../lib/shadcn/sonner'
import { usePolicySettings, usePolicyDrafts, useFeatureFlags, useStoreActions } from '../../state/StoreContext'
import type { PolicySetting, FeatureFlag, PolicyDraft } from '../../types/domain'
import { BookOpen, Cloud, ExternalLink, FilePlus, Eye, CheckCircle2, Rocket } from 'lucide-react'

const TABS = [
  { path: '/settings', value: 'policies', label: 'System Settings' },
  { path: '/settings/feature-flags', value: 'flags', label: 'Feature Flags' },
  { path: '/settings/environment', value: 'environment', label: 'Environment' },
  { path: '/settings/docs', value: 'docs', label: 'Documentation / Runbooks' },
]

export default function SettingsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const active = TABS.find((t) => t.path === location.pathname)?.value ?? 'policies'
  const policySettings = usePolicySettings()
  const policyDrafts = usePolicyDrafts()
  const featureFlags = useFeatureFlags()
  const actions = useStoreActions()

  const [flagTarget, setFlagTarget] = useState<FeatureFlag | null>(null)
  const [draftTarget, setDraftTarget] = useState<PolicySetting | null>(null)

  const policyColumns = useMemo<ColumnDef<PolicySetting, any>[]>(() => [
    { accessorKey: 'category', header: 'Category' },
    { accessorKey: 'name', header: 'Setting' },
    { accessorKey: 'value', header: 'Current value' },
    { accessorKey: 'policyVersion', header: 'Policy version', cell: ({ getValue }) => <PolicyBadge version={getValue<string>()} /> },
    { accessorKey: 'changedBy', header: 'Changed by' },
    { accessorKey: 'effectiveAt', header: 'Effective', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleDateString() },
    {
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => (
        <Button variant="outline" size="sm" onClick={() => setDraftTarget(row.original)}>
          <FilePlus className="h-3.5 w-3.5" /> Create draft
        </Button>
      ),
    },
  ], [])

  const draftColumns = useMemo<ColumnDef<PolicyDraft, any>[]>(() => [
    { accessorKey: 'policyName', header: 'Policy' },
    { accessorKey: 'proposedValue', header: 'Proposed value' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'createdBy', header: 'Created by' },
    { accessorKey: 'approvedBy', header: 'Approved by', cell: ({ getValue }) => getValue<string | null>() ?? '—' },
    {
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => {
        const draft = row.original
        return (
          <div className="flex items-center gap-1">
            {draft.status === 'DRAFT' && (
              <Button variant="ghost" size="sm" onClick={() => { actions.reviewPolicyDraft(draft.id); toast.info('Draft marked in review') }}>
                <Eye className="h-3.5 w-3.5" /> Review
              </Button>
            )}
            {draft.status === 'IN_REVIEW' && (
              <Button variant="ghost" size="sm" onClick={() => { actions.approvePolicyDraft(draft.id, 'Current Operator'); toast.success('Draft approved') }}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Approve
              </Button>
            )}
            {draft.status === 'APPROVED' && (
              <Button variant="outline" size="sm" onClick={() => { actions.activatePolicyDraft(draft.id); toast.success('Policy activated', { description: draft.policyName }) }}>
                <Rocket className="h-3.5 w-3.5" /> Activate
              </Button>
            )}
          </div>
        )
      },
    },
  ], [actions])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="System Settings"
        description="Controlled configuration surface. Every setting shows its current value, governing policy version, and who changed it — never raw implementation secrets."
      />
      <Tabs value={active} onValueChange={(v) => navigate(TABS.find((t) => t.value === v)?.path ?? '/settings')}>
        <TabsList className="flex-wrap h-auto">{TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}</TabsList>
      </Tabs>

      {active === 'policies' && (
        <>
          <DataTable columns={policyColumns} data={policySettings} searchPlaceholder="Search policy settings…" pageSize={14} />
          {policyDrafts.length > 0 && (
            <div>
              <h2 className="mb-density-sm text-base font-semibold text-foreground">Policy drafts</h2>
              <p className="mb-density-sm text-sm text-muted-foreground">Drafts never overwrite the active policy directly — they must be reviewed, approved, and explicitly activated.</p>
              <DataTable columns={draftColumns} data={policyDrafts} searchPlaceholder="Search drafts…" pageSize={10} />
            </div>
          )}
        </>
      )}

      {active === 'flags' && (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card shadow-retool-sm">
          {featureFlags.map((flag) => (
            <div key={flag.id} className="flex items-center justify-between gap-density-md p-density-lg">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-density-sm">
                  <span className="font-medium text-foreground">{flag.name}</span>
                  <StatusBadge status={flag.environment} tone="info" dense />
                </div>
                <span className="text-sm text-muted-foreground">{flag.description}</span>
                <span className="text-xs text-muted-foreground">Last changed by {flag.changedBy} · {new Date(flag.lastChanged).toLocaleDateString()}</span>
              </div>
              <Switch checked={flag.enabled} onCheckedChange={() => setFlagTarget(flag)} />
            </div>
          ))}
        </div>
      )}

      {active === 'environment' && (
        <div className="grid grid-cols-1 gap-density-md sm:grid-cols-2">
          <EnvCard label="Active environment" value="production" icon={<Cloud className="h-4 w-4" />} />
          <EnvCard label="Read-model version" value="prediction_read_models schema v7" icon={<Cloud className="h-4 w-4" />} />
          <EnvCard label="Cache layer" value="Redis — cache-only, never source of truth" icon={<Cloud className="h-4 w-4" />} />
          <EnvCard label="Source of truth" value="Supabase / Postgres" icon={<Cloud className="h-4 w-4" />} />
        </div>
      )}

      {active === 'docs' && (
        <div className="flex flex-col gap-density-sm">
          {[
            { title: 'Operator golden path', desc: 'Command Center → P0/P1 alerts → rolling forecast → provider health → queue age/DLQ → blocked leagues → prediction coverage → model/drift → close incidents.' },
            { title: 'DLQ runbook', desc: 'Inspect → classify (transient/data/provider/code) → retry if retryable → replay creates new lineage → close only after downstream consistency passes.' },
            { title: 'League re-enable runbook', desc: 'Review archive diff → confirm missing/invalidated scope → queue gap-only backfill → resume rolling production.' },
            { title: 'Model promotion runbook', desc: 'All gates must pass → authorized approval → second approval for family changes → cache invalidation on promote.' },
            { title: 'Rollback runbook', desc: 'Step-up authentication → reason required → audit trail → cache invalidation → previous safe model restored.' },
          ].map((doc) => (
            <div key={doc.title} className="flex items-start gap-density-sm rounded-md border border-border bg-card p-density-md shadow-retool-sm">
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">{doc.title} <ExternalLink className="h-3 w-3 text-muted-foreground" /></div>
                <div className="text-sm text-muted-foreground">{doc.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!flagTarget}
        onOpenChange={(o) => !o && setFlagTarget(null)}
        title={`${flagTarget?.enabled ? 'Disable' : 'Enable'} "${flagTarget?.name}"`}
        actionSummary={`Changes this feature flag for the ${flagTarget?.environment} environment.`}
        scope={flagTarget?.name ?? ''}
        consequences={['Takes effect on next config read (typically within the cache TTL window).', 'Recorded in the audit log with the operator and timestamp.']}
        destructive={false}
        confirmLabel="Confirm change"
        onConfirm={(reason) => {
          if (flagTarget) actions.toggleFeatureFlag(flagTarget.id, reason)
          toast.success(`${flagTarget?.name} updated`)
        }}
      />

      <CreateDraftDialog
        policy={draftTarget}
        onOpenChange={(o) => !o && setDraftTarget(null)}
        onCreate={(value) => { if (draftTarget) actions.createPolicyDraft(draftTarget.id, value, 'Current Operator'); toast.success('Policy draft created') }}
      />
    </div>
  )
}

function CreateDraftDialog({ policy, onOpenChange, onCreate }: {
  policy: PolicySetting | null; onOpenChange: (o: boolean) => void; onCreate: (value: string) => void
}) {
  const [value, setValue] = useState(policy?.value ?? '')
  return (
    <Dialog open={!!policy} onOpenChange={(o) => { onOpenChange(o); if (o && policy) setValue(policy.value) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create draft — {policy?.name}</DialogTitle>
          <DialogDescription>Proposes a new value for review. The active policy is never overwritten directly.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>Proposed value</Label>
          <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!value.trim()} onClick={() => { onCreate(value); onOpenChange(false) }}>Create draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EnvCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="flex items-start gap-density-sm rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
      </div>
    </div>
  )
}
