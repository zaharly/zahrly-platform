import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import { Button } from '../../lib/shadcn/button'
import { Textarea } from '../../lib/shadcn/textarea'
import { Label } from '../../lib/shadcn/label'
import { cn } from '../../lib/shadcn/utils'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  actionSummary: string
  scope: string
  consequences: string[]
  requireReason?: boolean
  requireSecondApproval?: boolean
  confirmLabel?: string
  destructive?: boolean
  onConfirm: (reason: string) => void
}

/** Governed confirmation dialog for any destructive or model/market-affecting action. */
export function ConfirmDialog({
  open, onOpenChange, title, actionSummary, scope, consequences,
  requireReason = true, requireSecondApproval = false, confirmLabel = 'Confirm', destructive = true, onConfirm,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('')
  const canConfirm = !requireReason || reason.trim().length > 4

  function handleConfirm() {
    onConfirm(reason)
    setReason('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className={cn('h-5 w-5', destructive ? 'text-destructive' : 'text-warning')} />
            {title}
          </DialogTitle>
          <DialogDescription>{actionSummary}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-density-md text-sm">
          <div className="rounded-md border border-border bg-muted/50 p-density-md">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Affected scope</div>
            <div className="font-medium text-foreground">{scope}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Consequences</div>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {consequences.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
          {requireSecondApproval && (
            <div className="rounded-md border border-warning/30 zc-chip-warning p-density-md text-xs">
              This action changes production behavior and requires a second approver before it takes effect. Submitting here records your request for review.
            </div>
          )}
          {requireReason && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-reason">Reason (required, for audit log)</Label>
              <Textarea
                id="confirm-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this action is necessary…"
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={handleConfirm} disabled={!canConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
