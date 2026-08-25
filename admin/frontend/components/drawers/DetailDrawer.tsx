import type { ReactNode } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../../lib/shadcn/sheet'
import { ScrollArea } from '../../lib/shadcn/scroll-area'

interface DetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  widthClassName?: string
}

/** Right-side contextual drawer used for quick investigation across entities. */
export function DetailDrawer({ open, onOpenChange, title, description, children, footer, widthClassName }: DetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={widthClassName ?? 'w-full max-w-xl sm:max-w-xl'}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <ScrollArea className="mt-density-lg h-[calc(100vh-9rem)] pr-density-md">
          <div className="flex flex-col gap-density-lg pb-density-xl">{children}</div>
        </ScrollArea>
        {footer && <div className="border-t border-border pt-density-md">{footer}</div>}
      </SheetContent>
    </Sheet>
  )
}
