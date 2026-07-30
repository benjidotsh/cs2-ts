// The axis arithmetic the lowering pipeline runs on. Deliberately not in
// `types.ts`: that module is re-exported wholesale from `index.ts`, and these
// are how the pipeline does its job rather than part of the job's description.
import { CARDINALS, Direction, type Aabb, type Cardinal } from './types'

/**
 * Travel axis (0=X, 1=Y) and which end of it each cardinal points toward.
 *
 * `solve` reads this forwards, turning a connection's direction into a face to
 * place a room against; `toSolids` and the wedge builder read it backwards,
 * through `cardinalOn`, to point a slope or mirror a wedge. Getting those two
 * senses to disagree is the recurring bug in this pipeline, so the mapping is
 * written down once and the reverse derived from it.
 */
export const AXIS: Record<Cardinal, { axis: 0 | 1; sign: 1 | -1 }> = {
  [Direction.East]: { axis: 0, sign: 1 },
  [Direction.West]: { axis: 0, sign: -1 },
  [Direction.North]: { axis: 1, sign: 1 },
  [Direction.South]: { axis: 1, sign: -1 },
}

/** The cardinal pointing along `axis`, toward its max end or its min end. */
export const cardinalOn = (axis: 0 | 1, towardMax: boolean): Cardinal =>
  CARDINALS.find((d) => AXIS[d].axis === axis && (AXIS[d].sign === 1) === towardMax)!

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
