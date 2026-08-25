import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import { Button } from '../../lib/shadcn/button'
import { Label } from '../../lib/shadcn/label'
import { Textarea } from '../../lib/shadcn/textarea'
import { Switch } from '../../lib/shadcn/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import type { IncidentSeverity } from '../../types/domain'

const INCIDENT_TYPES = ['Provider outage', 'Data quality', 'Identity mismatch', 'Schema issue', 'Manual report']
const SEVERITIES: IncidentSeverity[] = ['P0', 'P1', 'P2', 'P3']

export interface OpenIncidentPayload {
  severity: IncidentSeverity
  description: string
  materialToPrediction: boolean
}

interface OpenIncidentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subject: string
  onCreate: (payload: OpenIncidentPayload) => void
}

/** Shared "create data/provider incident" dialog used across fixture and prediction operations. */
export function OpenIncidentDialog({ open, onOpenChange, subject, onCreate }: OpenIncidentDialogProps) {
  const [type, setType] = useState(INCIDENT_TYPES[0]!)
  const [severity, setSeverity] = useState<IncidentSeverity>('P2')
  const [description, setDescription] = useState('')
  const [material, setMaterial] = useState(false)

  function reset() {
    setType(INCIDENT_TYPES[0]!)
    setSeverity('P2')
    setDescription('')
    setMaterial(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Open data incident</DialogTitle>
          <DialogDescription>Creates a new tracked incident for {subject}.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-density-md">
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{INCIDENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Severity</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as IncidentSeverity)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the source or data issue…" rows={3} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-density-sm">
            <Label className="text-sm">Material to prediction</Label>
            <Switch checked={material} onCheckedChange={setMaterial} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={description.trim().length < 4}
            onClick={() => {
              onCreate({ severity, description: `${type}: ${description}`, materialToPrediction: material })
              onOpenChange(false)
              reset()
            }}
          >
            Open incident
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
