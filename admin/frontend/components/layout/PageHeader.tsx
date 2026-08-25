import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

interface Crumb {
  label: string
  path?: string
}

interface PageHeaderProps {
  title: string
  description?: ReactNode
  breadcrumbs?: Crumb[]
  actions?: ReactNode
  tag?: ReactNode
}

export function PageHeader({ title, description, breadcrumbs, actions, tag }: PageHeaderProps) {
  return (
    <div className="mb-density-xl flex flex-col gap-density-sm">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {breadcrumbs.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              {crumb.path ? (
                <Link to={crumb.path} className="hover:text-foreground">{crumb.label}</Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-density-md">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-density-sm">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            {tag}
          </div>
          {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-density-sm">{actions}</div>}
      </div>
    </div>
  )
}
