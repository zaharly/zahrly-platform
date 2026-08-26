import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { NAV_GROUPS } from './navConfig'

export function AdminRouteAvailabilityGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const match = NAV_GROUPS
    .flatMap((group) => group.items)
    .filter((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]

  if (match?.locked) return <Navigate to="/" replace />
  return <>{children}</>
}
