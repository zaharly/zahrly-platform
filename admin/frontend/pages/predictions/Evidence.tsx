import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { Timeline } from '../../components/timeline/Timeline'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { useEvidenceEvents, useFixtures } from '../../state/StoreContext'
import { fixtureLabel } from '../../mock/data/fixtures'

const ALL = '__all__'

export default function Evidence() {
  const navigate = useNavigate()
  const evidenceEvents = useEvidenceEvents()
  const fixtures = useFixtures()
  const [impactFilter, setImpactFilter] = useState(ALL)

  const fixtureById = useMemo(() => new Map(fixtures.map((f) => [f.id, f])), [fixtures])

  const sorted = useMemo(
    () => [...evidenceEvents]
      .filter((e) => impactFilter === ALL || e.confidenceImpact === impactFilter)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 60),
    [evidenceEvents, impactFilter]
  )

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Evidence Updates"
        description="Global, append-only feed of evidence events across all fixtures. Evidence adjusts the current probability — it never modifies the immutable baseline."
        actions={
          <Select value={impactFilter} onValueChange={setImpactFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Confidence impact" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All confidence impacts</SelectItem>
              <SelectItem value="high">High impact</SelectItem>
              <SelectItem value="medium">Medium impact</SelectItem>
              <SelectItem value="low">Low impact</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <Timeline
          items={sorted.map((e) => {
            const fixture = fixtureById.get(e.fixtureId)
            return {
              id: e.id,
              timestamp: e.timestamp,
              tone: e.confidenceImpact === 'high' ? 'warning' : e.confidenceImpact === 'medium' ? 'info' : 'neutral',
              title: (
                <button className="text-left hover:underline" onClick={() => navigate(`/data/fixtures/${e.fixtureId}`)}>
                  {fixture ? fixtureLabel(fixture) : e.fixtureId} — {e.label}
                </button>
              ),
              description: `${e.source} · ${e.previousProbability}% → ${e.newProbability}% (${e.delta >= 0 ? '+' : ''}${e.delta})`,
              meta: (
                <span className="inline-flex items-center gap-2">
                  <StatusBadge status={e.confidenceImpact} tone={e.confidenceImpact === 'high' ? 'warning' : e.confidenceImpact === 'medium' ? 'info' : 'muted'} dense />
                  Model {e.modelVersion} · {e.snapshotHash}
                </span>
              ),
            }
          })}
        />
      </div>
    </div>
  )
}
