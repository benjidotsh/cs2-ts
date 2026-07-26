// The overlap tests the lowering pipeline runs on. Deliberately not in
// `types.ts`: that module is re-exported wholesale from `index.ts`, and these
// are how the pipeline does its job rather than part of the job's description.
import type { Aabb } from './types'

/**
 * Intersection of two 1-D intervals. `size` is non-positive when they merely
 * touch or miss entirely, matching `aabbsOverlap`'s rule that a shared face is
 * not an overlap.
 */
export function overlap1d(aMin: number, aMax: number, bMin: number, bMax: number):
{ lo: number; hi: number; size: number } {
  const lo = Math.max(aMin, bMin)
  const hi = Math.min(aMax, bMax)
  return { lo, hi, size: hi - lo }
}

/** True only for genuine volume intersection; shared faces are not overlaps. */
export function aabbsOverlap(a: Aabb, b: Aabb): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.max[i]! <= b.min[i]! || b.max[i]! <= a.min[i]!) return false
  }
  return true
}
