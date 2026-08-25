import { useSearchParams } from 'react-router-dom'

/** Reads/writes a `?tab=` query param, useful for pages that expose multiple sidebar routes as tabs. */
export function useQueryTab(defaultTab: string): [string, (tab: string) => void] {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? defaultTab
  function setTab(next: string) {
    setParams((prev) => {
      const copy = new URLSearchParams(prev)
      copy.set('tab', next)
      return copy
    })
  }
  return [tab, setTab]
}
