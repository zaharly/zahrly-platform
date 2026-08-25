import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { ProgressBar } from '../../components/status/ProgressBar'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { Button } from '../../lib/shadcn/button'
import { Input } from '../../lib/shadcn/input'
import { Label } from '../../lib/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../lib/shadcn/dialog'
import { toast } from '../../lib/shadcn/sonner'
import type { ColumnDef } from '@tanstack/react-table'
import { RefreshCw, ExternalLink, Database, Plus } from 'lucide-react'
import {
  createArchiveCampaign,
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
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ArchiveCampaignLive | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [options, setOptions] = useState<ArchiveCampaignOptions | null>(null)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [creating, setCreating] = useState(false)

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

  async function openCreate() {
    setCreateOpen(true)
    if (options) return
    setOptionsLoading(true)
    try {
      setOptions(await fetchArchiveCampaignOptions())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to load archive campaign options')
    } finally {
      setOptionsLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

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
        tag={<StatusBadge status={loading ? 'LOADING' : error ? 'DEGRADED' : 'ACTIVE'} />}
        actions={
          <div className="flex items-center gap-density-sm">
            <Button onClick={() => void openCreate()}><Plus className="h-4 w-4" /> Add campaign</Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>
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

      <CreateCampaignDialog
        open={createOpen}
        options={options}
        loading={optionsLoading}
        creating={creating}
        onOpenChange={setCreateOpen}
        onCreate={async (input) => {
          setCreating(true)
          try {
            const created = await createArchiveCampaign(input)
            toast.success(`Archive campaign queued · ${created.campaign_id}`)
            setCreateOpen(false)
            await load()
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Unable to create archive campaign')
          } finally {
            setCreating(false)
          }
        }}
      />
    </div>
  )
}

function CreateCampaignDialog({
  open,
  options,
  loading,
  creating,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  options: ArchiveCampaignOptions | null
  loading: boolean
  creating: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: {
    country_id: string
    competition_id: string
    season: number
    dataset_type: string
    provider: string
    date_start: string
    date_end: string
    team_set_hash: string
    schema_version: string
    completeness_score: number
    completeness_policy_version: string
    auto_queue: boolean
  }) => Promise<void>
}) {
  const firstRule = options?.rules[0]
  const [countryId, setCountryId] = useState('')
  const [competitionId, setCompetitionId] = useState('')
  const [season, setSeason] = useState('2026')
  const [datasetType, setDatasetType] = useState('')
  const [provider, setProvider] = useState('e2e-provider')
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [teamSetHash, setTeamSetHash] = useState('')
  const [schemaVersion, setSchemaVersion] = useState('e2e-schema-v1')
  const [completenessPct, setCompletenessPct] = useState('99')

  useEffect(() => {
    if (!options) return
    if (!countryId && options.countries[0]) setCountryId(options.countries[0].id)
    if (!datasetType && firstRule) setDatasetType(firstRule.dataset_type)
  }, [options, countryId, datasetType, firstRule])

  useEffect(() => {
    if (!countryId) return
    if (!options?.competitions.some((c) => c.id === competitionId && c.country_id === countryId)) {
      setCompetitionId(options?.competitions.find((c) => c.country_id === countryId)?.id ?? '')
    }
  }, [countryId, competitionId, options])

  const rulesForDataset = options?.rules.filter((rule) => rule.dataset_type === datasetType) ?? []
  const rule = rulesForDataset[0]
  const competitions = options?.competitions.filter((c) => c.country_id === countryId) ?? []
  const completenessValue = Number(completenessPct) / 100
  const valid = Boolean(
    countryId && competitionId && season && datasetType && provider && dateStart && dateEnd && teamSetHash.trim() && schemaVersion.trim()
      && completenessValue >= Number(rule?.required_threshold ?? 1),
  )

  function reset() {
    setCountryId('')
    setCompetitionId('')
    setSeason('2026')
    setDatasetType('')
    setProvider('e2e-provider')
    setDateStart('')
    setDateEnd('')
    setTeamSetHash('')
    setSchemaVersion('e2e-schema-v1')
    setCompletenessPct('99')
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { onOpenChange(value); if (!value) reset() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add historical archive campaign</DialogTitle>
          <DialogDescription>
            Creates a real ARCHIVE_ONLY campaign in Supabase and immediately calls the project’s official dispatch_archive_campaign transition. No mock job is created.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-density-md md:grid-cols-2">
          <Field label="Country">
            <Select value={countryId} onValueChange={setCountryId} disabled={loading || creating}>
              <SelectTrigger><SelectValue placeholder={loading ? 'Loading countries…' : 'Select country'} /></SelectTrigger>
              <SelectContent>{options?.countries.map((country) => <SelectItem key={country.id} value={country.id}>{country.name} ({country.code})</SelectItem>)}</SelectContent>
            </Select>
          </Field>

          <Field label="Competition">
            <Select value={competitionId} onValueChange={setCompetitionId} disabled={loading || creating || !countryId}>
              <SelectTrigger><SelectValue placeholder="Select competition" /></SelectTrigger>
              <SelectContent>{competitions.map((competition) => <SelectItem key={competition.id} value={competition.id}>{competition.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>

          <Field label="Season" hint="The worker archives this exact season scope.">
            <Input type="number" min="1900" max="2100" value={season} onChange={(e) => setSeason(e.target.value)} disabled={creating} />
          </Field>

          <Field label="Dataset type">
            <Select value={datasetType} onValueChange={setDatasetType} disabled={loading || creating}>
              <SelectTrigger><SelectValue placeholder="Select configured dataset" /></SelectTrigger>
              <SelectContent>{options?.rules.map((ruleOption) => <SelectItem key={`${ruleOption.dataset_type}:${ruleOption.policy_version}`} value={ruleOption.dataset_type}>{ruleOption.dataset_type}</SelectItem>)}</SelectContent>
            </Select>
          </Field>

          <Field label="Provider" hint="The current archive worker materializer supports e2e-provider only until the real provider adapter is implemented.">
            <Input value={provider} onChange={(e) => setProvider(e.target.value)} disabled={creating} />
          </Field>

          <Field label="Schema version">
            <Input value={schemaVersion} onChange={(e) => setSchemaVersion(e.target.value)} disabled={creating} />
          </Field>

          <Field label="Date start">
            <Input type="datetime-local" value={dateStart} onChange={(e) => setDateStart(e.target.value)} disabled={creating} />
          </Field>

          <Field label="Date end">
            <Input type="datetime-local" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} disabled={creating} />
          </Field>

          <Field label="Team set hash" hint="Required artifact identity field. Do not invent a hash; use the project's actual team-set identity for the scope.">
            <Input value={teamSetHash} onChange={(e) => setTeamSetHash(e.target.value)} disabled={creating} placeholder="e.g. team-set-hash-v1" />
          </Field>

          <Field label="Completeness score (%)" hint={rule ? `Required threshold: ${(Number(rule.required_threshold) * 100).toFixed(1)}% · Policy: ${rule.policy_version}` : 'No configured policy'}>
            <Input type="number" min="0" max="100" step="0.01" value={completenessPct} onChange={(e) => setCompletenessPct(e.target.value)} disabled={creating} />
          </Field>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-density-md text-sm text-muted-foreground">
          <strong className="text-foreground">Execution:</strong> Create campaign → ARCHIVE_ONLY + READY → official dispatch → archive_campaign worker queue. The dashboard does not perform any manual state transition.
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>Cancel</Button>
          <Button
            disabled={!valid || creating || loading}
            onClick={() => onCreate({
              country_id: countryId,
              competition_id: competitionId,
              season: Number(season),
              dataset_type: datasetType,
              provider,
              date_start: new Date(dateStart).toISOString(),
              date_end: new Date(dateEnd).toISOString(),
              team_set_hash: teamSetHash.trim(),
              schema_version: schemaVersion.trim(),
              completeness_score: completenessValue,
              completeness_policy_version: rule?.policy_version ?? '',
              auto_queue: true,
            })}
          >
            {creating ? 'Creating & queueing…' : 'Create & queue campaign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm"><div className="text-xs font-medium uppercase text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex flex-col gap-1 border-b border-border/60 pb-density-sm"><span className="text-xs uppercase text-muted-foreground">{label}</span><span>{value}</span></div>
}
