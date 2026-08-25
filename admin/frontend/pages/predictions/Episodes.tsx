import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { DataTable } from '../../components/tables/DataTable'
import { fixtureLabel } from '../../mock/data/fixtures'
import { useFixtures, useEvidenceEvents } from '../../state/StoreContext'

interface EpisodeRow {
  episodeId: string
  fixtureId: string
  fixtureLabel: string
  leagueName: string
  kickoff: string
  baselineStatus: 'LOCKED' | 'PENDING'
  lockedAt: string | null
  eventCount: number
  predictionState: string
}

export default function Episodes() {
  const navigate = useNavigate()
  const fixtures = useFixtures()
  const allEvidence = useEvidenceEvents()
  const evidenceByFixture = useMemo(() => {
    const map = new Map<string, typeof allEvidence>()
    for (const e of allEvidence) {
      const list = map.get(e.fixtureId) ?? []
      list.push(e)
      map.set(e.fixtureId, list)
    }
    for (const list of map.values()) list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    return map
  }, [allEvidence])

  const rows: EpisodeRow[] = useMemo(() => fixtures.map((f) => {
    const events = evidenceByFixture.get(f.id) ?? []
    return {
      episodeId: f.episodeId,
      fixtureId: f.id,
      fixtureLabel: fixtureLabel(f),
      leagueName: f.leagueName,
      kickoff: f.kickoff,
      baselineStatus: f.baselineStatus,
      lockedAt: events[0]?.timestamp ?? null,
      eventCount: events.length,
      predictionState: f.predictionState,
    }
  }), [fixtures, evidenceByFixture])

  const columns = useMemo<ColumnDef<EpisodeRow, any>[]>(() => [
    { accessorKey: 'episodeId', header: 'Episode' },
    { accessorKey: 'fixtureLabel', header: 'Fixture' },
    { accessorKey: 'leagueName', header: 'League' },
    { accessorKey: 'kickoff', header: 'Kickoff', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString() },
    { accessorKey: 'baselineStatus', header: 'Baseline', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'lockedAt', header: 'Locked at', cell: ({ getValue }) => { const v = getValue<string | null>(); return v ? new Date(v).toLocaleString() : '—' } },
    { accessorKey: 'eventCount', header: 'Lifecycle events' },
    { accessorKey: 'predictionState', header: 'Current state', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Prediction Episodes"
        description="Each fixture episode captures the baseline/evidence/lock/postponement/cancellation timeline. A postponed fixture creates a new episode when the material-change rule is met — the previous baseline remains immutable."
      />
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search episodes…"
        onRowClick={(r) => navigate(`/data/fixtures/${r.fixtureId}`)}
        pageSize={14}
      />
    </div>
  )
}
