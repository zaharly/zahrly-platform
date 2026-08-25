import { useState } from 'react'
import { Search, Bell, Siren, ChevronDown, Settings, LogOut, UserCircle, KeyRound, Menu } from 'lucide-react'
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

export function Topbar({ onOpenNavigation }: { onOpenNavigation?: () => void }) {
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
    <header className="sticky top-0 z-30 flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:gap-density-md sm:px-4 lg:px-density-lg">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onOpenNavigation?.()}
        aria-label="Open navigation"
        className="shrink-0 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <button
        onClick={() => setPaletteOpen(true)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:border-foreground/30 sm:max-w-sm sm:px-density-md"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Search fixtures, models, providers…</span>
        <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline-flex">⌘K</kbd>
      </button>

      <div className="hidden items-center gap-density-md xl:flex">
        <Badge variant="outline" className="gap-1.5 border-border font-mono text-[11px] font-medium text-muted-foreground">
          production
        </Badge>
        <HealthIndicator
          status={systemHealthy ? 'healthy' : 'critical'}
          label={systemHealthy ? 'All systems operational' : `${criticalIncidents.length} critical incident${criticalIncidents.length === 1 ? '' : 's'}`}
          pulse
        />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-density-sm">
        <Button variant="outline" size="sm" onClick={() => navigate('/incidents')} className="hidden gap-1.5 md:inline-flex">
          <Siren className="h-4 w-4 text-destructive" />
          {openIncidents.length} <span className="hidden lg:inline">incident{openIncidents.length === 1 ? '' : 's'}</span>
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
          <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))]">
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
            <Button variant="ghost" size="icon" className="sm:h-9 sm:w-auto sm:gap-2 sm:pl-2 sm:pr-2.5">
              <UserCircle className="h-5 w-5 text-muted-foreground" />
              <span className="hidden text-sm font-medium sm:inline">{displayName}</span>
              <Badge variant="secondary" className="hidden text-[10px] md:inline-flex">SUPER_ADMIN</Badge>
              <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:inline" />
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
