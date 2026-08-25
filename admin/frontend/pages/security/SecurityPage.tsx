import { useMemo, useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { MetricCard } from '../../components/dashboard/MetricCard'
import { DataTable } from '../../components/tables/DataTable'
import { DetailDrawer } from '../../components/drawers/DetailDrawer'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog'
import { Tabs, TabsList, TabsTrigger } from '../../lib/shadcn/tabs'
import { Button } from '../../lib/shadcn/button'
import { Input } from '../../lib/shadcn/input'
import { Label } from '../../lib/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/shadcn/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../lib/shadcn/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../lib/shadcn/dropdown-menu'
import { toast } from '../../lib/shadcn/sonner'
import { useAdminUsers, useSecretRotations, useRateLimitIncidents, useStoreActions } from '../../state/StoreContext'
import { ROLE_PERMISSIONS } from '../../mock/data/security'
import type { AdminUser, SecretRotation, RateLimitIncident, AdminRole } from '../../types/domain'
import { Users, ShieldCheck, KeyRound, Timer, MoreHorizontal, UserPlus, KeyRound as KeyRoundIcon, Ban, LogOut, RotateCw, Eye, CalendarClock } from 'lucide-react'

const TABS = [
  { path: '/security/admins', value: 'admins', label: 'Admin Users' },
  { path: '/security/roles', value: 'roles', label: 'Roles & Permissions' },
  { path: '/security/secrets', value: 'secrets', label: 'Secrets / Rotation' },
  { path: '/security/rate-limits', value: 'rate-limits', label: 'Rate Limits' },
]

const ROLES = Object.keys(ROLE_PERMISSIONS) as AdminRole[]

export default function SecurityPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const active = TABS.find((t) => t.path === location.pathname)?.value ?? 'admins'
  const adminUsers = useAdminUsers()
  const secretRotations = useSecretRotations()
  const rateLimitIncidents = useRateLimitIncidents()
  const actions = useStoreActions()

  const [addAdminOpen, setAddAdminOpen] = useState(false)
  const [editRoleTarget, setEditRoleTarget] = useState<AdminUser | null>(null)
  const [disableTarget, setDisableTarget] = useState<AdminUser | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<AdminUser | null>(null)
  const [reviewSecret, setReviewSecret] = useState<SecretRotation | null>(null)
  const [scheduleSecret, setScheduleSecret] = useState<SecretRotation | null>(null)

  const adminColumns = useMemo<ColumnDef<AdminUser, any>[]>(() => [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'email', header: 'Email' },
    { accessorKey: 'role', header: 'Role', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} tone="model" dense /> },
    { accessorKey: 'accountStatus', header: 'Account', cell: ({ getValue }) => <StatusBadge status={getValue<string>() === 'active' ? 'ENABLED' : 'DISABLED'} dense /> },
    { accessorKey: 'mfaEnabled', header: 'MFA', cell: ({ getValue }) => <StatusBadge status={getValue<boolean>() ? 'ENABLED' : 'DISABLED'} dense /> },
    { accessorKey: 'sessionStatus', header: 'Session', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} dense /> },
    { accessorKey: 'lastLogin', header: 'Last login', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString() },
    {
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => {
        const admin = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Admin actions" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>{admin.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setEditRoleTarget(admin)}>
                <KeyRoundIcon className="h-4 w-4" /> Edit role
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRevokeTarget(admin)}>
                <LogOut className="h-4 w-4" /> Revoke sessions
              </DropdownMenuItem>
              {admin.accountStatus === 'active' && (
                <DropdownMenuItem onSelect={() => setDisableTarget(admin)}>
                  <Ban className="h-4 w-4" /> Disable admin
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [])

  const secretColumns = useMemo<ColumnDef<SecretRotation, any>[]>(() => [
    { accessorKey: 'name', header: 'Secret' },
    { accessorKey: 'scope', header: 'Scope' },
    { accessorKey: 'lastRotated', header: 'Last rotated' },
    { accessorKey: 'expiresAt', header: 'Expires' },
    { accessorKey: 'daysRemaining', header: 'Days remaining', cell: ({ getValue }) => { const v = getValue<number>(); return v < 0 ? <span className="text-destructive">{v}d overdue</span> : `${v}d` } },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    {
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => {
        const secret = row.original
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setReviewSecret(secret)}><Eye className="h-3.5 w-3.5" /> Review</Button>
            <Button variant="ghost" size="sm" onClick={() => setScheduleSecret(secret)}><CalendarClock className="h-3.5 w-3.5" /> Schedule</Button>
            <Button variant="outline" size="sm" onClick={() => { actions.rotateMockSecret(secret.id); toast.success(`${secret.name} rotated`) }}>
              <RotateCw className="h-3.5 w-3.5" /> Rotate
            </Button>
          </div>
        )
      },
    },
  ], [actions])

  const rateLimitColumns = useMemo<ColumnDef<RateLimitIncident, any>[]>(() => [
    { accessorKey: 'scope', header: 'Scope' },
    { accessorKey: 'endpoint', header: 'Endpoint' },
    { accessorKey: 'count', header: 'Requests' },
    { accessorKey: 'windowMin', header: 'Window', cell: ({ getValue }) => `${getValue<number>()} min` },
    { accessorKey: 'lastHit', header: 'Last hit', cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString() },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
  ], [])

  return (
    <div className="flex flex-col gap-density-lg">
      <PageHeader
        title="Security & Control"
        description="Admin accounts, roles, secret rotation, and rate limiting. No raw secret values are ever displayed."
        {...(active === 'admins' ? { actions: <Button onClick={() => setAddAdminOpen(true)}><UserPlus className="h-4 w-4" /> Add admin</Button> } : {})}
      />
      <Tabs value={active} onValueChange={(v) => navigate(TABS.find((t) => t.value === v)?.path ?? '/security/admins')}>
        <TabsList>{TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}</TabsList>
      </Tabs>

      {active === 'admins' && (
        <>
          <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
            <MetricCard label="Admin accounts" value={adminUsers.length} icon={Users} />
            <MetricCard label="MFA enabled" value={adminUsers.filter((u) => u.mfaEnabled).length} icon={ShieldCheck} tone="success" />
            <MetricCard label="Active sessions" value={adminUsers.filter((u) => u.sessionStatus === 'active').length} />
            <MetricCard label="Revoked" value={adminUsers.filter((u) => u.sessionStatus === 'revoked').length} tone="critical" />
          </div>
          <DataTable columns={adminColumns} data={adminUsers} searchPlaceholder="Search admin users…" pageSize={12} />
        </>
      )}

      {active === 'roles' && (
        <div className="grid grid-cols-1 gap-density-md md:grid-cols-2 xl:grid-cols-3">
          {ROLES.map((role) => (
            <div key={role} className="flex flex-col gap-density-sm rounded-lg border border-border bg-card p-density-lg shadow-retool-sm">
              <StatusBadge status={role} tone="model" className="w-fit" />
              <div><span className="text-xs uppercase text-muted-foreground">Read: </span><span className="text-sm">{ROLE_PERMISSIONS[role].read}</span></div>
              <div><span className="text-xs uppercase text-muted-foreground">Operational control: </span><span className="text-sm">{ROLE_PERMISSIONS[role].control}</span></div>
              <div><span className="text-xs uppercase text-muted-foreground">Sensitive actions: </span><span className="text-sm">{ROLE_PERMISSIONS[role].sensitive}</span></div>
            </div>
          ))}
        </div>
      )}

      {active === 'secrets' && (
        <>
          <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
            <MetricCard label="Secrets tracked" value={secretRotations.length} icon={KeyRound} />
            <MetricCard label="Expired" value={secretRotations.filter((s) => s.status === 'expired').length} tone="critical" />
            <MetricCard label="Expiring within 14 days" value={secretRotations.filter((s) => s.status === 'warning').length} tone="warning" />
            <MetricCard label="Healthy" value={secretRotations.filter((s) => s.status === 'healthy').length} tone="success" />
          </div>
          <DataTable columns={secretColumns} data={secretRotations} searchPlaceholder="Search secrets…" pageSize={12} />
        </>
      )}

      {active === 'rate-limits' && (
        <>
          <div className="grid grid-cols-2 gap-density-md md:grid-cols-4">
            <MetricCard label="Active incidents" value={rateLimitIncidents.filter((r) => r.status === 'active').length} icon={Timer} tone="warning" />
            <MetricCard label="Resolved" value={rateLimitIncidents.filter((r) => r.status === 'resolved').length} tone="success" />
          </div>
          <DataTable columns={rateLimitColumns} data={rateLimitIncidents} searchPlaceholder="Search rate-limit incidents…" pageSize={12} />
        </>
      )}

      <AddAdminDialog open={addAdminOpen} onOpenChange={setAddAdminOpen} onCreate={(input) => { actions.addAdmin(input); toast.success(`${input.name} added as ${input.role}`) }} />

      <EditRoleDialog
        admin={editRoleTarget}
        onOpenChange={(o) => !o && setEditRoleTarget(null)}
        onSave={(role, reason) => { if (editRoleTarget) actions.editAdminRole(editRoleTarget.id, role, reason); toast.success('Role updated') }}
      />

      {disableTarget && (
        <ConfirmDialog
          open={!!disableTarget}
          onOpenChange={(o) => !o && setDisableTarget(null)}
          title={`Disable ${disableTarget.name}`}
          actionSummary="Disables the account and revokes all active sessions."
          scope={disableTarget.email}
          consequences={['Account can no longer sign in.', 'All active sessions are revoked immediately.', 'Recorded in the audit log with your reason.']}
          confirmLabel="Disable admin"
          onConfirm={(reason) => { actions.disableAdmin(disableTarget.id, reason); toast.success(`${disableTarget.name} disabled`) }}
        />
      )}
      {revokeTarget && (
        <ConfirmDialog
          open={!!revokeTarget}
          onOpenChange={(o) => !o && setRevokeTarget(null)}
          title={`Revoke sessions for ${revokeTarget.name}`}
          actionSummary="Immediately signs this admin out of all active sessions."
          scope={revokeTarget.email}
          consequences={['All active sessions are invalidated immediately.', 'The admin must re-authenticate to regain access.']}
          confirmLabel="Revoke sessions"
          destructive={false}
          onConfirm={() => { actions.revokeSessions(revokeTarget.id); toast.success('Sessions revoked') }}
        />
      )}

      <DetailDrawer
        open={!!reviewSecret}
        onOpenChange={(o) => !o && setReviewSecret(null)}
        title={reviewSecret?.name}
        description={reviewSecret?.scope}
      >
        {reviewSecret && (
          <div className="flex flex-col gap-density-md text-sm">
            <StatusBadge status={reviewSecret.status} />
            <div><span className="text-xs uppercase text-muted-foreground">Last rotated: </span>{reviewSecret.lastRotated}</div>
            <div><span className="text-xs uppercase text-muted-foreground">Expires: </span>{reviewSecret.expiresAt}</div>
            <div><span className="text-xs uppercase text-muted-foreground">Days remaining: </span>{reviewSecret.daysRemaining}</div>
            <p className="text-xs text-muted-foreground">Raw secret values are never displayed in this console.</p>
          </div>
        )}
      </DetailDrawer>

      <ScheduleRotationDialog
        secret={scheduleSecret}
        onOpenChange={(o) => !o && setScheduleSecret(null)}
        onSchedule={(date) => { if (scheduleSecret) actions.scheduleSecretRotation(scheduleSecret.id, date); toast.success('Rotation scheduled') }}
      />
    </div>
  )
}

function AddAdminDialog({ open, onOpenChange, onCreate }: {
  open: boolean; onOpenChange: (o: boolean) => void
  onCreate: (input: { name: string; email: string; role: AdminRole }) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AdminRole>('READ_ONLY')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add admin</DialogTitle>
          <DialogDescription>Grants console access using the existing role model.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-density-md">
          <div className="flex flex-col gap-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@zahrly.io" /></div>
          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AdminRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name.trim() || !email.includes('@')} onClick={() => { onCreate({ name, email, role }); onOpenChange(false); setName(''); setEmail('') }}>Add admin</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditRoleDialog({ admin, onOpenChange, onSave }: {
  admin: AdminUser | null; onOpenChange: (o: boolean) => void; onSave: (role: AdminRole, reason: string) => void
}) {
  const [role, setRole] = useState<AdminRole>('READ_ONLY')
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (admin) setRole(admin.role)
  }, [admin])
  return (
    <Dialog open={!!admin} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit role — {admin?.name}</DialogTitle>
          <DialogDescription>Uses the existing role model. No arbitrary permission groups.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-density-md">
          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AdminRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5"><Label>Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this change needed?" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={reason.trim().length < 4} onClick={() => { onSave(role, reason); onOpenChange(false); setReason('') }}>Save role</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ScheduleRotationDialog({ secret, onOpenChange, onSchedule }: {
  secret: SecretRotation | null; onOpenChange: (o: boolean) => void; onSchedule: (date: string) => void
}) {
  const [date, setDate] = useState('')
  return (
    <Dialog open={!!secret} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Schedule rotation — {secret?.name}</DialogTitle>
          <DialogDescription>Plans a future rotation window without rotating immediately.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5"><Label>Scheduled date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!date} onClick={() => { onSchedule(date); onOpenChange(false); setDate('') }}>Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
