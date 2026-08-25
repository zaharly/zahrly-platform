import { SlidersHorizontal, ShieldCheck, ShieldOff } from 'lucide-react'

const scopes = [
  { label: 'Countries', total: 171, enabled: 0, description: 'Country-level ingestion gate.' },
  { label: 'Leagues', total: 1241, enabled: 0, description: 'League-level ingestion gate.' },
]

export default function IngestionControls() {
  return (
    <div className="space-y-density-xl">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <SlidersHorizontal className="h-4 w-4" /> Ingestion Controls
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">What Zahrly is allowed to ingest</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Controls are independent from the provider catalog. A catalog entry can exist without being enabled for ingestion.
        </p>
      </div>

      <div className="grid gap-density-md md:grid-cols-2">
        {scopes.map((scope) => (
          <div key={scope.label} className="rounded-lg border border-border bg-card p-density-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">{scope.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{scope.description}</div>
              </div>
              <div className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                {scope.enabled} / {scope.total} enabled
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3 rounded-md bg-muted/40 p-3">
              <ShieldOff className="h-4 w-4 text-muted-foreground" />
              <div className="text-xs text-muted-foreground">Default state is disabled until an administrator enables a scope.</div>
            </div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-border bg-card p-density-lg">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4" /> Rule used by season campaigns
        </div>
        <div className="mt-3 rounded-md border border-border bg-muted/20 p-4 font-mono text-xs">
          season = X AND country_enabled = true AND league_enabled = true
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          No campaign should create a backfill job outside this gate.
        </p>
      </section>
    </div>
  )
}
