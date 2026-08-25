export type CurrentUser = {
  fullName: string
  email: string
}

export function useCurrentUser() {
  const user: CurrentUser = {
    fullName: 'Operator',
    email: 'operator@zahrly.io',
  }

  return { user, loading: false, error: null as Error | null }
}
