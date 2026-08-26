import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShieldCheck, ShieldOff, SlidersHorizontal } from 'lucide-react'
import { PageHeader } from '../../components/layout/PageHeader'
import { Button } from '../../lib/shadcn/button'
import { fetchIngestionControlSnapshot, setCompetitionIngestionEnabled, setCountryIngestionEnabled, type IngestionControlSnapshot } from '../../lib/adminLive'

export default function IngestionControls() {
  const [snapshot, setSnapshot] = useState<IngestionControlSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = () => {
    setError(null)
    fetchIngestionControlSnapshot().then(setSnapshot).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load ingestion controls'))
  }

  useEffect(load, [])

  const countries = useMemo(() => (snapshot?.countries ?? []).filter((row) => row.name.toLowerCase().includes(query.toLowerCase())).slice(0, 50), [snapshot, query])
  const competitions = useMemo(() => (snapshot?.competitions ?? []).filter((row) => row.name.toLowerCase().includes(query.toLowerCase())).slice(0, 50), [snapshot, query])
  const enabledCountries = snapshot?.countries.filter((row) => row.enabled).length ?? 0
  const enabledCompetitions = snapshot?.competitions.filter((row) => row.enabled).length ?? 0

  const toggleCountry = async (row: IngestionControlSnapshot['countries'][number]) => {
    if (!row.catalog_country_id) return
    setBusy(`country:${row.id}`)
    try {
      await setCountryIngestionEnabled(row.catalog_country_id, !row.enabled, row.priority, row.notes)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update country ingestion control')
    } finally {
      setBusy(null)
    }
  }

  const toggleCompetition = async (row: IngestionControlSnapshot['competitions'][number]) => {
    if (!row.catalog_competition_id) return
    setBusy(`competition:${row.id}`)
    try {
      await setCompetitionIngestionEnabled(row.catalog_competition_id, !row.enabled, row.priority, row.notes)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update competition ingestion control')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-density-xl">
      <PageHeader title="Ingestion Controls" description="Live provider-scope controls. These switches call the canonical admin RPCs and do not write tables directly from the browser." />
      <div className="flex flex-col gap-density-sm md:flex-row md:items-center md:justify-between">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter countries or leagues…" className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none" />
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
      </div>
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-density-md text-sm text-destructive">{error}</div>}
      {snapshot && (
        <>
          <div className="grid gap-density-md md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-density-lg"><div className="flex items-center justify-between"><span className="text-sm font-semibold">Countries</span><span className="text-sm">{enabledCountries} / {snapshot.countries.length} enabled</span></div><p className="mt-1 text-xs text-muted-foreground">Country-level ingestion gate.</p></div>
            <div className="rounded-lg border border-border bg-card p-density-lg"><div className="flex items-center justify-between"><span className="text-sm font-semibold">Leagues</span><span className="text-sm">{enabledCompetitions} / {snapshot.competitions.length} enabled</span></div><p className="mt-1 text-xs text-muted-foreground">League-level ingestion gate. Country dependency is enforced by the backend contract.</p></div>
          </div>

          <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
            <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /><h2 className="text-sm font-semibold">Country controls</h2></div>
            <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-3 py-2">Country</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Ingestion</th></tr></thead><tbody>{countries.map((row) => (<tr key={row.id} className="border-b border-border/60"><td className="px-3 py-2">{row.name}</td><td className="px-3 py-2 text-muted-foreground">{row.code ?? '—'}</td><td className="px-3 py-2 text-muted-foreground">{row.status}</td><td className="px-3 py-2 text-right"><button disabled={busy === `country:${row.id}`} onClick={() => toggleCountry(row)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">{row.enabled ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}{row.enabled ? 'Enabled' : 'Disabled'}</button></td></tr>))}</tbody></table></div>
          </section>

          <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
            <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /><h2 className="text-sm font-semibold">League controls</h2></div>
            <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-3 py-2">League</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Ingestion</th></tr></thead><tbody>{competitions.map((row) => (<tr key={row.id} className="border-b border-border/60"><td className="px-3 py-2">{row.name}</td><td className="px-3 py-2 text-muted-foreground">{row.status}</td><td className="px-3 py-2 text-right"><button disabled={busy === `competition:${row.id}`} onClick={() => toggleCompetition(row)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">{row.enabled ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}{row.enabled ? 'Enabled' : 'Disabled'}</button></td></tr>))}</tbody></table></div>
          </section>

          <section className="rounded-lg border border-border bg-card p-density-lg">
            <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" /> Campaign gate</div>
            <div className="mt-3 rounded-md border border-border bg-muted/20 p-4 font-mono text-xs">season = X AND country_enabled = true AND league_enabled = true</div>
          </section>
        </>
      )}
    </div>
  )
}
