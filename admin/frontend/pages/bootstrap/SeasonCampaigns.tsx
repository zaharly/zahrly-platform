import { CalendarRange, CircleDashed, GitBranch } from 'lucide-react'

const seasons = Array.from({ length: 18 }, (_, i) => 2009 + i)

export default function SeasonCampaigns() {
  return (
    <div className="space-y-density-xl">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <CalendarRange className="h-4 w-4" /> Season Campaigns
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Historical ingestion campaigns</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Campaigns are created one season at a time. The campaign does not define the catalog; it only selects a season from the already synchronized catalog.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-density-lg">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <GitBranch className="h-4 w-4" /> Campaign contract
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border p-3 text-xs">1. Pick one season</div>
          <div className="rounded-md border border-border p-3 text-xs">2. Filter enabled scope</div>
          <div className="rounded-md border border-border p-3 text-xs">3. Create fixture jobs</div>
          <div className="rounded-md border border-border p-3 text-xs">4. Validate before S3</div>
        </div>
      </section>

      <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
        {seasons.map((season) => (
          <div key={season} className="rounded-md border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{season}</span>
              <CircleDashed className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">Not scheduled</div>
          </div>
        ))}
      </div>
    </div>
  )
}
