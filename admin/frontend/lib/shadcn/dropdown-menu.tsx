import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Circle } from 'lucide-react'
import { cn } from './utils'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal
export const DropdownMenuGroup = DropdownMenuPrimitive.Group
export const DropdownMenuSub = DropdownMenuPrimitive.Sub
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 4, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn('z-50 min-w-40 overflow-hidden rounded-md border border-border bg-background p-1 text-foreground shadow-md outline-none', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
})

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(function DropdownMenuItem({ className, inset, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }, ref) {
  return <DropdownMenuPrimitive.Item ref={ref} data-inset={inset || undefined} className={cn('relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-muted focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', inset && 'pl-8', className)} {...props} />
})

export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(function DropdownMenuLabel({ className, inset, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }, ref) {
  return <DropdownMenuPrimitive.Label ref={ref} data-inset={inset || undefined} className={cn('px-2 py-1.5 text-xs font-semibold', inset && 'pl-8', className)} {...props} />
})

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return <DropdownMenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
})

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, children, checked, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.CheckboxItem ref={ref} className={cn('relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)} checked={checked} {...props}>
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"><DropdownMenuPrimitive.ItemIndicator><Check className="h-4 w-4" /></DropdownMenuPrimitive.ItemIndicator></span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
})

export const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.RadioItem ref={ref} className={cn('relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)} {...props}>
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"><DropdownMenuPrimitive.ItemIndicator><Circle className="h-2 w-2 fill-current" /></DropdownMenuPrimitive.ItemIndicator></span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
})

export const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(function DropdownMenuSubTrigger({ className, children, inset, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }, ref) {
  return <DropdownMenuPrimitive.SubTrigger ref={ref} data-inset={inset || undefined} className={cn('flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-muted data-[state=open]:bg-muted', inset && 'pl-8', className)} {...props}>{children}<ChevronRight className="ml-auto h-4 w-4" /></DropdownMenuPrimitive.SubTrigger>
})

export const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(function DropdownMenuSubContent({ className, ...props }, ref) {
  return <DropdownMenuPrimitive.SubContent ref={ref} className={cn('z-50 min-w-32 overflow-hidden rounded-md border border-border bg-background p-1 text-foreground shadow-md', className)} {...props} />
})
