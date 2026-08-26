import { useEffect, useState } from 'react'
import { Database, Globe2, Layers3, RefreshCw, Trophy } from 'lucide-react'
import { PageHeader } from '../../components/layout/PageHeader'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { Button } from '../../lib/shadcn/button'
import { fetchProviderCatalogSnapshot, type ProviderCatalogSnapshot } from '../../lib/adminLive'

export default function ProviderCatalog() {
  const [snapshot, setSnapshot] = useState<ProviderCatalogSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setError(null)
    fetchProviderCatalogSnapshot().then(setSnapshot).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load provider catalog'))
  }

  useEffect(load, [])

  return (
    <div className="space-y-density-xl">
      <PageHeader title="Provider Catalog" description="Live API-Football catalog metadata. Catalog data describes provider availability; it does not decide Zahrly ingestion scope." />
      <div className="flex justify-end"><Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button></div>
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}
      {snapshot && (
        <>
          <div className="grid gap-density-md md:grid-cols-3">
            <MetricCard label="Countries" value={snapshot.countries.toLocaleString()} icon={Globe2} tone="info" />
            <MetricCard label="Leagues" value={snapshot.competitions.toLocaleString()} icon={Trophy} tone="info" />
            <MetricCard label="Season records" value={snapshot.seasons.toLocaleString()} icon={Layers3} tone="info" />
          </div>
          <div className="grid gap-density-md md:grid-cols-2">
            <MetricCard label="Current season rows" value={snapshot.current_seasons.toLocaleString()} icon={Database} />
            <MetricCard label="Available season rows" value={snapshot.available_seasons.toLocaleString()} icon={Database} />
          </div>
          <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
            <h2 className="text-sm font-semibold">Synchronization state</h2>
            <p className="mt-1 text-xs text-muted-foreground">Read-only status from the provider catalog sync ledger.</p>
            <pre className="mt-4 max-h-72 overflow-auto rounded-md border border-border bg-muted/20 p-4 text-xs">{JSON.stringify(snapshot.sync_state, null, 2)}</pre>
          </section>
        </>
      )}
    </div>
  )
}
