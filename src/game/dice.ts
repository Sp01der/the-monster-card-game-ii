/** Highest `count` faces on a d6. Helpful chances succeed on these. */
export function highFaces(count: number): number[] {
  const n = clampFaceCount(count)
  const faces: number[] = []
  for (let face = 7 - n; face <= 6; face++) faces.push(face)
  return faces
}

/** Lowest `count` faces on a d6. Harmful chances, such as friendly fire, trigger on these. */
export function lowFaces(count: number): number[] {
  const n = clampFaceCount(count)
  const faces: number[] = []
  for (let face = 1; face <= n; face++) faces.push(face)
  return faces
}

function clampFaceCount(count: number): number {
  return Math.max(0, Math.min(6, Math.trunc(count)))
}
