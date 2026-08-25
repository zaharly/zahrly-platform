import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from '../../lib/shadcn/command'
import { CalendarDays, Activity, Boxes, Server, Siren, ListOrdered, Archive as ArchiveIcon, Layers } from 'lucide-react'
import { FIXTURES, fixtureLabel } from '../../mock/data/fixtures'
import { PREDICTIONS } from '../../mock/data/predictions'
import { MODEL_VERSIONS } from '../../mock/data/models'
import { PROVIDERS } from '../../mock/data/providers'
import { INCIDENTS } from '../../mock/data/incidents'
import { JOBS } from '../../mock/data/jobs'
import { ARCHIVE_SEASON_SUMMARY } from '../../mock/data/archive'
import { MARKETS } from '../../mock/data/markets'
import { StatusBadge } from '../status/StatusBadge'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onOpenChange])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = <T,>(text: string, item: T) => (q.length === 0 || text.toLowerCase().includes(q)) ? item : null

    return {
      fixtures: FIXTURES.map((f) => matches(`${fixtureLabel(f)} ${f.leagueName}`, f)).filter(Boolean).slice(0, 5) as typeof FIXTURES,
      predictions: PREDICTIONS.map((p) => matches(`${p.fixtureLabel} ${p.id}`, p)).filter(Boolean).slice(0, 5) as typeof PREDICTIONS,
      models: MODEL_VERSIONS.map((m) => matches(`${m.family} ${m.version}`, m)).filter(Boolean).slice(0, 5) as typeof MODEL_VERSIONS,
      providers: PROVIDERS.map((p) => matches(p.name, p)).filter(Boolean).slice(0, 5) as typeof PROVIDERS,
      incidents: INCIDENTS.map((i) => matches(`${i.title} ${i.id}`, i)).filter(Boolean).slice(0, 5) as typeof INCIDENTS,
      jobs: JOBS.map((j) => matches(`${j.id} ${j.queue} ${j.payloadSummary}`, j)).filter(Boolean).slice(0, 5) as typeof JOBS,
      archive: ARCHIVE_SEASON_SUMMARY.map((a) => matches(`archive ${a.season}`, a)).filter(Boolean).slice(0, 5) as typeof ARCHIVE_SEASON_SUMMARY,
      markets: MARKETS.map((m) => matches(m.name, m)).filter(Boolean).slice(0, 5) as typeof MARKETS,
    }
  }, [query])

  function go(path: string) {
    onOpenChange(false)
    setQuery('')
    navigate(path)
  }

  const hasAny = Object.values(results).some((arr) => arr.length > 0)

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search fixtures, predictions, models, providers, incidents, jobs…" value={query} onValueChange={setQuery} />
      <CommandList>
        {!hasAny && <CommandEmpty>No results found.</CommandEmpty>}
        {results.fixtures.length > 0 && (
          <CommandGroup heading="Fixtures">
            {results.fixtures.map((f) => (
              <CommandItem key={f.id} onSelect={() => go(`/data/fixtures/${f.id}`)}>
                <CalendarDays className="text-muted-foreground" />
                <span>{fixtureLabel(f)}</span>
                <span className="ml-2 text-xs text-muted-foreground">{f.leagueName}</span>
                <StatusBadge status={f.predictionState} dense className="ml-auto" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.predictions.length > 0 && (
          <CommandGroup heading="Predictions">
            {results.predictions.map((p) => (
              <CommandItem key={p.id} onSelect={() => go(`/predictions/${p.id}`)}>
                <Activity className="text-muted-foreground" />
                <span>{p.fixtureLabel}</span>
                <StatusBadge status={p.recommendationState} dense className="ml-auto" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.models.length > 0 && (
          <CommandGroup heading="Models">
            {results.models.map((m) => (
              <CommandItem key={m.id} onSelect={() => go('/models')}>
                <Boxes className="text-muted-foreground" />
                <span>{m.family} {m.version}</span>
                <StatusBadge status={m.status} dense className="ml-auto" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.providers.length > 0 && (
          <CommandGroup heading="Providers">
            {results.providers.map((p) => (
              <CommandItem key={p.id} onSelect={() => go(`/providers/${p.id === 'oddshub' ? 'odds' : p.id}`)}>
                <Server className="text-muted-foreground" />
                <span>{p.name}</span>
                <StatusBadge status={p.status} dense className="ml-auto" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.incidents.length > 0 && (
          <CommandGroup heading="Incidents">
            {results.incidents.map((i) => (
              <CommandItem key={i.id} onSelect={() => go('/incidents')}>
                <Siren className="text-muted-foreground" />
                <span>{i.title}</span>
                <StatusBadge status={i.severity} dense className="ml-auto" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.jobs.length > 0 && (
          <CommandGroup heading="Jobs">
            {results.jobs.map((j) => (
              <CommandItem key={j.id} onSelect={() => go('/workers/dlq')}>
                <ListOrdered className="text-muted-foreground" />
                <span>{j.id}</span>
                <span className="ml-2 text-xs text-muted-foreground">{j.queue}</span>
                <StatusBadge status={j.status} dense className="ml-auto" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.markets.length > 0 && (
          <CommandGroup heading="Markets">
            {results.markets.map((m) => (
              <CommandItem key={m.id} onSelect={() => go('/markets')}>
                <Layers className="text-muted-foreground" />
                <span>{m.name}</span>
                <StatusBadge status={m.status} dense className="ml-auto" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.archive.length > 0 && (
          <CommandGroup heading="Archive">
            {results.archive.map((a) => (
              <CommandItem key={a.season} onSelect={() => go('/data/archive')}>
                <ArchiveIcon className="text-muted-foreground" />
                <span>Season {a.season}</span>
                <StatusBadge status={a.status} dense className="ml-auto" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center justify-end border-t border-border px-density-md py-density-sm">
        <CommandShortcut>⌘K to toggle</CommandShortcut>
      </div>
    </CommandDialog>
  )
}
