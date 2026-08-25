import type { Fixture, HealthState, MarketState, PredictionState } from '../../types/domain'
import { LEAGUES } from './leagues'
import { TEAM_NAMES } from '../factories/names'
import { makeRng, pick, pickMany, range, clamp, round, uid } from '../factories/rng'

const rng = makeRng(20260823)

const PICKS = ['Home Win', 'Away Win', 'Draw', 'Over 2.5', 'Under 2.5', 'BTTS Yes']

function buildFixturesForLeague(leagueId: string, count: number, offsetStart: number): Fixture[] {
  const league = LEAGUES.find((l) => l.id === leagueId)
  if (!league) return []
  const teams = TEAM_NAMES[leagueId] ?? ['Home FC', 'Away FC']
  const out: Fixture[] = []
  for (let i = 0; i < count; i++) {
    const [home, away] = pickMany(rng, teams, 2)
    const dayOffset = offsetStart + i * (10 / Math.max(count, 1)) - 3
    const kickoffMinutes = Math.round(dayOffset * 24 * 60 + range(rng, -120, 120))
    const isPast = kickoffMinutes < 0
    const leagueEnabled = league.status === 'ENABLED'
    const leaguePaused = league.status === 'PAUSED'
    const leagueDisabled = league.status === 'DISABLED'

    let predictionState: PredictionState = 'COMPLETED'
    let marketState: MarketState = 'PRODUCTION_ENABLED'
    let dataReadinessPct = round(range(rng, 92, 100))
    let oddsReadinessPct = round(range(rng, 88, 100))
    let providerStatus: HealthState = 'healthy'
    let baselineStatus: 'LOCKED' | 'PENDING' = 'LOCKED'

    if (leagueDisabled) {
      predictionState = 'ABSTAINED'
      marketState = 'ABSTAIN'
      dataReadinessPct = round(range(rng, 20, 45))
      oddsReadinessPct = 0
      providerStatus = 'offline'
      baselineStatus = 'PENDING'
    } else if (leaguePaused) {
      predictionState = isPast ? 'COMPLETED' : 'PENDING'
      marketState = 'ABSTAIN'
      dataReadinessPct = round(range(rng, 45, 70))
      oddsReadinessPct = round(range(rng, 30, 60))
      providerStatus = 'degraded'
      baselineStatus = isPast ? 'LOCKED' : 'PENDING'
    } else if (!isPast) {
      const roll = rng()
      if (roll < 0.08) {
        predictionState = 'FAILED'
        marketState = 'ABSTAIN'
        dataReadinessPct = round(range(rng, 40, 65))
        providerStatus = 'degraded'
      } else if (roll < 0.2) {
        predictionState = 'PROCESSING'
        marketState = 'PREDICTED_ONLY'
        baselineStatus = 'PENDING'
      } else if (roll < 0.3) {
        predictionState = 'PENDING'
        marketState = 'PREDICTED_ONLY'
        baselineStatus = 'PENDING'
        dataReadinessPct = round(range(rng, 55, 85))
      } else {
        marketState = rng() < 0.85 ? 'PRODUCTION_ENABLED' : 'RECOMMENDABLE'
      }
    }

    const baselineProbability = round(range(rng, 42, 78))
    const drift = leagueEnabled ? range(rng, -6, 6) : range(rng, -2, 2)
    const currentProbability = clamp(round(baselineProbability + drift), 5, 96)

    const n = out.length + 1
    out.push({
      id: uid(`FX-${leagueId.slice(0, 3).toUpperCase()}`, n),
      kickoff: new Date(Date.now() + kickoffMinutes * 60_000).toISOString(),
      countryId: league.countryId,
      countryName: league.countryName,
      leagueId: league.id,
      leagueName: league.name,
      homeTeam: home ?? 'Home FC',
      awayTeam: away ?? 'Away FC',
      episodeId: uid('EP', n),
      predictionState,
      marketState,
      dataReadinessPct: clamp(dataReadinessPct, 0, 100),
      oddsReadinessPct: clamp(oddsReadinessPct, 0, 100),
      providerStatus,
      baselineStatus,
      baselinePick: pick(rng, PICKS),
      baselineProbability,
      currentProbability,
      modelVersion: rng() < 0.85 ? 'v1.8.3' : 'v1.8.2',
      hasIncident: rng() < 0.1,
      isPast,
    })
  }
  return out
}

export const FIXTURES: Fixture[] = [
  ...buildFixturesForLeague('premier-league', 8, 0),
  ...buildFixturesForLeague('championship', 6, 0.3),
  ...buildFixturesForLeague('la-liga', 7, 0.1),
  ...buildFixturesForLeague('segunda-division', 3, 0.5),
  ...buildFixturesForLeague('serie-a', 6, 0.2),
  ...buildFixturesForLeague('bundesliga', 6, 0.4),
  ...buildFixturesForLeague('ligue-1', 5, 0.6),
  ...buildFixturesForLeague('eredivisie', 2, 0.7),
  ...buildFixturesForLeague('primeira-liga', 4, 0.15),
  ...buildFixturesForLeague('brasileirao', 5, 0.35),
  ...buildFixturesForLeague('liga-mx', 3, 0.55),
].sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime())

export function getFixtureById(id: string): Fixture | undefined {
  return FIXTURES.find((f) => f.id === id)
}

export function fixtureLabel(f: Fixture): string {
  return `${f.homeTeam} vs ${f.awayTeam}`
}
