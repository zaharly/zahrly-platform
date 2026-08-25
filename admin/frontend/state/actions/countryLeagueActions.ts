import type { SetStore } from '../types'
import { makeAuditEntry } from '../helpers'
import type { CountryStatus, LeagueStatus } from '../../types/domain'

export function createCountryLeagueActions(set: SetStore) {
  function setLeagueStatus(leagueId: string, status: LeagueStatus, action: string, reason: string) {
    set((prev) => {
      const league = prev.leagues.find((l) => l.id === leagueId)
      if (!league) return prev
      const before = league.status
      return {
        ...prev,
        leagues: prev.leagues.map((l) => (l.id === leagueId ? { ...l, status } : l)),
        auditEvents: [
          makeAuditEntry({ action, entityType: 'League', entityId: league.name, reason, before, after: status }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  function setCountryStatus(countryId: string, status: CountryStatus, action: string, reason: string) {
    set((prev) => {
      const country = prev.countries.find((c) => c.id === countryId)
      if (!country) return prev
      const before = country.status
      return {
        ...prev,
        countries: prev.countries.map((c) => (c.id === countryId ? { ...c, status } : c)),
        auditEvents: [
          makeAuditEntry({ action, entityType: 'Country', entityId: country.name, reason, before, after: status }),
          ...prev.auditEvents,
        ],
      }
    })
  }

  return {
    pauseLeague: (leagueId: string, reason: string) => setLeagueStatus(leagueId, 'PAUSED', 'pause_league', reason),
    disableLeague: (leagueId: string, reason: string) => setLeagueStatus(leagueId, 'DISABLED', 'disable_league', reason),
    archiveLeague: (leagueId: string, reason: string) => setLeagueStatus(leagueId, 'ARCHIVED', 'archive_league', reason),
    reEnableLeague: (leagueId: string, reason: string) => setLeagueStatus(leagueId, 'ENABLED', 'enable_league', reason),

    pauseCountry: (countryId: string, reason: string) => setCountryStatus(countryId, 'PAUSED', 'pause_country', reason),
    disableCountry: (countryId: string, reason: string) => setCountryStatus(countryId, 'DISABLED', 'disable_country', reason),
    archiveCountry: (countryId: string, reason: string) => setCountryStatus(countryId, 'ARCHIVED', 'archive_country', reason),
    reEnableCountry: (countryId: string, reason: string) => setCountryStatus(countryId, 'ENABLED', 'enable_country', reason),
  }
}
