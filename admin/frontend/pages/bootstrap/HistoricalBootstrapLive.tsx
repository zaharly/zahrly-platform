import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../lib/shadcn/dialog'
import { toast } from '../../lib/shadcn/sonner'
import type { ColumnDef } from '@tanstack/react-table'
import { RefreshCw, ExternalLink, Database, Plus, AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  fetchArchiveCampaignOptions,
  fetchArchiveLive,
  type ArchiveCampaignLive,
  type ArchiveCampaignOptions,
  type ArchiveSeasonLive,
} from '../../integrations/archiveLive'

const seasonColumns: ColumnDef<ArchiveSeasonLive, any>[] = [
  { accessorKey: 'season', header: 'Season' },
  { accessorKey: 'campaigns', header: 'Campaigns' },
  { accessorKey: 'succeeded', header: 'Succeeded' },
  { accessorKey: 'active', header: 'Active' },
  { accessorKey: 'failed', header: 'Failed' },
  { accessorKey: 'avg_completeness', header: 'Avg completeness', cell: ({ getValue }) => <ProgressBar value={Number(getValue()) * 100} size="sm" /> },
]

const campaignColumns: ColumnDef<ArchiveCampaignLive, any>[] = [
  { accessorKey: 'season', header: 'Season' },
  { accessorKey: 'dataset_type', header: 'Dataset' },
  { accessorKey: 'provider', header: 'Provider' },
  { accessorKey: 'scope_state', header: 'Scope' },
  { accessorKey: 'status', header: 'Campaign', cell: ({ getValue }) => <StatusBadge status={String(getValue())} /> },
  { accessorKey: 'worker_status', header: 'Worker', cell: ({ getValue }) => <StatusBadge status={String(getValue() ?? '—')} dense /> },
  { accessorKey: 'completeness_score', header: 'Completeness', cell: ({ getValue }) => <ProgressBar value={Number(getValue() ?? 0) * 100} size="sm" /> },
  { accessorKey: 'row_count', header: 'Rows', cell: ({ getValue }) => Number(getValue() ?? 0).toLocaleString() },
  { accessorKey: 'manifest_id', header: 'Manifest' },
]

export default function HistoricalBootstrapLive() {
  const [data, setData] = useState<{ campaigns: ArchiveCampaignLive[]; seasons: ArchiveSeasonLive[] } | null>(null)
  const [options, setOptions] = useState<ArchiveCampaignOptions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [selected, setSelected] = useState<ArchiveCampaignLive | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchArchiveLive())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load live archive data')
    } finally {
      setLoading(false)
    }
  }

  async function loadOptions() {
    setOptionsLoading(true)
    try {
      setOptions(await fetchArchiveCampaignOptions())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to load archive request options')
    } finally {
      setOptionsLoading(false)
    }
  }

  useEffect(() => {
    void load()
    void loadOptions()
  }, [])

  const stats = useMemo(() => {
    const campaigns = data?.campaigns ?? []
    const total = campaigns.length
    const succeeded = campaigns.filter((c) => c.status === 'SUCCEEDED').length
    const active = campaigns.filter((c) => ['READY', 'QUEUED', 'RUNNING'].includes(c.status)).length
    const avg = campaigns.length ? campaigns.reduce((sum, c) => sum + Number(c.completeness_score ?? 0), 0) / campaigns.length : 0
    return { total, succeeded, active, avg }
  }, [data])

  return (
    <div className="flex flex-col gap-density-xl">
      <PageHeader
        title="Historical Bootstrap"
        description="Live archive operating path backed by internal.archive_campaigns, internal.worker_jobs, and internal.archive_catalog. Historical data is displayed from Supabase, not mock fixtures."
        tag={<StatusBadge status={loading || optionsLoading ? 'LOADING' : error ? 'DEGRADED' : 'ACTIVE'} />}
        actions={
          <div className="flex items-center gap-density-sm">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Add archive request
            </Button>
            <Button variant="outline" onClick={() => { void load(); void loadOptions() }} disabled={loading || optionsLoading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        }
      />

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}

      <div className="grid grid-cols-2 gap-density-md lg:grid-cols-4">
        <Stat label="Archive campaigns" value={stats.total.toLocaleString()} />
        <Stat label="Succeeded" value={stats.succeeded.toLocaleString()} />
        <Stat label="Active" value={stats.active.toLocaleString()} />
        <Stat label="Avg completeness" value={`${(stats.avg * 100).toFixed(1)}%`} />
      </div>

      <ReadinessPanel options={options} />

      <section>
        <div className="mb-density-md flex items-center gap-density-sm"><Database className="h-4 w-4" /><h2 className="text-base font-semibold">Real season state</h2></div>
        <DataTable columns={seasonColumns} data={data?.seasons ?? []} searchPlaceholder="Search seasons…" pageSize={12} />
      </section>

      <section>
        <h2 className="mb-density-md text-base font-semibold">Real archive campaigns</h2>
        <DataTable columns={campaignColumns} data={data?.campaigns ?? []} searchPlaceholder="Search campaigns…" pageSize={12} onRowClick={setSelected} />
      </section>

      <DetailDrawer
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected ? `Season ${selected.season} · ${selected.dataset_type}` : ''}
        description={selected?.campaign_id}
      >
        {selected && (
          <div className="flex flex-col gap-density-md text-sm">
            <Row label="Campaign status" value={<StatusBadge status={selected.status} />} />
            <Row label="Worker status" value={<StatusBadge status={String(selected.worker_status ?? '—')} />} />
            <Row label="Scope" value={selected.scope_state} />
            <Row label="Provider" value={selected.provider} />
            <Row label="Completeness" value={`${(Number(selected.completeness_score ?? 0) * 100).toFixed(2)}%`} />
            <Row label="Rows" value={Number(selected.row_count ?? 0).toLocaleString()} />
            <Row label="Manifest" value={<span className="font-mono text-xs break-all">{selected.manifest_id ?? '—'}</span>} />
            <Row label="Object URI" value={<span className="font-mono text-xs break-all">{selected.object_uri ?? '—'}</span>} />
            <Row label="Checksum" value={<span className="font-mono text-xs break-all">{selected.checksum ?? '—'}</span>} />
            <Row label="Queue" value={selected.queue_name ?? '—'} />
            <Row label="Attempts" value={String(selected.worker_attempts ?? selected.attempts ?? 0)} />
            <Row label="Created" value={new Date(selected.created_at).toLocaleString()} />
            {selected.object_uri && <a className="inline-flex items-center gap-1 text-sm font-medium hover:underline" href={selected.object_uri} target="_blank" rel="noreferrer">Open object <ExternalLink className="h-3.5 w-3.5" /></a>}
          </div>
        )}
      </DetailDrawer>

      <ArchiveRequestDialog open={createOpen} onOpenChange={setCreateOpen} options={options} />
    </div>
  )
}

function ReadinessPanel({ options }: { options: ArchiveCampaignOptions | null }) {
  const registered = options?.registered_seasons ?? []
  const activeCompetitions = options?.competitions ?? []
  const rules = options?.rules ?? []
  const ready = registered.length > 0 && activeCompetitions.length > 0 && rules.length > 0

  return (
    <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
      <div className="flex items-start justify-between gap-density-md">
        <div>
          <h2 className="text-base font-semibold">Archive request readiness</h2>
          <p className="mt-1 text-sm text-muted-foreground">The dashboard no longer asks for provider or lineage internals. Those values must come from the project’s provider-backed season registration path.</p>
        </div>
        <StatusBadge status={ready ? 'READY' : 'BLOCKED'} />
      </div>

      <div className="mt-density-md grid grid-cols-1 gap-density-sm md:grid-cols-3">
        <ReadinessItem ok={activeCompetitions.length > 0} label="Active competitions" value={String(activeCompetitions.length)} />
        <ReadinessItem ok={registered.length > 0} label="Provider-backed seasons" value={String(registered.length)} />
        <ReadinessItem ok={rules.length > 0} label="Configured archive datasets" value={String(rules.length)} />
      </div>

      {!ready && (
        <div className="mt-density-md flex items-start gap-density-sm rounded-lg border border-warning/40 bg-warning/5 p-density-md text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium text-foreground">Add archive request is intentionally blocked.</div>
            <div className="mt-1">A real provider-backed season must exist before the system can derive the provider, season dates, team scope, schema and completeness metadata required by the archive campaign contract.</div>
          </div>
        </div>
      )}
    </section>
  )
}

function ReadinessItem({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 p-density-md">
      <div>
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="mt-1 text-lg font-semibold">{value}</div>
      </div>
      {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
    </div>
  )
}

function ArchiveRequestDialog({ open, onOpenChange, options }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: ArchiveCampaignOptions | null
}) {
  const [competitionId, setCompetitionId] = useState('')
  const [seasonKey, setSeasonKey] = useState('')
  const [datasetType, setDatasetType] = useState('')

  const registeredSeasons = options?.registered_seasons ?? []
  const competitions = options?.competitions ?? []
  const rules = options?.rules ?? []
  const seasonsForCompetition = useMemo(
    () => registeredSeasons.filter((s) => !competitionId || s.competition_id === competitionId),
    [registeredSeasons, competitionId],
  )
  const selectedRegistration = seasonsForCompetition.find((s) => `${s.competition_id}:${s.season}` === seasonKey)
  const canRequest = false

  useEffect(() => {
    if (!open) {
      setCompetitionId('')
      setSeasonKey('')
      setDatasetType('')
    }
  }, [open])

  useEffect(() => {
    if (!competitionId) {
      if (seasonKey) setSeasonKey('')
      return
    }
    const validSeason = seasonsForCompetition.some((s) => `${s.competition_id}:${s.season}` === seasonKey)
    if (!validSeason) setSeasonKey(seasonsForCompetition[0] ? `${seasonsForCompetition[0].competition_id}:${seasonsForCompetition[0].season}` : '')
  }, [competitionId, seasonKey, seasonsForCompetition])

  useEffect(() => {
    if (!datasetType && rules[0]) setDatasetType(rules[0].dataset_type)
  }, [datasetType, rules])

  const competitionName = competitions.find((c) => c.id === competitionId)?.name ?? '—'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add archive request</DialogTitle>
          <DialogDescription>
            Choose the business scope only. Provider, dates, team scope, schema and completeness are derived by the backend from the registered provider season; they are not user inputs.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-density-md md:grid-cols-2">
          <Field label="Competition">
            <Select value={competitionId} onValueChange={setCompetitionId} disabled={competitions.length === 0}>
              <SelectTrigger><SelectValue placeholder="Select competition" /></SelectTrigger>
              <SelectContent>{competitions.map((competition) => <SelectItem key={competition.id} value={competition.id}>{competition.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>

          <Field label="Season">
            <Select value={seasonKey} onValueChange={setSeasonKey} disabled={seasonsForCompetition.length === 0}>
              <SelectTrigger><SelectValue placeholder="Select registered season" /></SelectTrigger>
              <SelectContent>{seasonsForCompetition.map((season) => <SelectItem key={`${season.competition_id}:${season.season}`} value={`${season.competition_id}:${season.season}`}>{season.season}</SelectItem>)}</SelectContent>
            </Select>
          </Field>

          <div className="md:col-span-2">
            <Field label="Dataset">
              <Select value={datasetType} onValueChange={setDatasetType} disabled={rules.length === 0}>
                <SelectTrigger><SelectValue placeholder="Select archive dataset" /></SelectTrigger>
                <SelectContent>{rules.map((rule) => <SelectItem key={`${rule.dataset_type}:${rule.policy_version}`} value={rule.dataset_type}>{rule.dataset_type}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/20 p-density-md text-sm">
          <div className="font-medium">Selected scope</div>
          <div className="mt-1 text-muted-foreground">{competitionName} · {selectedRegistration?.season ?? '—'} · {datasetType || '—'}</div>
        </div>

        {!selectedRegistration && (
          <div className="flex items-start gap-density-sm rounded-lg border border-warning/40 bg-warning/5 p-density-md text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>No provider-backed season is registered for the selected competition yet. The request cannot be created safely.</div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button disabled={!canRequest} title="Waiting for the provider-backed campaign creation contract to be implemented">
            Create archive request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm"><div className="text-xs font-medium uppercase text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex flex-col gap-1 border-b border-border/60 pb-density-sm"><span className="text-xs uppercase text-muted-foreground">{label}</span><span>{value}</span></div>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1.5"><label className="text-sm font-medium">{label}</label>{children}</div>
}
