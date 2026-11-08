/** Mulberry32: deterministic float in [0, 1). */
export function createFloatRng(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Die roller returning integers 1–6 from a float RNG. */
export function createDieRng(seed: number): () => number {
  const next = createFloatRng(seed)
  return () => Math.floor(next() * 6) + 1
}

export function mixSeed(a: number, b: number): number {
  return (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) + b) >>> 0
}
