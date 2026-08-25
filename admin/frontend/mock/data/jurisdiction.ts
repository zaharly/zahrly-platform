import type { JurisdictionPolicy } from '../../types/domain'

export const JURISDICTION_POLICIES: JurisdictionPolicy[] = [
  { country: 'United Kingdom', geoStatus: 'ALLOWED', ageRequirement: 18, bookmakerAvailability: 'available', affiliateAvailability: 'available', ctaState: 'CTA_ENABLED', rgNotice: true, policyVersion: 'geo-policy-v4.2', lastVerified: '2026-08-20T00:00:00Z' },
  { country: 'Spain', geoStatus: 'ALLOWED', ageRequirement: 18, bookmakerAvailability: 'available', affiliateAvailability: 'available', ctaState: 'CTA_ENABLED', rgNotice: true, policyVersion: 'geo-policy-v4.2', lastVerified: '2026-08-20T00:00:00Z' },
  { country: 'Italy', geoStatus: 'RESTRICTED', ageRequirement: 18, bookmakerAvailability: 'unavailable', affiliateAvailability: 'unavailable', ctaState: 'NO_CTA', rgNotice: true, policyVersion: 'geo-policy-v4.2', lastVerified: '2026-08-18T00:00:00Z' },
  { country: 'Germany', geoStatus: 'ALLOWED', ageRequirement: 18, bookmakerAvailability: 'available', affiliateAvailability: 'available', ctaState: 'CTA_ENABLED', rgNotice: true, policyVersion: 'geo-policy-v4.2', lastVerified: '2026-08-20T00:00:00Z' },
  { country: 'France', geoStatus: 'RESTRICTED', ageRequirement: 18, bookmakerAvailability: 'unavailable', affiliateAvailability: 'available', ctaState: 'NO_CTA', rgNotice: true, policyVersion: 'geo-policy-v4.2', lastVerified: '2026-08-15T00:00:00Z' },
  { country: 'Netherlands', geoStatus: 'BLOCKED', ageRequirement: null, bookmakerAvailability: 'unavailable', affiliateAvailability: 'unavailable', ctaState: 'NO_CTA', rgNotice: false, policyVersion: 'geo-policy-v4.1', lastVerified: '2026-07-30T00:00:00Z' },
  { country: 'Portugal', geoStatus: 'ALLOWED', ageRequirement: 18, bookmakerAvailability: 'available', affiliateAvailability: 'available', ctaState: 'CTA_ENABLED', rgNotice: true, policyVersion: 'geo-policy-v4.2', lastVerified: '2026-08-19T00:00:00Z' },
  { country: 'Brazil', geoStatus: 'ALLOWED', ageRequirement: 18, bookmakerAvailability: 'available', affiliateAvailability: 'available', ctaState: 'CTA_ENABLED', rgNotice: true, policyVersion: 'geo-policy-v4.2', lastVerified: '2026-08-17T00:00:00Z' },
  { country: 'United States', geoStatus: 'UNKNOWN', ageRequirement: null, bookmakerAvailability: 'unavailable', affiliateAvailability: 'unavailable', ctaState: 'NO_CTA', rgNotice: false, policyVersion: 'geo-policy-v4.0', lastVerified: '2026-06-01T00:00:00Z' },
  { country: 'Mexico', geoStatus: 'ALLOWED', ageRequirement: 18, bookmakerAvailability: 'available', affiliateAvailability: 'available', ctaState: 'CTA_ENABLED', rgNotice: true, policyVersion: 'geo-policy-v4.2', lastVerified: '2026-08-16T00:00:00Z' },
]
