import { Database, Globe2, Trophy, Layers3 } from 'lucide-react'

const stats = [
  { label: 'Countries', value: '171', icon: Globe2, tone: 'Provider master catalog' },
  { label: 'Leagues', value: '1,241', icon: Trophy, tone: 'Provider master catalog' },
  { label: 'Season records', value: '8,669', icon: Layers3, tone: 'Metadata only — not a backfill' },
]

export default function ProviderCatalog() {
  return (
    <div className="space-y-density-xl">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Database className="h-4 w-4" /> Provider Catalog
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">API-Football master catalog</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          This page describes what the provider offers. It never decides what Zahrly should ingest.
          Countries, leagues, and season coverage are synchronized independently from backfill campaigns.
        </p>
      </div>

      <div className="grid gap-density-md md:grid-cols-3">
        {stats.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="rounded-lg border border-border bg-card p-density-lg">
            <div className="flex items-center justify-between">
              <Icon className="h-5 w-5 text-muted-foreground" />
              <span className="text-2xl font-semibold">{value}</span>
            </div>
            <div className="mt-4 text-sm font-medium">{label}</div>
            <div className="mt-1 text-xs text-muted-foreground">{tone}</div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-border bg-card p-density-lg">
        <h2 className="text-sm font-semibold">Separation of responsibilities</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border p-4">
            <div className="text-sm font-medium">Catalog</div>
            <p className="mt-1 text-xs text-muted-foreground">What API-Football knows and exposes.</p>
          </div>
          <div className="rounded-md border border-border p-4">
            <div className="text-sm font-medium">Ingestion Controls</div>
            <p className="mt-1 text-xs text-muted-foreground">What Zahrly chooses to ingest.</p>
          </div>
          <div className="rounded-md border border-border p-4">
            <div className="text-sm font-medium">Season Campaigns</div>
            <p className="mt-1 text-xs text-muted-foreground">Which season to ingest from the enabled scope.</p>
          </div>
        </div>
      </section>
    </div>
  )
}
