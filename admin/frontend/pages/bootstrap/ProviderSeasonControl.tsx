import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, RefreshCw, Send } from 'lucide-react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { Button } from '../../lib/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { toast } from '../../lib/shadcn/sonner'
import { fetchArchiveCampaignOptions, triggerProviderSeason, type ArchiveCampaignOptions } from '../../integrations/archiveLive'

const START_SEASON = 2008
const END_SEASON = 2026
const candidateSeasons = Array.from({ length: END_SEASON - START_SEASON + 1 }, (_, index) => START_SEASON + index)

export default function ProviderSeasonControl() {
  const [season, setSeason] = useState('2008')
  const [options, setOptions] = useState<ArchiveCampaignOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [lastAccepted, setLastAccepted] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    try {
      setOptions(await fetchArchiveCampaignOptions())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load provider season state')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const registered = useMemo(() => {
    const rows = options?.registered_seasons ?? []
    return rows.filter((row) => row.provider === 'api-football')
  }, [options])

  const selectedRegistrations = registered.filter((row) => row.season === Number(season))
  const selectedSeasonRegistered = selectedRegistrations.length > 0

  async function registerSelectedSeason() {
    const selected = Number(season)
    setTriggering(true)
    try {
      await triggerProviderSeason(selected)
      setLastAccepted(selected)
      toast.success(`Season ${selected} registration accepted`)
      setTimeout(() => void load(), 2500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to trigger season registration')
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="flex flex-col gap-density-xl">
      <PageHeader
        title="Historical Bootstrap"
        description="Select exactly one season. The backend then asks API-Football for that season's leagues, checks coverage, and registers only verified Zahrly competitions."
        tag={<StatusBadge status={loading ? 'LOADING' : 'ACTIVE'} />}
        actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="flex items-start gap-density-md">
          <Database className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1">
            <h2 className="text-base font-semibold">Register one real API-Football season</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This action is season-first. Do not choose a provider, league ID, dates, team hash, schema, or completeness values here.
              API-Football determines the leagues and coverage for the selected season.
            </p>

            <div className="mt-density-lg grid grid-cols-1 gap-density-md md:grid-cols-[minmax(0,320px)_auto] md:items-end">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Season</label>
                <Select value={season} onValueChange={setSeason}>
                  <SelectTrigger><SelectValue placeholder="Select season" /></SelectTrigger>
                  <SelectContent>
                    {candidateSeasons.map((value) => <SelectItem key={value} value={String(value)}>{value}/{value + 1}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={() => void registerSelectedSeason()} disabled={triggering || loading}>
                <Send className="h-4 w-4" /> {triggering ? 'Sending…' : `Register ${season}`}
              </Button>
            </div>

            <div className="mt-density-lg rounded-lg border border-border/60 bg-muted/20 p-density-md text-sm">
              <div className="font-medium">Current database state for {season}</div>
              {selectedSeasonRegistered ? (
                <div className="mt-2 flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> {selectedRegistrations.length} verified competition-season registration(s)</div>
              ) : (
                <div className="mt-2 flex items-center gap-2 text-muted-foreground"><AlertTriangle className="h-4 w-4" /> Not registered yet</div>
              )}
              {lastAccepted === Number(season) && <div className="mt-2 text-xs text-muted-foreground">Workflow accepted. Refresh after the provider worker completes to see registrations.</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
        <div className="flex items-center justify-between gap-density-md">
          <div>
            <h2 className="text-base font-semibold">Registered provider seasons</h2>
            <p className="mt-1 text-sm text-muted-foreground">These rows come from Supabase provider_capabilities, not mock fixtures.</p>
          </div>
          <span className="text-sm text-muted-foreground">{registered.length} registrations</span>
        </div>

        <div className="mt-density-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="px-3 py-2">Season</th><th className="px-3 py-2">Competition</th><th className="px-3 py-2">Endpoint</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Checked</th></tr></thead>
            <tbody>
              {registered.slice().sort((a, b) => b.season - a.season || a.competition_id.localeCompare(b.competition_id)).map((row) => (
                <tr key={`${row.competition_id}:${row.season}:${row.endpoint}`} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{row.season}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.competition_id}</td>
                  <td className="px-3 py-2">{row.endpoint}</td>
                  <td className="px-3 py-2"><StatusBadge status={row.status} dense /></td>
                  <td className="px-3 py-2 text-muted-foreground">{row.checked_at ? new Date(row.checked_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {!registered.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">No API-Football seasons have been registered yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
