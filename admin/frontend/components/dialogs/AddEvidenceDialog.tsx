import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import { Button } from '../../lib/shadcn/button'
import { Input } from '../../lib/shadcn/input'
import { Label } from '../../lib/shadcn/label'
import { Textarea } from '../../lib/shadcn/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'

const EVIDENCE_TYPES = [
  'Team news feed', 'Lineup confirmation', 'Injury report', 'Market movement scan',
  'Weather update', 'Referee assignment', 'Press conference signal', 'Manual observation',
]

export interface AddEvidenceFormValue {
  evidenceType: string
  source: string
  description: string
  affectedArea: string
  evidenceReference: string
}

interface AddEvidenceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fixtureLabel: string
  episodeId: string
  onSubmit: (value: AddEvidenceFormValue) => void
}

/** Add-evidence modal — appends to the evidence sequence, never edits the immutable baseline. */
export function AddEvidenceDialog({ open, onOpenChange, fixtureLabel, episodeId, onSubmit }: AddEvidenceDialogProps) {
  const [evidenceType, setEvidenceType] = useState(EVIDENCE_TYPES[0]!)
  const [source, setSource] = useState('')
  const [description, setDescription] = useState('')
  const [affectedArea, setAffectedArea] = useState('')
  const [evidenceReference, setEvidenceReference] = useState('')

  function reset() {
    setEvidenceType(EVIDENCE_TYPES[0]!)
    setSource('')
    setDescription('')
    setAffectedArea('')
    setEvidenceReference('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add evidence</DialogTitle>
          <DialogDescription>
            Appends a new evidence event for {fixtureLabel} (episode {episodeId}). The immutable baseline is never changed — only the current assessment updates.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-density-md">
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>Evidence type</Label>
            <Select value={evidenceType} onValueChange={setEvidenceType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EVIDENCE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Source</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Club press office" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Affected area</Label>
            <Input value={affectedArea} onChange={(e) => setAffectedArea(e.target.value)} placeholder="e.g. lineup_confidence" />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What was observed and why it matters…" />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>Evidence reference</Label>
            <Input value={evidenceReference} onChange={(e) => setEvidenceReference(e.target.value)} placeholder="Optional URL, ticket, or snapshot ID" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!source.trim() || description.trim().length < 4}
            onClick={() => {
              onSubmit({ evidenceType, source, description, affectedArea: affectedArea || 'unspecified', evidenceReference })
              onOpenChange(false)
              reset()
            }}
          >
            Add evidence
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
