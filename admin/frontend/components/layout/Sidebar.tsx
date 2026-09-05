import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, Lock, X } from 'lucide-react'
import { cn } from '../../lib/shadcn/utils'
import { NAV_GROUPS } from './navConfig'
import { useNavBadges } from '../../hooks/useNavBadges'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '../../lib/shadcn/tooltip'

function isActive(pathname: string, itemPath: string): boolean {
  if (itemPath === '/') return pathname === '/'
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

export function Sidebar({ mobileOpen = false, onMobileClose }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const badges = useNavBadges()

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const sync = () => {
      if (media.matches) onMobileClose?.()
    }
    sync()
    media.addEventListener?.('change', sync)
    return () => media.removeEventListener?.('change', sync)
  }, [onMobileClose])

  return (
    <TooltipProvider delayDuration={150}>
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-[100dvh] shrink-0 flex-col border-r border-border bg-card shadow-xl transition-[transform,width] duration-200 lg:static lg:z-auto lg:h-screen lg:shadow-none',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          collapsed ? 'lg:w-[68px]' : 'lg:w-[260px]',
          'w-[min(86vw,300px)]'
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 sm:px-density-lg">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background font-bold text-sm">
            Z
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-col leading-none">
              <span className="text-sm font-semibold tracking-tight">ZAHRLY</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Operations Console</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => onMobileClose?.()}
            aria-label="Close navigation"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-density-sm sm:py-density-md">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="mb-density-md">
              {!collapsed && (
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:px-density-md">
                  {group.label}
                </div>
              )}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = !item.locked && isActive(location.pathname, item.path)
                  const badge = item.badgeKey ? badges[item.badgeKey] : undefined

                  const content = (
                    <>
                      <item.icon className={cn(
                        'h-4 w-4 shrink-0',
                        active ? 'text-foreground' : item.locked ? 'text-muted-foreground/60' : 'text-muted-foreground group-hover:text-foreground'
                      )} />
                      {!collapsed && <span className={cn('min-w-0 truncate', item.locked && 'text-muted-foreground/70')}>{item.label}</span>}
                      {!collapsed && item.locked && <Lock className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-label="Locked" />}
                      {!collapsed && !item.locked && !!badge && (
                        <span className="ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                          {badge}
                        </span>
                      )}
                      {collapsed && !!badge && !item.locked && (
                        <span className="absolute ml-5 mt-[-14px] inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-semibold text-destructive-foreground">
                          {badge}
                        </span>
                      )}
                      {collapsed && item.locked && <Lock className="absolute ml-5 mt-5 h-3 w-3 text-muted-foreground/70" aria-label="Locked" />}
                    </>
                  )

                  if (item.locked) {
                    return (
                      <li key={item.path} className="relative">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled
                              aria-disabled="true"
                              className={cn(
                                'group flex w-full cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium opacity-80 sm:px-density-md sm:py-2',
                                collapsed && 'justify-center px-0'
                              )}
                            >
                              {content}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side={collapsed ? 'right' : 'bottom'}>
                            <div className="max-w-xs">{item.lockReason ?? 'Locked — backend not implemented yet.'}</div>
                          </TooltipContent>
                        </Tooltip>
                      </li>
                    )
                  }

                  const link = (
                    <Link
                      to={item.path}
                      onClick={() => onMobileClose?.()}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium transition-colors sm:px-density-md sm:py-2',
                        active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        collapsed && 'justify-center px-0'
                      )}
                    >
                      {content}
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

        <div className="border-t border-border p-2 sm:p-density-sm">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden w-full items-center justify-center gap-2 rounded-md px-density-md py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground lg:flex"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  )
}
