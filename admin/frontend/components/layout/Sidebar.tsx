import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '../../lib/shadcn/utils'
import { NAV_GROUPS } from './navConfig'
import { useNavBadges } from '../../hooks/useNavBadges'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '../../lib/shadcn/tooltip'

function isActive(pathname: string, itemPath: string): boolean {
  if (itemPath === '/') return pathname === '/'
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const badges = useNavBadges()

  return (
    <TooltipProvider delayDuration={150}>
      <aside
        className={cn(
          'flex h-screen shrink-0 flex-col border-r border-border bg-card transition-all duration-200',
          collapsed ? 'w-[68px]' : 'w-[260px]'
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-density-lg">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background font-bold text-sm">
            Z
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-none">
              <span className="text-sm font-semibold tracking-tight">ZAHRLY</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Operations Console</span>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-density-sm py-density-md">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="mb-density-md">
              {!collapsed && (
                <div className="px-density-md pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
              )}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = isActive(location.pathname, item.path)
                  const badge = item.badgeKey ? badges[item.badgeKey] : undefined
                  const link = (
                    <Link
                      to={item.path}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-density-md py-2 text-sm font-medium transition-colors',
                        active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        collapsed && 'justify-center px-0'
                      )}
                    >
                      <item.icon className={cn('h-4 w-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {!collapsed && !!badge && (
                        <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                          {badge}
                        </span>
                      )}
                      {collapsed && !!badge && (
                        <span className="absolute ml-5 mt-[-14px] inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-semibold text-destructive-foreground">
                          {badge}
                        </span>
                      )}
                    </Link>
                  )
                  return (
                    <li key={item.path} className="relative">
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side="right">{item.label}{badge ? ` (${badge})` : ''}</TooltipContent>
                        </Tooltip>
                      ) : link}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-density-sm">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex w-full items-center justify-center gap-2 rounded-md px-density-md py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  )
}
