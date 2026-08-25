import { useState } from 'react'
import { Search, Bell, Siren, ChevronDown, Settings, LogOut, UserCircle, KeyRound } from 'lucide-react'
import { Button } from '../../lib/shadcn/button'
import { Badge } from '../../lib/shadcn/badge'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../lib/shadcn/dropdown-menu'
import { HealthIndicator } from '../status/HealthIndicator'
import { CommandPalette } from './CommandPalette'
import { ALERTS } from '../../mock/data/alerts'
import { INCIDENTS } from '../../mock/data/incidents'
import { useNavigate } from 'react-router-dom'
import { useCurrentUser } from '../../hooks/useCurrentUser'

export function Topbar() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const navigate = useNavigate()
  const { user } = useCurrentUser()

  const openIncidents = INCIDENTS.filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING')
  const criticalIncidents = openIncidents.filter((i) => i.severity === 'P0' || i.severity === 'P1')
  const recentAlerts = ALERTS.slice(0, 6)

  const systemHealthy = criticalIncidents.length === 0
  const displayName = user?.fullName ?? 'Operator'
  const displayEmail = user?.email ?? 'operator@zahrly.io'

  return (
    <header className="flex h-14 shrink-0 items-center gap-density-md border-b border-border bg-card px-density-lg">
      <button
        onClick={() => setPaletteOpen(true)}
        className="flex w-full max-w-sm items-center gap-2 rounded-md border border-input bg-background px-density-md py-2 text-sm text-muted-foreground transition-colors hover:border-foreground/30"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search fixtures, models, providers…</span>
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
      </button>

      <div className="ml-density-md hidden items-center gap-density-md lg:flex">
        <Badge variant="outline" className="gap-1.5 border-border font-mono text-[11px] font-medium text-muted-foreground">
          production
        </Badge>
        <HealthIndicator
          status={systemHealthy ? 'healthy' : 'critical'}
          label={systemHealthy ? 'All systems operational' : `${criticalIncidents.length} critical incident${criticalIncidents.length === 1 ? '' : 's'}`}
          pulse
        />
      </div>

      <div className="ml-auto flex items-center gap-density-sm">
        <Button variant="outline" size="sm" onClick={() => navigate('/incidents')} className="gap-1.5">
          <Siren className="h-4 w-4 text-destructive" />
          {openIncidents.length} incident{openIncidents.length === 1 ? '' : 's'}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="h-4 w-4" />
              {recentAlerts.length > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-96">
            <DropdownMenuLabel>Live operational alerts</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {recentAlerts.map((alert) => (
              <DropdownMenuItem key={alert.id} onSelect={() => navigate(alert.linkTo)} className="flex flex-col items-start gap-0.5 whitespace-normal">
                <span className="text-sm font-medium text-foreground">{alert.title}</span>
                <span className="text-xs text-muted-foreground">{alert.message}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 pl-2 pr-2.5">
              <UserCircle className="h-5 w-5 text-muted-foreground" />
              <span className="hidden text-sm font-medium sm:inline">{displayName}</span>
              <Badge variant="secondary" className="hidden text-[10px] md:inline-flex">SUPER_ADMIN</Badge>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{displayEmail}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/security/roles')}>
              <KeyRound className="h-4 w-4" /> Roles & permissions
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate('/settings')}>
              <Settings className="h-4 w-4" /> System settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <LogOut className="h-4 w-4" /> Sign out (managed by org SSO)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  )
}
