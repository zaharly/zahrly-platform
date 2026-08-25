import * as React from 'react'
import { cn } from './shadcn/utils'

export const Button = ({ className, variant = 'default', size = 'default', type = 'button', ...props }: any) => <button type={type} className={cn('inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50', variant === 'outline' ? 'border border-border bg-background hover:bg-muted' : variant === 'destructive' ? 'bg-destructive text-destructive-foreground' : variant === 'ghost' ? 'hover:bg-muted' : 'bg-foreground text-background', size === 'sm' ? 'h-8 px-3' : size === 'lg' ? 'h-10 px-5' : 'h-9 px-4', className)} {...props} />
export const Input = React.forwardRef<HTMLInputElement, any>((p, ref) => <input ref={ref} {...p} className={cn('flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm', p.className)} />)
export const Textarea = React.forwardRef<HTMLTextAreaElement, any>((p, ref) => <textarea ref={ref} {...p} className={cn('min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm', p.className)} />)
export const Label = ({ className, ...props }: any) => <label className={cn('text-sm font-medium', className)} {...props} />
export const Badge = ({ className, variant = 'default', ...props }: any) => <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', variant === 'outline' ? 'border border-border' : 'bg-secondary', className)} {...props} />
export const Card = ({ className, ...p }: any) => <div className={cn('rounded-lg border border-border bg-card text-card-foreground', className)} {...p} />
export const CardHeader = ({ className, ...p }: any) => <div className={cn('flex flex-col space-y-1.5 p-6', className)} {...p} />
export const CardTitle = ({ className, ...p }: any) => <h3 className={cn('text-lg font-semibold', className)} {...p} />
export const CardDescription = ({ className, ...p }: any) => <p className={cn('text-sm text-muted-foreground', className)} {...p} />
export const CardContent = ({ className, ...p }: any) => <div className={cn('p-6 pt-0', className)} {...p} />
export const CardFooter = ({ className, ...p }: any) => <div className={cn('flex items-center p-6 pt-0', className)} {...p} />

export const Dialog = ({ open, onOpenChange, children }: any) => open === false ? null : <div>{children}</div>
export const DialogTrigger = ({ asChild, children, ...p }: any) => <span {...p}>{children}</span>
export const DialogClose = ({ children, ...p }: any) => <button {...p}>{children}</button>
export const DialogContent = ({ className, children, ...p }: any) => <div role="dialog" className={cn('fixed inset-0 z-50 m-auto h-fit max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-lg border border-border bg-background p-6 shadow-lg', className)} {...p}>{children}</div>
export const DialogHeader = ({ className, ...p }: any) => <div className={cn('flex flex-col gap-1.5', className)} {...p} />
export const DialogFooter = ({ className, ...p }: any) => <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...p} />
export const DialogTitle = ({ className, ...p }: any) => <h2 className={cn('text-lg font-semibold', className)} {...p} />
export const DialogDescription = ({ className, ...p }: any) => <p className={cn('text-sm text-muted-foreground', className)} {...p} />

const SelectContext = React.createContext<any>(null)
export const Select = ({ value, onValueChange, children }: any) => <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
export const SelectTrigger = ({ className, children, ...p }: any) => { const ctx = React.useContext(SelectContext); return <select value={ctx?.value ?? ''} onChange={e => ctx?.onValueChange?.(e.target.value)} className={cn('flex h-9 w-full items-center rounded-md border border-input bg-background px-3 text-sm', className)} {...p}>{children}</select> }
export const SelectValue = ({ placeholder = 'Select…' }: any) => <option value="">{placeholder}</option>
export const SelectContent = ({ children }: any) => <>{children}</>
export const SelectItem = ({ value, children }: any) => <option value={value}>{children}</option>
export const SelectGroup = ({ children }: any) => <>{children}</>
export const SelectLabel = ({ children }: any) => <option disabled>{children}</option>
export const SelectSeparator = () => null

export const TooltipProvider = ({ children }: any) => <>{children}</>
export const Tooltip = ({ children }: any) => <>{children}</>
export const TooltipTrigger = ({ children }: any) => <>{children}</>
export const TooltipContent = ({ children }: any) => <span className="sr-only">{children}</span>

export const Progress = ({ value = 0, className }: any) => <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}><div className="h-full bg-foreground" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
export const Separator = ({ orientation = 'horizontal', className }: any) => <div className={cn(orientation === 'vertical' ? 'h-full w-px' : 'h-px w-full', 'bg-border', className)} />
export const Checkbox = ({ checked, onCheckedChange, className, ...p }: any) => <input type="checkbox" checked={!!checked} onChange={e => onCheckedChange?.(e.target.checked)} className={cn('h-4 w-4 rounded border', className)} {...p} />
export const Switch = ({ checked, onCheckedChange, className, ...p }: any) => <input type="checkbox" role="switch" checked={!!checked} onChange={e => onCheckedChange?.(e.target.checked)} className={cn('h-5 w-9', className)} {...p} />
export const Slider = ({ value = [0], onValueChange, min = 0, max = 100, step = 1 }: any) => <input type="range" min={min} max={max} step={step} value={Array.isArray(value) ? value[0] : value} onChange={e => onValueChange?.([Number(e.target.value)])} className="w-full" />

export const Tabs = ({ defaultValue, children }: any) => <div data-default-value={defaultValue}>{children}</div>
export const TabsList = ({ className, ...p }: any) => <div role="tablist" className={cn('inline-flex rounded-md bg-muted p-1', className)} {...p} />
export const TabsTrigger = ({ className, ...p }: any) => <button role="tab" className={cn('rounded px-3 py-1.5 text-sm', className)} {...p} />
export const TabsContent = ({ className, ...p }: any) => <div role="tabpanel" className={cn('mt-2', className)} {...p} />

export const Accordion = ({ children }: any) => <div>{children}</div>
export const AccordionItem = ({ children }: any) => <div className="border-b border-border">{children}</div>
export const AccordionTrigger = ({ children, ...p }: any) => <button className="flex w-full items-center justify-between py-4 text-sm font-medium" {...p}>{children}</button>
export const AccordionContent = ({ children }: any) => <div className="pb-4 text-sm">{children}</div>
export const Collapsible = ({ children }: any) => <div>{children}</div>
export const CollapsibleTrigger = ({ children, ...p }: any) => <button {...p}>{children}</button>
export const CollapsibleContent = ({ children }: any) => <div>{children}</div>
export const Popover = ({ children }: any) => <div className="relative inline-block">{children}</div>
export const PopoverTrigger = ({ children, ...p }: any) => <button {...p}>{children}</button>
export const PopoverContent = ({ className, children }: any) => <div className={cn('absolute z-50 mt-2 rounded-md border border-border bg-background p-4 shadow-md', className)}>{children}</div>
export const ScrollArea = ({ className, children, ...p }: any) => <div className={cn('overflow-auto', className)} {...p}>{children}</div>
export const Avatar = ({ className, children }: any) => <div className={cn('relative flex h-8 w-8 overflow-hidden rounded-full', className)}>{children}</div>
export const AvatarImage = (p: any) => <img {...p} className={cn('aspect-square h-full w-full object-cover', p.className)} />
export const AvatarFallback = ({ className, ...p }: any) => <div className={cn('flex h-full w-full items-center justify-center bg-muted', className)} {...p} />
export const HoverCard = ({ children }: any) => <span className="inline-block">{children}</span>
export const HoverCardTrigger = ({ children, ...p }: any) => <span {...p}>{children}</span>
export const HoverCardContent = ({ children, className }: any) => <div className={cn('absolute z-50 rounded-md border border-border bg-background p-4 shadow-md', className)}>{children}</div>

export const DropdownMenu = ({ children }: any) => <div className="relative inline-block">{children}</div>
export const DropdownMenuTrigger = ({ children, ...p }: any) => <button {...p}>{children}</button>
export const DropdownMenuContent = ({ children, className }: any) => <div className={cn('absolute right-0 z-50 min-w-40 rounded-md border border-border bg-background p-1 shadow-md', className)}>{children}</div>
export const DropdownMenuItem = ({ children, className, ...p }: any) => <button className={cn('flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-muted', className)} {...p}>{children}</button>
export const DropdownMenuLabel = ({ children, className }: any) => <div className={cn('px-2 py-1.5 text-xs font-semibold', className)}>{children}</div>
export const DropdownMenuSeparator = Separator
export const DropdownMenuCheckboxItem = ({ checked, onCheckedChange, children, ...p }: any) => <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"><input type="checkbox" checked={!!checked} onChange={e => onCheckedChange?.(e.target.checked)} />{children}</label>
export const DropdownMenuRadioGroup = ({ children }: any) => <div>{children}</div>
export const DropdownMenuRadioItem = DropdownMenuItem
export const DropdownMenuSub = ({ children }: any) => <div>{children}</div>
export const DropdownMenuSubTrigger = DropdownMenuItem
export const DropdownMenuSubContent = DropdownMenuContent

export const Sheet = ({ open = true, children }: any) => open === false ? null : <div>{children}</div>
export const SheetTrigger = ({ children, ...p }: any) => <button {...p}>{children}</button>
export const SheetClose = ({ children, ...p }: any) => <button {...p}>{children}</button>
export const SheetContent = ({ side = 'right', className, children, ...p }: any) => <div role="dialog" className={cn('fixed z-50 bg-background p-6 shadow-lg', side === 'left' ? 'inset-y-0 left-0 w-[min(24rem,100vw)]' : side === 'top' ? 'inset-x-0 top-0' : side === 'bottom' ? 'inset-x-0 bottom-0' : 'inset-y-0 right-0 w-[min(24rem,100vw)]', className)} {...p}>{children}</div>
export const SheetHeader = ({ className, ...p }: any) => <div className={cn('flex flex-col gap-1.5', className)} {...p} />
export const SheetFooter = ({ className, ...p }: any) => <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...p} />
export const SheetTitle = ({ className, ...p }: any) => <h2 className={cn('text-lg font-semibold', className)} {...p} />
export const SheetDescription = ({ className, ...p }: any) => <p className={cn('text-sm text-muted-foreground', className)} {...p} />

export const AlertDialog = Dialog
export const AlertDialogTrigger = DialogTrigger
export const AlertDialogContent = DialogContent
export const AlertDialogHeader = DialogHeader
export const AlertDialogFooter = DialogFooter
export const AlertDialogTitle = DialogTitle
export const AlertDialogDescription = DialogDescription
export const AlertDialogCancel = DialogClose
export const AlertDialogAction = Button

export const RadioGroup = ({ value, onValueChange, children }: any) => <div data-value={value} onChange={(e: any) => onValueChange?.(e.target.value)}>{children}</div>
export const RadioGroupItem = ({ value, ...p }: any) => <input type="radio" value={value} {...p} />

export const toast = Object.assign((message: string, options?: any) => console.log(message, options), {
  success: (message: string, options?: any) => console.log(message, options),
  error: (message: string, options?: any) => console.error(message, options),
  info: (message: string, options?: any) => console.info(message, options),
})
export const Toaster = () => null

export const Table = ({ className, ...p }: any) => <table className={cn('w-full caption-bottom text-sm', className)} {...p} />
export const TableHeader = ({ className, ...p }: any) => <thead className={cn('[&_tr]:border-b', className)} {...p} />
export const TableBody = ({ className, ...p }: any) => <tbody className={cn('[&_tr:last-child]:border-0', className)} {...p} />
export const TableRow = ({ className, ...p }: any) => <tr className={cn('border-b', className)} {...p} />
export const TableHead = ({ className, ...p }: any) => <th className={cn('h-10 px-2 text-left font-medium', className)} {...p} />
export const TableCell = ({ className, ...p }: any) => <td className={cn('p-2 align-middle', className)} {...p} />
export const TableCaption = ({ className, ...p }: any) => <caption className={cn('mt-4 text-sm text-muted-foreground', className)} {...p} />
