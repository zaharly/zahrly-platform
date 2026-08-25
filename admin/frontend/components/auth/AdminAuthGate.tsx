import type { FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function AdminAuthGate({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [checkingAdmin, setCheckingAdmin] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  async function checkAdmin() {
    setCheckingAdmin(true)
    setError(null)
    try {
      const { data, error: userError } = await supabase.auth.getUser()
      if (userError || !data.user) {
        setUserEmail(null)
        setIsAdmin(false)
        return
      }
      setUserEmail(data.user.email ?? null)

      const { error: adminError } = await supabase.rpc('admin_archive_campaign_options')
      if (adminError) {
        setIsAdmin(false)
        setError('Authenticated successfully, but this account is not authorized for the Zahrly admin control plane.')
        return
      }
      setIsAdmin(true)
    } catch (e) {
      setIsAdmin(false)
      setError(e instanceof Error ? e.message : 'Unable to verify admin access')
    } finally {
      setCheckingAdmin(false)
      setLoading(false)
    }
  }

  useEffect(() => {
    void checkAdmin()
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUserEmail(null)
        setIsAdmin(false)
        setError(null)
        setLoading(false)
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        window.setTimeout(() => { void checkAdmin() }, 0)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function signIn(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) throw signInError
      await checkAdmin()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to sign in')
    } finally {
      setBusy(false)
    }
  }

  async function sendMagicLink() {
    if (!email.trim()) return
    setBusy(true)
    setError(null)
    setMagicLinkSent(false)
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: window.location.origin,
        },
      })
      if (otpError) throw otpError
      setMagicLinkSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to send sign-in link')
    } finally {
      setBusy(false)
    }
  }

  if (loading || checkingAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-retool-sm">
          <div className="text-lg font-semibold">Zahrly Admin</div>
          <div className="mt-2 text-sm text-muted-foreground">Verifying secure admin session…</div>
        </div>
      </div>
    )
  }

  if (userEmail && isAdmin) {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-retool-sm">
        <div className="text-xl font-semibold">Zahrly Admin</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Sign in with an existing Supabase account. Admin authorization remains enforced by the backend.
        </div>

        <form onSubmit={signIn} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              className="h-10 rounded-md border border-border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
              placeholder="admin@example.com"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              className="h-10 rounded-md border border-border bg-background px-3 outline-none focus:ring-2 focus:ring-ring"
              placeholder="••••••••"
              required
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => void sendMagicLink()}
          disabled={busy || !email.trim()}
          className="mt-3 h-10 w-full rounded-md border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          Send magic link
        </button>

        {magicLinkSent && (
          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            A sign-in link was requested for this address. Complete the Supabase Auth flow, then return here.
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
