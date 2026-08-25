// Deterministic pseudo-random generator so mock data is stable across renders/reloads.

export function makeRng(seed: number) {
  let state = seed % 2147483647
  if (state <= 0) state += 2147483646
  return function next(): number {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  const idx = Math.floor(rng() * arr.length)
  return arr[Math.min(idx, arr.length - 1)] as T
}

export function pickMany<T>(rng: () => number, arr: readonly T[], count: number): T[] {
  const pool = [...arr]
  const out: T[] = []
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length)
    out.push(pool.splice(idx, 1)[0] as T)
  }
  return out
}

export function range(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min)
}

export function rangeInt(rng: () => number, min: number, max: number): number {
  return Math.floor(range(rng, min, max + 1))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function round(value: number, decimals = 1): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

export function isoOffset(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString()
}

export function uid(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`
}
