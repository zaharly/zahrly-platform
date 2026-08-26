import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Gauge, ServerCrash, Timer } from 'lucide-react'
import { PageHeader } from '../../components/layout/PageHeader'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { ProgressBar } from '../../components/status/ProgressBar'
import { HealthIndicator } from '../../components/status/HealthIndicator'
import { StatusBadge } from '../../components/status/StatusBadge'
import { Tabs, TabsList, TabsTrigger } from '../../lib/shadcn/tabs'
import { fetchProviderSnapshot, type AdminProvider } from '../../lib/adminLive'

const TABS = [
  { path: '/providers', value: 'overview', label: 'Overview' },
  { path: '/providers/api-football', value: 'api-football', label: 'API-Football' },
]

function ProviderCard({ provider }: { provider: AdminProvider }) {
  const quotaMax = provider.daily_budget ?? 0
  return (
    <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{provider.provider}</div>
          <div className="mt-1 text-xs text-muted-foreground">Observed {new Date(provider.observed_at).toLocaleString()}</div>
        </div>
        <HealthIndicator status={provider.status} label={provider.status} size="sm" />
      </div>
      <div className="mt-density-lg">
        <ProgressBar label="Quota used" value={provider.quota_used} max={quotaMax} showValue={false} tone={provider.quota_pct !== null && provider.quota_pct >= 90 ? 'critical' : 'info'} />
        <div className="mt-1 text-xs text-muted-foreground">{provider.quota_used.toLocaleString()} / {quotaMax.toLocaleString()} requests ({provider.quota_pct ?? 0}%)</div>
      </div>
      <div className="mt-density-md grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>Backfill budget: {provider.backfill_budget.toLocaleString()}</span>
        <span>Protected budget: {provider.protected_production_budget.toLocaleString()}</span>
        <span>24h requests: {provider.requests_24h}</span>
        <span>24h failures: {provider.failed_24h}</span>
      </div>
    </div>
  )
}

export default function ProvidersPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const active = TABS.find((tab) => tab.path === location.pathname)?.value ?? 'overview'
  const [providers, setProviders] = useState<AdminProvider[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    fetchProviderSnapshot()
      .then((data) => mounted && setProviders(data.providers))
      .catch((e) => mounted && setError(e instanceof Error ? e.message : 'Unable to load provider telemetry'))
    return () => { mounted = false }
  }, [])

  const apiFootball = useMemo(() => providers.find((p) => p.provider === 'api-football'), [providers])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader title="Provider Operations" description="Live provider telemetry only. Unimplemented provider controls remain locked in the navigation." />
      <Tabs value={active} onValueChange={(value) => navigate(TABS.find((tab) => tab.value === value)?.path ?? '/providers')}>
        <TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="api-football">API-Football</TabsTrigger></TabsList>
      </Tabs>

      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}
      {!error && providers.length === 0 && <div className="rounded-lg border border-border bg-card p-density-lg text-sm text-muted-foreground">No provider telemetry has been recorded yet.</div>}

      {active === 'overview' && (
        <div className="grid gap-density-md lg:grid-cols-2">{providers.map((provider) => <ProviderCard key={provider.provider} provider={provider} />)}</div>
      )}

      {active === 'api-football' && apiFootball && (
        <div className="flex flex-col gap-density-lg">
          <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
            <MetricCard label="Status" value={apiFootball.status} icon={ServerCrash} tone={apiFootball.status === 'healthy' ? 'success' : 'warning'} />
            <MetricCard label="Daily quota" value={apiFootball.daily_budget?.toLocaleString() ?? '—'} icon={Gauge} />
            <MetricCard label="Quota used" value={`${apiFootball.quota_pct ?? 0}%`} icon={Gauge} tone={apiFootball.quota_pct !== null && apiFootball.quota_pct >= 90 ? 'critical' : 'info'} />
            <MetricCard label="Last HTTP status" value={String(apiFootball.last_provider_status ?? '—')} icon={Timer} />
          </div>
          <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
            <div className="flex items-center justify-between">
              <div><h2 className="text-base font-semibold">Operational quota state</h2><p className="text-sm text-muted-foreground">Latest snapshot from the provider quota ledger.</p></div>
              <StatusBadge status={apiFootball.status} dense />
            </div>
            <div className="mt-density-lg grid gap-density-md md:grid-cols-3">
              <div className="rounded-md border border-border p-density-md"><div className="text-xs text-muted-foreground">Backfill budget</div><div className="mt-1 text-lg font-semibold">{apiFootball.backfill_budget.toLocaleString()}</div></div>
              <div className="rounded-md border border-border p-density-md"><div className="text-xs text-muted-foreground">Protected production budget</div><div className="mt-1 text-lg font-semibold">{apiFootball.protected_production_budget.toLocaleString()}</div></div>
              <div className="rounded-md border border-border p-density-md"><div className="text-xs text-muted-foreground">Rate remaining</div><div className="mt-1 text-lg font-semibold">{apiFootball.last_rate_remaining ?? '—'}</div></div>
            </div>
          </div>
        </div>
      )}
      {active === 'api-football' && !apiFootball && !error && <div className="rounded-lg border border-border bg-card p-density-lg text-sm text-muted-foreground">No API-Football snapshot is available.</div>}
    </div>
  )
}
