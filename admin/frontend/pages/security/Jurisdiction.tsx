import { useLocation, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { DataTable } from '../../components/tables/DataTable'
import { Tabs, TabsList, TabsTrigger } from '../../lib/shadcn/tabs'
import { JURISDICTION_POLICIES } from '../../mock/data/jurisdiction'
import type { JurisdictionPolicy } from '../../types/domain'
import { HeartHandshake, ShieldAlert } from 'lucide-react'

const TABS = [
  { path: '/security/jurisdiction', value: 'geo', label: 'Geo Policy' },
  { path: '/security/responsible-gambling', value: 'rg', label: 'Responsible Gambling' },
]

export default function Jurisdiction() {
  const location = useLocation()
  const navigate = useNavigate()
  const active = TABS.find((t) => t.path === location.pathname)?.value ?? 'geo'

  const columns = useMemo<ColumnDef<JurisdictionPolicy, any>[]>(() => [
    { accessorKey: 'country', header: 'Country' },
    { accessorKey: 'geoStatus', header: 'Geo status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: 'ageRequirement', header: 'Age requirement', cell: ({ getValue }) => { const v = getValue<number | null>(); return v ? `${v}+` : '—' } },
    { accessorKey: 'bookmakerAvailability', header: 'Bookmaker', cell: ({ getValue }) => <StatusBadge status={getValue<string>() === 'available' ? 'ENABLED' : 'DISABLED'} dense /> },
    { accessorKey: 'affiliateAvailability', header: 'Affiliate', cell: ({ getValue }) => <StatusBadge status={getValue<string>() === 'available' ? 'ENABLED' : 'DISABLED'} dense /> },
    { accessorKey: 'ctaState', header: 'CTA state', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} tone={getValue<string>() === 'CTA_ENABLED' ? 'success' : 'critical'} dense /> },
    { accessorKey: 'policyVersion', header: 'Policy version' },
    { accessorKey: 'lastVerified', header: 'Last verified', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleDateString() },
  ], [])

  const unknownCount = JURISDICTION_POLICIES.filter((p) => p.geoStatus === 'UNKNOWN').length

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Jurisdiction / Geo Policy"
        description="Country-level geo, age, bookmaker/affiliate availability, and CTA state. An UNKNOWN geo status always resolves visually to NO_CTA — never a best-effort default."
      />
      <Tabs value={active} onValueChange={(v) => navigate(TABS.find((t) => t.value === v)?.path ?? '/security/jurisdiction')}>
        <TabsList>{TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}</TabsList>
      </Tabs>

      {active === 'geo' && (
        <>
          {unknownCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-warning/30 zc-chip-warning p-density-md text-sm">
              <ShieldAlert className="h-4 w-4" /> {unknownCount} jurisdiction(s) have UNKNOWN geo status and are fail-closed to NO_CTA.
            </div>
          )}
          <DataTable columns={columns} data={JURISDICTION_POLICIES} searchPlaceholder="Search jurisdictions…" pageSize={12} />
        </>
      )}

      {active === 'rg' && (
        <div className="flex flex-col gap-density-md">
          <div className="flex items-center gap-2 rounded-md border border-border bg-card p-density-lg shadow-retool-sm text-sm">
            <HeartHandshake className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="font-medium text-foreground">Responsible gambling notices</div>
              <div className="text-muted-foreground">Notices are shown wherever CTA is enabled and are governed by the same jurisdiction policy version.</div>
            </div>
          </div>
          <DataTable
            columns={[
              { accessorKey: 'country', header: 'Country' },
              { accessorKey: 'rgNotice', header: 'RG notice shown', cell: ({ getValue }) => <StatusBadge status={getValue<boolean>() ? 'ENABLED' : 'DISABLED'} dense /> },
              { accessorKey: 'ctaState', header: 'CTA state', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
              { accessorKey: 'policyVersion', header: 'Policy version' },
            ] as ColumnDef<JurisdictionPolicy, any>[]}
            data={JURISDICTION_POLICIES}
            searchPlaceholder="Search responsible gambling policy…"
            pageSize={12}
          />
        </div>
      )}
    </div>
  )
}
