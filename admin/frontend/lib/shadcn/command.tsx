import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { cn } from './utils'
import { Dialog, DialogContent } from './dialog'

export const Command = React.forwardRef<React.ElementRef<typeof CommandPrimitive>, React.ComponentPropsWithoutRef<typeof CommandPrimitive>>(function Command({ className, ...props }, ref) {
  return <CommandPrimitive ref={ref} className={cn('flex h-full w-full flex-col overflow-hidden rounded-md bg-background text-foreground', className)} {...props} />
})

export const CommandDialog = ({ children, ...props }: React.ComponentProps<typeof Dialog>) => (
  <Dialog {...props}>
    <DialogContent className="overflow-hidden p-0 shadow-2xl">
      <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
        {children}
      </Command>
    </DialogContent>
  </Dialog>
)

export const CommandInput = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Input>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>>(function CommandInput({ className, ...props }, ref) {
  return <CommandPrimitive.Input ref={ref} className={cn('h-11 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground', className)} {...props} />
})

export const CommandList = React.forwardRef<React.ElementRef<typeof CommandPrimitive.List>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>>(function CommandList({ className, ...props }, ref) {
  return <CommandPrimitive.List ref={ref} className={cn('max-h-[300px] overflow-y-auto overflow-x-hidden', className)} {...props} />
})

export const CommandEmpty = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Empty>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>>(function CommandEmpty({ className, ...props }, ref) {
  return <CommandPrimitive.Empty ref={ref} className={cn('py-6 text-center text-sm', className)} {...props} />
})

export const CommandGroup = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Group>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>>(function CommandGroup({ className, ...props }, ref) {
  return <CommandPrimitive.Group ref={ref} className={cn('overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground', className)} {...props} />
})

export const CommandItem = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Item>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>>(function CommandItem({ className, ...props }, ref) {
  return <CommandPrimitive.Item ref={ref} className={cn('flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-muted aria-selected:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)} {...props} />
})

export const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)} {...props} />
